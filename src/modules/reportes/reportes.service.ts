import { and } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { badRequest } from "../../shared/http-error.js";
import { centavos, pesos } from "../cartera/cartera.rules.js";
import { getCartera } from "../cartera/cartera.service.js";
import type { ReporteFacturacionQuery } from "./reportes.schemas.js";

const ZONA = "America/Bogota";

const inicioDelDia = (fecha: Temporal.PlainDate) => fecha.toZonedDateTime({ timeZone: ZONA }).toInstant();
const diaDe = (instant: Temporal.Instant) => instant.toZonedDateTimeISO(ZONA).toPlainDate().toString();

// Por defecto, el mes en curso.
export const rangoDelReporte = (query: ReporteFacturacionQuery, hoy = Temporal.Now.plainDateISO(ZONA)) => {
  const desde = query.desde ? Temporal.PlainDate.from(query.desde) : hoy.with({ day: 1 });
  const hasta = query.hasta ? Temporal.PlainDate.from(query.hasta) : hoy;

  if (Temporal.PlainDate.compare(desde, hasta) > 0) {
    throw badRequest("La fecha inicial debe ser anterior o igual a la final");
  }

  if (desde.until(hasta, { largestUnit: "day" }).days > 366) {
    throw badRequest("El rango maximo es de un año");
  }

  return { desde, hasta, inicio: inicioDelDia(desde), fin: inicioDelDia(hasta.add({ days: 1 })) };
};

const sumar = <T>(filas: T[], valor: (fila: T) => string) => filas.reduce((total, fila) => total + centavos(valor(fila)), 0n);

const agrupar = <T>(filas: T[], clave: (fila: T) => string) => {
  const grupos = new Map<string, T[]>();
  for (const fila of filas) grupos.set(clave(fila), [...(grupos.get(clave(fila)) ?? []), fila]);
  return grupos;
};

export const getReporteFacturacion = async (query: ReporteFacturacionQuery) => {
  const { desde, hasta, inicio, fin } = rangoDelReporte(query);

  const [facturas, notas, pagos, cartera] = await Promise.all([
    db.orm.public.Facturas
      .where((f) => and(f.fechaEmision.gte(inicio), f.fechaEmision.lt(fin)))
      .include("cliente", (c) => c.select("id", "nombreRazonSocial", "numeroIdentificacion"))
      .include("detallesFacturas", (d) => d.select("codigoItem", "descripcion", "cantidad", "total"))
      .all(),
    db.orm.public.NotasCredito
      .where((nc) => and(nc.estadoDian.eq("VALIDADA"), nc.fechaEmision.gte(inicio), nc.fechaEmision.lt(fin)))
      .select("total")
      .all(),
    db.orm.public.Pagos.where((p) => and(p.fechaPago.gte(inicio), p.fechaPago.lt(fin))).select("monto", "metodoPago").all(),
    getCartera({ filtro: "CON_SALDO" }),
  ]);

  const facturado = sumar(facturas, (f) => f.total);
  const notasCredito = sumar(notas, (n) => n.total);

  // Serie diaria con todos los dias del rango, aunque no tengan ventas.
  const porDia = agrupar(facturas, (f) => diaDe(f.fechaEmision));
  const serie: { fecha: string; facturas: number; total: string }[] = [];
  for (let dia = desde; Temporal.PlainDate.compare(dia, hasta) <= 0; dia = dia.add({ days: 1 })) {
    const delDia = porDia.get(dia.toString()) ?? [];
    serie.push({ fecha: dia.toString(), facturas: delDia.length, total: pesos(sumar(delDia, (f) => f.total)) });
  }

  const lineas = facturas.flatMap((f) => f.detallesFacturas);
  const topItems = [...agrupar(lineas, (l) => l.codigoItem ?? l.descripcion).values()]
    .map((grupo) => ({
      codigo: grupo[0]!.codigoItem,
      descripcion: grupo[0]!.descripcion,
      cantidad: pesos(sumar(grupo, (l) => l.cantidad)),
      total: sumar(grupo, (l) => l.total),
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
    .slice(0, 8)
    .map((item) => ({ ...item, total: pesos(item.total) }));

  const topClientes = [...agrupar(facturas, (f) => f.clienteId).values()]
    .map((grupo) => ({
      id: grupo[0]!.clienteId,
      nombre: grupo[0]!.cliente?.nombreRazonSocial ?? "",
      documento: grupo[0]!.cliente?.numeroIdentificacion ?? "",
      facturas: grupo.length,
      total: sumar(grupo, (f) => f.total),
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
    .slice(0, 5)
    .map((cliente) => ({ ...cliente, total: pesos(cliente.total) }));

  const contar = <K extends string>(valores: K[]) =>
    valores.reduce<Partial<Record<K, number>>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});

  return {
    rango: { desde: desde.toString(), hasta: hasta.toString() },
    totales: {
      facturas: facturas.length,
      facturado: pesos(facturado),
      subtotal: pesos(sumar(facturas, (f) => f.subtotal)),
      iva: pesos(sumar(facturas, (f) => f.impuestos)),
      notasCredito: pesos(notasCredito),
      neto: pesos(facturado - notasCredito),
      recaudado: pesos(sumar(pagos, (p) => p.monto)),
      ticketPromedio: pesos(facturas.length > 0 ? facturado / BigInt(facturas.length) : 0n),
    },
    porEstadoDian: contar(facturas.map((f) => f.estadoDian)),
    porFormaPago: contar(facturas.map((f) => f.formaPago)),
    recaudoPorMetodo: Object.fromEntries(
      [...agrupar(pagos, (p) => p.metodoPago).entries()].map(([metodo, grupo]) => [metodo, pesos(sumar(grupo, (p) => p.monto))]),
    ),
    serie,
    topItems,
    topClientes,
    // La cartera es una foto de hoy, no depende del rango.
    cartera: cartera.resumen,
  };
};
