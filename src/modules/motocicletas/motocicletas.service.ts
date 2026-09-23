import { and } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { isForeignKeyError, isUniqueConstraintError } from "../../shared/db-errors.js";
import { conflict, notFound } from "../../shared/http-error.js";
import { optionalVarchar, varchar } from "../../shared/prisma-types.js";
import { getClienteById } from "../clientes/clientes.service.js";
import type { CreateMotocicletaInput, UpdateMotocicletaInput } from "./motocicletas.schemas.js";

const findActiveMotocicletaByPlaca = (placa: string, exceptId?: string) =>
  db.orm.public.Motocicletas
    .where((motocicleta) =>
      and(
        motocicleta.activa.eq(true),
        motocicleta.placa.ilike(placa),
        exceptId ? motocicleta.id.neq(exceptId) : motocicleta.id.isNotNull(),
      ),
    )
    .first();

const toMotocicletaCreateData = (clienteId: string, input: CreateMotocicletaInput) => ({
  ...input,
  clienteId,
  placa: varchar<20>(input.placa),
  marca: varchar<100>(input.marca),
  modelo: varchar<100>(input.modelo),
});

const toMotocicletaUpdateData = (input: UpdateMotocicletaInput) => ({
  ...input,
  placa: optionalVarchar<20>(input.placa),
  marca: optionalVarchar<100>(input.marca),
  modelo: optionalVarchar<100>(input.modelo),
});

export const listMotocicletasByCliente = async (clienteId: string) => {
  await getClienteById(clienteId);

  return db.orm.public.Motocicletas
    .where({ clienteId })
    .orderBy((motocicleta) => motocicleta.placa.asc())
    .all();
};

export const getMotocicletaById = async (id: string) => {
  const motocicleta = await db.orm.public.Motocicletas.first({ id });

  if (!motocicleta) {
    throw notFound("Motocicleta no encontrada");
  }

  return motocicleta;
};

export const createMotocicleta = async (clienteId: string, input: CreateMotocicletaInput) => {
  await getClienteById(clienteId);

  const existing = await findActiveMotocicletaByPlaca(input.placa);

  if (existing) {
    throw conflict("Ya existe una motocicleta activa con esa placa");
  }

  try {
    return await db.orm.public.Motocicletas.create(toMotocicletaCreateData(clienteId, input));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Ya existe una motocicleta activa con esa placa");
    }

    if (isForeignKeyError(error)) {
      throw notFound("Cliente no encontrado");
    }

    throw error;
  }
};

export const updateMotocicleta = async (id: string, input: UpdateMotocicletaInput) => {
  await getMotocicletaById(id);

  if (input.placa) {
    const existing = await findActiveMotocicletaByPlaca(input.placa, id);

    if (existing) {
      throw conflict("Ya existe una motocicleta activa con esa placa");
    }
  }

  try {
    await db.orm.public.Motocicletas.where({ id }).update(toMotocicletaUpdateData(input));
    return await getMotocicletaById(id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Ya existe una motocicleta activa con esa placa");
    }

    throw error;
  }
};
