import { and, or } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { isUniqueConstraintError } from "../../shared/db-errors.js";
import { conflict, notFound } from "../../shared/http-error.js";
import { numeric, varchar } from "../../shared/prisma-types.js";
import type {
  CatalogoQuery,
  CreateCatalogoItemInput,
  UpdateCatalogoItemInput,
} from "./catalogo.schemas.js";

const findCatalogoItemByCodigo = (codigo: string) =>
  db.orm.public.ItemsCatalogo.where({ codigo: varchar<50>(codigo) }).first();

const toCatalogoCreateData = (input: CreateCatalogoItemInput) => ({
  ...input,
  codigo: varchar<50>(input.codigo),
  nombre: varchar<200>(input.nombre),
  precioVenta: numeric<14, 2>(input.precioVenta),
  tarifaIva: numeric<5, 2>(input.tarifaIva),
});

const toCatalogoUpdateData = (input: UpdateCatalogoItemInput) => ({
  ...input,
  codigo: input.codigo === undefined ? undefined : varchar<50>(input.codigo),
  nombre: input.nombre === undefined ? undefined : varchar<200>(input.nombre),
  precioVenta: input.precioVenta === undefined ? undefined : numeric<14, 2>(input.precioVenta),
  tarifaIva: input.tarifaIva === undefined ? undefined : numeric<5, 2>(input.tarifaIva),
});

export const listCatalogo = (query: CatalogoQuery) => {
  if (query.tipo || query.activo !== undefined || query.search) {
    const search = query.search ? `%${query.search}%` : null;

    return db.orm.public.ItemsCatalogo
      .where((item) =>
        and(
          query.tipo ? item.tipo.eq(query.tipo) : item.id.isNotNull(),
          query.activo !== undefined ? item.activo.eq(query.activo) : item.id.isNotNull(),
          search
            ? or(item.codigo.ilike(search), item.nombre.ilike(search), item.descripcion.ilike(search))
            : item.id.isNotNull(),
        ),
      )
      .orderBy([(item) => item.tipo.asc(), (item) => item.nombre.asc()])
      .all();
  }

  return db.orm.public.ItemsCatalogo
    .orderBy([(item) => item.tipo.asc(), (item) => item.nombre.asc()])
    .all();
};

export const getCatalogoItemById = async (id: string) => {
  const item = await db.orm.public.ItemsCatalogo.first({ id });

  if (!item) {
    throw notFound("Item de catalogo no encontrado");
  }

  return item;
};

export const createCatalogoItem = async (input: CreateCatalogoItemInput) => {
  const existing = await findCatalogoItemByCodigo(input.codigo);

  if (existing) {
    throw conflict("Ya existe un item de catalogo con ese codigo");
  }

  try {
    return await db.orm.public.ItemsCatalogo.create(toCatalogoCreateData(input));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Ya existe un item de catalogo con ese codigo");
    }

    throw error;
  }
};

export const updateCatalogoItem = async (id: string, input: UpdateCatalogoItemInput) => {
  await getCatalogoItemById(id);

  if (input.codigo) {
    const existing = await findCatalogoItemByCodigo(input.codigo);

    if (existing && existing.id !== id) {
      throw conflict("Ya existe un item de catalogo con ese codigo");
    }
  }

  try {
    await db.orm.public.ItemsCatalogo.where({ id }).update(toCatalogoUpdateData(input));
    return await getCatalogoItemById(id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Ya existe un item de catalogo con ese codigo");
    }

    throw error;
  }
};
