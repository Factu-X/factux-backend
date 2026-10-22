import { and, or } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { badRequest, conflict, notFound } from "../../shared/http-error.js";
import { nullableVarchar, varchar } from "../../shared/prisma-types.js";
import { nowInstant } from "../../shared/time.js";
import {
  alertaBloqueante,
  evaluarResolucion,
  isResolucionCompleta,
  siguienteConsecutivo,
} from "../configuracion/configuracion.rules.js";
import type { CreateFacturaInput, FacturasQuery } from "./facturas.schemas.js";

type DbContext = {
  orm: typeof db.orm;
};

const hoyColombia = () => Temporal.Now.plainDateISO("America/Bogota");

const parsePlainDate = (value: string | undefined) => {
  if (!value) return null;

  try {
    return Temporal.PlainDate.from(value);
  } catch {
    throw badRequest("fechaVencimiento debe ser una fecha valida YYYY-MM-DD");
  }
};

// Toma el siguiente numero de la resolucion vigente. El UPDATE solo aplica si nadie mas
// avanzo el consecutivo entre la lectura y la escritura, asi dos facturas nunca comparten numero.
const reservarNumero = async (client: DbContext) => {
  const empresa = await client.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();
  const resolucion = empresa
    ? await client.orm.public.ConfiguracionDian.where({ empresaId: empresa.id }).first()
    : null;

  const bloqueo = alertaBloqueante(evaluarResolucion(resolucion, hoyColombia()));

  if (bloqueo || !isResolucionCompleta(resolucion)) {
    throw badRequest(bloqueo?.mensaje ?? "No hay resolucion de numeracion configurada");
  }

  const consecutivo = siguienteConsecutivo(resolucion);
  const actualizadas = await client.orm.public.ConfiguracionDian
    .where((dian) =>
      and(
        dian.id.eq(resolucion.id),
        resolucion.consecutivoActual === null
          ? dian.consecutivoActual.isNull()
          : dian.consecutivoActual.eq(resolucion.consecutivoActual),
      ),
    )
    .updateAndCount({ consecutivoActual: consecutivo });

  if (actualizadas === 0) {
    throw conflict("Otra factura tomo este numero al mismo tiempo; intenta de nuevo");
  }

  const prefijo = resolucion.prefijoFacturacion ?? "";

  return { prefijo, consecutivo, numero: `${prefijo}${consecutivo}` };
};

const facturasResumen = () =>
  db.orm.public.Facturas
    .include("cliente", (cliente) =>
      cliente.select("id", "tipoIdentificacion", "numeroIdentificacion", "nombreRazonSocial"),
    )
    .include("orden", (orden) =>
      orden
        .select("id", "numero", "motocicletaId")
        .include("motocicleta", (moto) => moto.select("id", "placa", "marca", "modelo")),
    );

const getFacturaCompleta = async (id: string, client: DbContext = db) => {
  const factura = await client.orm.public.Facturas
    .include("cliente")
    .include("orden", (orden) =>
      orden
        .select("id", "numero", "fechaIngreso", "kilometrajeIngreso", "motivoIngreso", "motocicletaId")
        .include("motocicleta"),
    )
    .include("detallesFacturas", (detalle) =>
      detalle
        .include("detalleOrden", (detalleOrden) => detalleOrden.select("tipoItem", "tratamientoIva"))
        .orderBy((d) => d.createdAt.asc()),
    )
    .where({ id })
    .first();

  if (!factura) {
    throw notFound("Factura no encontrada");
  }

  return factura;
};

export const listFacturas = (query: FacturasQuery) => {
  const search = query.search ? `%${query.search}%` : null;

  return facturasResumen()
    .where((factura) =>
      and(
        search ? or(factura.numero.ilike(search), factura.cufe.ilike(search)) : factura.id.isNotNull(),
        query.estadoDian ? factura.estadoDian.eq(query.estadoDian) : factura.id.isNotNull(),
        query.clienteId ? factura.clienteId.eq(query.clienteId) : factura.id.isNotNull(),
        query.formaPago ? factura.formaPago.eq(query.formaPago) : factura.id.isNotNull(),
      ),
    )
    .orderBy((factura) => factura.fechaEmision.desc())
    .limit(query.limit)
    .offset(query.offset)
    .all();
};

export const getFacturaById = (id: string) => getFacturaCompleta(id);

export const listDetallesFactura = async (facturaId: string) =>
  (await getFacturaCompleta(facturaId)).detallesFacturas;

export const createFacturaFromOrden = async (input: CreateFacturaInput, creadaPor?: string) =>
  db.transaction(async (tx) => {
    const orden = await tx.orm.public.OrdenesServicio.first({ id: input.ordenId });

    if (!orden) {
      throw notFound("Orden de servicio no encontrada");
    }

    if (orden.estado !== "FINALIZADA") {
      throw badRequest("Solo se puede generar factura de una orden FINALIZADA");
    }

    const existing = await tx.orm.public.Facturas.where({ ordenId: input.ordenId }).first();

    if (existing) {
      throw conflict("La orden ya tiene una factura asociada");
    }

    const detallesOrden = await tx.orm.public.DetallesOrden.where({ ordenId: input.ordenId }).all();

    if (detallesOrden.length === 0) {
      throw badRequest("No se puede facturar una orden sin detalles");
    }

    const fechaVencimiento = parsePlainDate(input.fechaVencimiento);

    if (fechaVencimiento && Temporal.PlainDate.compare(fechaVencimiento, hoyColombia()) < 0) {
      throw badRequest("fechaVencimiento no puede ser anterior a hoy");
    }

    const { prefijo, consecutivo, numero } = await reservarNumero(tx);

    const factura = await tx.orm.public.Facturas.create({
      ordenId: orden.id,
      clienteId: orden.clienteId,
      creadaPor: creadaPor ?? null,
      prefijo: nullableVarchar<20>(prefijo || null),
      consecutivo,
      numero: varchar<50>(numero),
      fechaEmision: nowInstant(),
      fechaVencimiento: input.formaPago === "CREDITO" ? fechaVencimiento : null,
      formaPago: input.formaPago,
      subtotal: orden.subtotal,
      impuestos: orden.impuestos,
      total: orden.total,
      cufe: null,
      estadoDian: "PENDIENTE_ENVIO",
      xmlPath: null,
      pdfPath: null,
    });

    for (const detalle of detallesOrden) {
      await tx.orm.public.DetallesFactura.create({
        facturaId: factura.id,
        detalleOrdenId: detalle.id,
        codigoItem: nullableVarchar<50>(detalle.codigoItem),
        descripcion: varchar<250>(detalle.nombreItem),
        cantidad: detalle.cantidad,
        precioUnitario: detalle.precioUnitario,
        tarifaIva: detalle.tarifaIva,
        subtotal: detalle.subtotal,
        impuesto: detalle.impuesto,
        total: detalle.total,
      });
    }

    return getFacturaCompleta(factura.id, tx);
  });
