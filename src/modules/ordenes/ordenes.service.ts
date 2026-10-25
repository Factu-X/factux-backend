import { randomBytes } from "node:crypto";

import { and } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { isForeignKeyError, isUniqueConstraintError } from "../../shared/db-errors.js";
import { badRequest, conflict, notFound } from "../../shared/http-error.js";
import { numeric, varchar } from "../../shared/prisma-types.js";
import { nowInstant, parseInstant } from "../../shared/time.js";
import { calculateDetalle, sumCalculatedDetalles } from "./ordenes.calculations.js";
import {
  assertOrdenEditable,
  assertOrdenFinalizable,
  assertTransicionOrden,
} from "./ordenes.policy.js";
import type {
  CreateOrdenDetalleInput,
  CreateOrdenInput,
  OrdenesQuery,
  UpdateOrdenDetalleInput,
  UpdateOrdenInput,
} from "./ordenes.schemas.js";

type DbContext = {
  orm: typeof db.orm;
};

const generateOrdenNumero = () => {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = randomBytes(2).toString("hex").toUpperCase();

  return varchar<50>(`OS-${timestamp}-${suffix}`);
};

const assertMotocicletaBelongsToCliente = async (
  clienteId: string,
  motocicletaId: string,
  client: DbContext = db,
) => {
  const cliente = await client.orm.public.Clientes.first({ id: clienteId });

  if (!cliente) {
    throw notFound("Cliente no encontrado");
  }

  const motocicleta = await client.orm.public.Motocicletas.first({ id: motocicletaId });

  if (!motocicleta) {
    throw notFound("Motocicleta no encontrada");
  }

  if (motocicleta.clienteId !== clienteId) {
    throw badRequest("La motocicleta no pertenece al cliente seleccionado");
  }

  return motocicleta;
};

const updateMotocicletaKilometraje = async (
  motocicletaId: string,
  kilometrajeIngreso: number,
  client: DbContext,
) => {
  const motocicleta = await client.orm.public.Motocicletas.first({ id: motocicletaId });

  if (!motocicleta) {
    throw notFound("Motocicleta no encontrada");
  }

  if (motocicleta.kilometrajeActual === null || kilometrajeIngreso > motocicleta.kilometrajeActual) {
    await client.orm.public.Motocicletas
      .where({ id: motocicletaId })
      .update({ kilometrajeActual: kilometrajeIngreso });
  }
};

const getOrdenByIdWithClient = async (id: string, client: DbContext = db) => {
  const orden = await client.orm.public.OrdenesServicio.first({ id });

  if (!orden) {
    throw notFound("Orden de servicio no encontrada");
  }

  return orden;
};

const getDetalleByIdWithClient = async (ordenId: string, detalleId: string, client: DbContext) => {
  const detalle = await client.orm.public.DetallesOrden
    .where({ id: detalleId, ordenId })
    .first();

  if (!detalle) {
    throw notFound("Detalle de orden no encontrado");
  }

  return detalle;
};

const buildDetalleSnapshot = async (input: CreateOrdenDetalleInput, client: DbContext = db) => {
  const item = await client.orm.public.ItemsCatalogo.first({ id: input.itemCatalogoId });

  if (!item) {
    throw notFound("Item de catalogo no encontrado");
  }

  if (!item.activo) {
    throw badRequest("No se pueden agregar items de catalogo inactivos a una orden");
  }

  const precioUnitario = input.precioAplicado ?? item.precioVenta;
  const totals = calculateDetalle({
    cantidad: input.cantidad,
    precioUnitario,
    tratamientoIva: item.tratamientoIva,
    tarifaIva: item.tarifaIva,
  });

  return {
    itemCatalogoId: item.id,
    codigoItem: varchar<50>(item.codigo),
    nombreItem: varchar<200>(item.nombre),
    tipoItem: item.tipo,
    cantidad: numeric<10, 2>(totals.cantidad),
    precioUnitario: numeric<14, 2>(totals.precioUnitario),
    tratamientoIva: item.tratamientoIva,
    tarifaIva: numeric<5, 2>(totals.tarifaIva),
    subtotal: numeric<14, 2>(totals.subtotal),
    impuesto: numeric<14, 2>(totals.impuesto),
    total: numeric<14, 2>(totals.total),
  };
};

