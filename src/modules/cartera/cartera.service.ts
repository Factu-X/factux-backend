import { db } from "../../prisma/db.js";
import { badRequest } from "../../shared/http-error.js";
import { nullableVarchar, numeric } from "../../shared/prisma-types.js";
import { nowInstant } from "../../shared/time.js";
import { getFacturaById } from "../facturas/facturas.service.js";
import { ANTIGUEDADES, centavos, estadoCuenta, pesos, type Antiguedad } from "./cartera.rules.js";
import type { CarteraQuery, RegistrarPagoInput } from "./cartera.schemas.js";

const hoyColombia = () => Temporal.Now.plainDateISO("America/Bogota");

const sumarPorFactura = (filas: { facturaId: string; valor: string }[]) => {
  const totales = new Map<string, bigint>();
  for (const fila of filas) totales.set(fila.facturaId, (totales.get(fila.facturaId) ?? 0n) + centavos(fila.valor));
  return totales;
};

// Solo las notas credito validadas por la DIAN reducen lo que el cliente debe.
const acreditadoPorFactura = async () =>
  sumarPorFactura(
    (await db.orm.public.NotasCredito.where({ estadoDian: "VALIDADA" }).select("facturaId", "total").all()).map(
      (nc) => ({ facturaId: nc.facturaId, valor: nc.total }),
    ),
  );

const pagadoPorFactura = async () =>
  sumarPorFactura(
    (await db.orm.public.Pagos.select("facturaId", "monto").all()).map((p) => ({ facturaId: p.facturaId, valor: p.monto })),
  );

const vencimientoDe = (factura: { fechaVencimiento: Temporal.PlainDate | null; fechaEmision: Temporal.Instant }) =>
  factura.fechaVencimiento ?? factura.fechaEmision.toZonedDateTimeISO("America/Bogota").toPlainDate();

export const getCartera = async (query: CarteraQuery) => {
  const [facturas, acreditado, pagado] = await Promise.all([
    db.orm.public.Facturas
      .include("cliente", (c) => c.select("id", "tipoIdentificacion", "numeroIdentificacion", "nombreRazonSocial", "telefono", "email"))
      .orderBy((f) => f.fechaEmision.asc())
      .all(),
    acreditadoPorFactura(),
    pagadoPorFactura(),
  ]);
  const hoy = hoyColombia();

  const cuentas = facturas.map((factura) => {
    const vencimiento = vencimientoDe(factura);
    const cuenta = estadoCuenta({
      total: factura.total,
      acreditado: acreditado.get(factura.id) ?? 0n,
      pagado: pagado.get(factura.id) ?? 0n,
      vencimiento,
      hoy,
    });

    return {
      id: factura.id,
      numero: factura.numero,
      fechaEmision: factura.fechaEmision,
      formaPago: factura.formaPago,
      vencimiento: vencimiento.toString(),
      estadoDian: factura.estadoDian,
      total: factura.total,
      cliente: factura.cliente,
      ...cuenta,
    };
  });

  const porAntiguedad = Object.fromEntries(ANTIGUEDADES.map((a) => [a, 0n])) as Record<Antiguedad, bigint>;
  let porCobrar = 0n;

  const conSaldo = (c: { saldo: string }) => centavos(c.saldo) > 0n;

  for (const cuenta of cuentas) {
    porCobrar += centavos(cuenta.saldo);
    porAntiguedad[cuenta.antiguedad] += centavos(cuenta.saldo);
  }

  const visibles = cuentas.filter((c) =>
    query.filtro === "TODAS" ? true : query.filtro === "VENCIDAS" ? conSaldo(c) && c.diasVencida > 0 : conSaldo(c),
  );

  return {
    resumen: {
      porCobrar: pesos(porCobrar),
      vencido: pesos(porCobrar - porAntiguedad.AL_DIA),
      facturasConSaldo: cuentas.filter(conSaldo).length,
      facturasVencidas: cuentas.filter((c) => conSaldo(c) && c.diasVencida > 0).length,
      porAntiguedad: Object.fromEntries(ANTIGUEDADES.map((a) => [a, pesos(porAntiguedad[a])])) as Record<Antiguedad, string>,
    },
    // Las mas vencidas primero.
    facturas: visibles.sort((a, b) => b.diasVencida - a.diasVencida),
  };
};

type DbContext = { orm: typeof db.orm };

export const getEstadoCuentaFactura = async (facturaId: string, client: DbContext = db) => {
  const factura = await getFacturaById(facturaId, client);
  const [pagos, notas] = await Promise.all([
    client.orm.public.Pagos.where({ facturaId }).orderBy((p) => p.fechaPago.desc()).all(),
    client.orm.public.NotasCredito.where({ facturaId }).orderBy((nc) => nc.fechaEmision.desc()).all(),
  ]);
  const acreditado = notas.filter((n) => n.estadoDian === "VALIDADA").reduce((t, n) => t + centavos(n.total), 0n);
  const pagado = pagos.reduce((t, p) => t + centavos(p.monto), 0n);
  const vencimiento = vencimientoDe(factura);
  const cuenta = estadoCuenta({
    total: factura.total,
    acreditado,
    pagado,
    vencimiento,
    hoy: hoyColombia(),
  });

  return {
    facturaId,
    total: factura.total,
    vencimiento: vencimiento.toString(),
    ...cuenta,
    pagos,
    notasCredito: notas.map((n) => ({ id: n.id, numero: n.numero, tipoAjuste: n.tipoAjuste, total: n.total, estadoDian: n.estadoDian })),
  };
};

export const registrarPago = async (facturaId: string, input: RegistrarPagoInput, registradoPor?: string) => {
  let fechaPago = nowInstant();

  if (input.fechaPago) {
    const fecha = Temporal.PlainDate.from(input.fechaPago);

    if (Temporal.PlainDate.compare(fecha, hoyColombia()) > 0) {
      throw badRequest("La fecha del pago no puede ser futura");
    }

    // Pagos con fecha anterior se registran al mediodia de ese dia en Colombia.
    fechaPago = fecha.toZonedDateTime({ timeZone: "America/Bogota", plainTime: "12:00" }).toInstant();
  }

  await db.transaction(async (tx) => {
    // Bloquea la fila de la factura hasta el commit: dos pagos simultaneos no pueden superar el saldo.
    await tx.orm.public.Facturas.where({ id: facturaId }).update({ updatedAt: nowInstant() });

    const cuenta = await getEstadoCuentaFactura(facturaId, tx);

    if (cuenta.estadoPago === "ANULADA") {
      throw badRequest("La factura fue anulada con una nota credito; no admite pagos");
    }

    const monto = centavos(input.monto.toFixed(2));

    if (monto > centavos(cuenta.saldo)) {
      throw badRequest(`El pago supera el saldo pendiente (${cuenta.saldo})`);
    }

    await tx.orm.public.Pagos.create({
      facturaId,
      registradoPor: registradoPor ?? null,
      fechaPago,
      monto: numeric<14, 2>(pesos(monto)),
      metodoPago: input.metodoPago,
      referencia: nullableVarchar<150>(input.referencia ?? null),
      observaciones: input.observaciones ?? null,
    });
  });

  return getEstadoCuentaFactura(facturaId);
};
