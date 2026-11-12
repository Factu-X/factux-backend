import { or } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { isUniqueConstraintError } from "../../shared/db-errors.js";
import { conflict, notFound } from "../../shared/http-error.js";
import { nullableVarchar, varchar } from "../../shared/prisma-types.js";
import type { ClientesQuery, CreateClienteInput, UpdateClienteInput } from "./clientes.schemas.js";

const findClienteByNumeroIdentificacion = (numeroIdentificacion: string) =>
  db.orm.public.Clientes
    .where({ numeroIdentificacion: varchar<30>(numeroIdentificacion) })
    .first();

const toClienteCreateData = (input: CreateClienteInput) => ({
  ...input,
  numeroIdentificacion: varchar<30>(input.numeroIdentificacion),
  digitoVerificacion: nullableVarchar<1>(input.digitoVerificacion),
  nombreRazonSocial: varchar<200>(input.nombreRazonSocial),
  direccion: nullableVarchar<250>(input.direccion),
  telefono: nullableVarchar<30>(input.telefono),
  email: nullableVarchar<200>(input.email),
});

const toClienteUpdateData = (input: UpdateClienteInput) => ({
  ...input,
  numeroIdentificacion:
    input.numeroIdentificacion === undefined
      ? undefined
      : varchar<30>(input.numeroIdentificacion),
  digitoVerificacion: nullableVarchar<1>(input.digitoVerificacion),
  nombreRazonSocial:
    input.nombreRazonSocial === undefined ? undefined : varchar<200>(input.nombreRazonSocial),
  direccion: nullableVarchar<250>(input.direccion),
  telefono: nullableVarchar<30>(input.telefono),
  email: nullableVarchar<200>(input.email),
});

// Cada cliente trae sus motos en la misma consulta: la pantalla las necesita y pedirlas una por una era un N+1.
const clientesConMotos = () =>
  db.orm.public.Clientes.include("motocicletas", (moto) => moto.orderBy((m) => m.placa.asc()));

export const listClientes = (query: ClientesQuery) => {
  if (query.search) {
    const search = `%${query.search}%`;

    return clientesConMotos()
      .where((cliente) =>
        or(
          cliente.numeroIdentificacion.ilike(search),
          cliente.nombreRazonSocial.ilike(search),
        ),
      )
      .orderBy((cliente) => cliente.nombreRazonSocial.asc())
      .all();
  }

  return clientesConMotos().orderBy((cliente) => cliente.nombreRazonSocial.asc()).all();
};

export const getClienteById = async (id: string) => {
  const cliente = await db.orm.public.Clientes.first({ id });

  if (!cliente) {
    throw notFound("Cliente no encontrado");
  }

  return cliente;
};

export const createCliente = async (input: CreateClienteInput) => {
  const existing = await findClienteByNumeroIdentificacion(input.numeroIdentificacion);

  if (existing) {
    throw conflict("Ya existe un cliente con ese numero de identificacion");
  }

  try {
    return await db.orm.public.Clientes.create(toClienteCreateData(input));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Ya existe un cliente con ese numero de identificacion");
    }

    throw error;
  }
};

export const updateCliente = async (id: string, input: UpdateClienteInput) => {
  await getClienteById(id);

  if (input.numeroIdentificacion) {
    const existing = await findClienteByNumeroIdentificacion(input.numeroIdentificacion);

    if (existing && existing.id !== id) {
      throw conflict("Ya existe un cliente con ese numero de identificacion");
    }
  }

  try {
    await db.orm.public.Clientes.where({ id }).update(toClienteUpdateData(input));
    return await getClienteById(id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("Ya existe un cliente con ese numero de identificacion");
    }

    throw error;
  }
};