// Cliente y moto viajan con la orden para que listados e historial no hagan N+1 requests.
const ordenesConRelaciones = () =>
  db.orm.public.OrdenesServicio.include("cliente").include("motocicleta");

export const listOrdenes = (query: OrdenesQuery) => {
  if (query.estado || query.clienteId || query.motocicletaId) {
    return ordenesConRelaciones()
      .where((orden) =>
        and(
          query.estado ? orden.estado.eq(query.estado) : orden.id.isNotNull(),
          query.clienteId ? orden.clienteId.eq(query.clienteId) : orden.id.isNotNull(),
          query.motocicletaId
            ? orden.motocicletaId.eq(query.motocicletaId)
            : orden.id.isNotNull(),
        ),
      )
      .orderBy((orden) => orden.fechaIngreso.desc())
      .all();
  }

  return ordenesConRelaciones().orderBy((orden) => orden.fechaIngreso.desc()).all();
};

export const getOrdenById = async (id: string) => {
  const orden = await ordenesConRelaciones().where({ id }).first();

  if (!orden) {
    throw notFound("Orden de servicio no encontrada");
  }

  return orden;
};

export const listDetallesOrden = async (ordenId: string) => {
  await getOrdenByIdWithClient(ordenId);

  return db.orm.public.DetallesOrden
    .where({ ordenId })
    .orderBy((detalle) => detalle.createdAt.asc())
    .all();
};

export const recalcularTotalesOrden = async (ordenId: string, client: DbContext = db) => {
  const detalles = await client.orm.public.DetallesOrden.where({ ordenId }).all();
  const totals = sumCalculatedDetalles(
    detalles.map((detalle) => ({
      subtotal: detalle.subtotal,
      impuesto: detalle.impuesto,
      total: detalle.total,
    })),
  );

  await client.orm.public.OrdenesServicio.where({ id: ordenId }).update({
    subtotal: numeric<14, 2>(totals.subtotal),
    impuestos: numeric<14, 2>(totals.impuestos),
    total: numeric<14, 2>(totals.total),
  });

  return totals;
};

