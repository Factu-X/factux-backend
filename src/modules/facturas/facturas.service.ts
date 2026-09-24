import { or } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { badRequest, conflict, notFound } from "../../shared/http-error.js";
import { numeric, nullableVarchar, varchar } from "../../shared/prisma-types.js";
import { nowInstant } from "../../shared/time.js";
import type { CreateFacturaInput, FacturasQuery } from "./facturas.schemas.js";

type DbContext = {
  orm: typeof db.orm;
};

const parsePlainDate = (value: string | undefined) => {
  if (!value) return null;

  try {
    return Temporal.PlainDate.from(value);
  } catch {
    throw badRequest("fechaVencimiento debe ser una fecha valida YYYY-MM-DD");
  }
};

const nextConsecutivo = async (client: DbContext) => {
  const latest = await client.orm.public.Facturas
    .orderBy((factura) => factura.consecutivo.desc())
    .limit(1)
    .first();

  return (latest?.consecutivo ?? 0) + 1;
};

const getFacturaByIdWithClient = async (id: string, client: DbContext = db) => {
  const factura = await client.orm.public.Facturas.first({ id });

  if (!factura) {
    throw notFound("Factura no encontrada");
  }

  return factura;
};

export const listFacturas = (query: FacturasQuery) => {
  if (query.search) {
    const search = `%${query.search}%`;

    return db.orm.public.Facturas
      .where((factura) => or(factura.numero.ilike(search), factura.cufe.ilike(search)))
      .orderBy((factura) => factura.fechaEmision.desc())
      .all();
  }

  return db.orm.public.Facturas.orderBy((factura) => factura.fechaEmision.desc()).all();
};

export const getFacturaById = (id: string) => getFacturaByIdWithClient(id);

export const listDetallesFactura = async (facturaId: string) => {
  await getFacturaByIdWithClient(facturaId);

  return db.orm.public.DetallesFactura
    .where({ facturaId })
    .orderBy((detalle) => detalle.createdAt.asc())
    .all();
};

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

    const consecutivo = await nextConsecutivo(tx);
    const prefijo = "FV";
    const numero = `${prefijo}-${consecutivo.toString().padStart(6, "0")}`;

    const factura = await tx.orm.public.Facturas.create({
      ordenId: orden.id,
      clienteId: orden.clienteId,
      creadaPor: creadaPor ?? null,
      prefijo: nullableVarchar<20>(prefijo),
      consecutivo,
      numero: varchar<50>(numero),
      fechaEmision: nowInstant(),
      fechaVencimiento: parsePlainDate(input.fechaVencimiento),
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

    await tx.orm.public.OrdenesServicio.where({ id: orden.id }).update({
      subtotal: numeric<14, 2>(orden.subtotal),
      impuestos: numeric<14, 2>(orden.impuestos),
      total: numeric<14, 2>(orden.total),
    });

    return getFacturaByIdWithClient(factura.id, tx);
  });