export const createOrden = async (input: CreateOrdenInput, creadaPor?: string) => {
  try {
    return await db.transaction(async (tx) => {
      await assertMotocicletaBelongsToCliente(input.clienteId, input.motocicletaId, tx);

      const estado = input.estado ?? "ABIERTA";
      const orden = await tx.orm.public.OrdenesServicio.create({
        numero: generateOrdenNumero(),
        clienteId: input.clienteId,
        motocicletaId: input.motocicletaId,
        creadaPor: creadaPor ?? null,
        fechaIngreso: input.fechaIngreso
          ? parseInstant(input.fechaIngreso, "fechaIngreso")
          : nowInstant(),
        kilometrajeIngreso: input.kilometrajeIngreso,
        motivoIngreso: input.motivoIngreso,
        observaciones: input.observaciones ?? null,
        estado,
        subtotal: numeric<14, 2>("0.00"),
        impuestos: numeric<14, 2>("0.00"),
        total: numeric<14, 2>("0.00"),
        finalizadaAt: null,
      });

      for (const detalleInput of input.detalles ?? []) {
        const detalle = await buildDetalleSnapshot(detalleInput, tx);
        await tx.orm.public.DetallesOrden.create({ ...detalle, ordenId: orden.id });
      }

      await recalcularTotalesOrden(orden.id, tx);
      await updateMotocicletaKilometraje(input.motocicletaId, input.kilometrajeIngreso, tx);

      return getOrdenByIdWithClient(orden.id, tx);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Ya existe una orden de servicio con ese numero");
    }

    if (isForeignKeyError(error)) {
      throw badRequest("Cliente, motocicleta, usuario o item de catalogo invalido");
    }

    throw error;
  }
};

export const updateOrden = async (id: string, input: UpdateOrdenInput) =>
  db.transaction(async (tx) => {
    const existing = await getOrdenByIdWithClient(id, tx);
    assertOrdenEditable(existing.estado);

    const clienteId = input.clienteId ?? existing.clienteId;
    const motocicletaId = input.motocicletaId ?? existing.motocicletaId;

    await assertMotocicletaBelongsToCliente(clienteId, motocicletaId, tx);

    const nextEstado = input.estado ?? existing.estado;
    assertTransicionOrden(existing.estado, nextEstado);

    if (nextEstado === "FINALIZADA") {
      const detalles = await tx.orm.public.DetallesOrden.where({ ordenId: id }).all();
      assertOrdenFinalizable(detalles.length);
    }

    await tx.orm.public.OrdenesServicio.where({ id }).update({
      clienteId,
      motocicletaId,
      fechaIngreso:
        input.fechaIngreso === undefined
          ? undefined
          : parseInstant(input.fechaIngreso, "fechaIngreso"),
      kilometrajeIngreso: input.kilometrajeIngreso,
      motivoIngreso: input.motivoIngreso,
      observaciones: input.observaciones,
      estado: input.estado,
      finalizadaAt:
        input.estado === "FINALIZADA"
          ? nowInstant()
          : input.estado === undefined
            ? undefined
            : null,
    });

    await recalcularTotalesOrden(id, tx);

    if (input.kilometrajeIngreso !== undefined || input.motocicletaId !== undefined) {
      await updateMotocicletaKilometraje(
        motocicletaId,
        input.kilometrajeIngreso ?? existing.kilometrajeIngreso,
        tx,
      );
    }

    return getOrdenByIdWithClient(id, tx);
  });

export const addDetalleOrden = async (ordenId: string, input: CreateOrdenDetalleInput) =>
  db.transaction(async (tx) => {
    const orden = await getOrdenByIdWithClient(ordenId, tx);
    assertOrdenEditable(orden.estado);

    const detalle = await buildDetalleSnapshot(input, tx);
    await tx.orm.public.DetallesOrden.create({ ...detalle, ordenId });
    await recalcularTotalesOrden(ordenId, tx);

    return getOrdenByIdWithClient(ordenId, tx);
  });

export const updateDetalleOrden = async (
  ordenId: string,
  detalleId: string,
  input: UpdateOrdenDetalleInput,
) =>
  db.transaction(async (tx) => {
    const orden = await getOrdenByIdWithClient(ordenId, tx);
    assertOrdenEditable(orden.estado);

    const existing = await getDetalleByIdWithClient(ordenId, detalleId, tx);
    const totals = calculateDetalle({
      cantidad: input.cantidad ?? existing.cantidad,
      precioUnitario: input.precioAplicado ?? existing.precioUnitario,
      tratamientoIva: existing.tratamientoIva,
      tarifaIva: existing.tarifaIva,
    });

    await tx.orm.public.DetallesOrden.where({ id: detalleId, ordenId }).update({
      cantidad: numeric<10, 2>(totals.cantidad),
      precioUnitario: numeric<14, 2>(totals.precioUnitario),
      subtotal: numeric<14, 2>(totals.subtotal),
      impuesto: numeric<14, 2>(totals.impuesto),
      total: numeric<14, 2>(totals.total),
    });

    await recalcularTotalesOrden(ordenId, tx);

    return getDetalleByIdWithClient(ordenId, detalleId, tx);
  });

export const deleteDetalleOrden = async (ordenId: string, detalleId: string) =>
  db.transaction(async (tx) => {
    const orden = await getOrdenByIdWithClient(ordenId, tx);
    assertOrdenEditable(orden.estado);
    await getDetalleByIdWithClient(ordenId, detalleId, tx);

    await tx.orm.public.DetallesOrden.where({ id: detalleId, ordenId }).delete();
    await recalcularTotalesOrden(ordenId, tx);

    return getOrdenByIdWithClient(ordenId, tx);
  });
