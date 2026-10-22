import { env } from "../../config/env.js";
import { db } from "../../prisma/db.js";
import { badRequest } from "../../shared/http-error.js";
import { nullableVarchar, varchar } from "../../shared/prisma-types.js";
import {
  evaluarResolucion,
  isResolucionCompleta,
  numerosDisponibles,
  siguienteConsecutivo,
} from "./configuracion.rules.js";
import type { UpdateEmpresaInput, UpdateResolucionInput } from "./configuracion.schemas.js";

const hoyColombia = () => Temporal.Now.plainDateISO("America/Bogota");

const getEmpresa = () => db.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();

const getResolucion = (empresaId: string) =>
  db.orm.public.ConfiguracionDian.where({ empresaId }).first();

// Solo se informa si cada parametro existe; los valores nunca salen del backend.
const estadoSoftware = () => ({
  softwareId: !!env.DIAN_SOFTWARE_ID,
  pin: !!env.DIAN_SOFTWARE_PIN,
  claveTecnica: !!env.DIAN_CLAVE_TECNICA,
  certificado: !!env.DIAN_CERT_PATH,
});

export const getConfiguracion = async () => {
  const empresa = await getEmpresa();
  const resolucion = empresa ? await getResolucion(empresa.id) : null;

  return {
    empresa,
    resolucion: resolucion && {
      id: resolucion.id,
      ambiente: resolucion.ambiente,
      prefijoFacturacion: resolucion.prefijoFacturacion,
      numeroResolucion: resolucion.numeroResolucion,
      fechaResolucion: resolucion.fechaResolucion,
      rangoDesde: resolucion.rangoDesde,
      rangoHasta: resolucion.rangoHasta,
      consecutivoActual: resolucion.consecutivoActual,
      vigenciaDesde: resolucion.vigenciaDesde,
      vigenciaHasta: resolucion.vigenciaHasta,
      certificadoExpira: resolucion.certificadoExpira,
      siguienteNumero: isResolucionCompleta(resolucion) ? siguienteConsecutivo(resolucion) : null,
      disponibles: isResolucionCompleta(resolucion) ? numerosDisponibles(resolucion) : null,
    },
    software: estadoSoftware(),
    alertas: evaluarResolucion(resolucion, hoyColombia()),
  };
};

export const updateEmpresa = async (input: UpdateEmpresaInput) => {
  const data = {
    nit: varchar<20>(input.nit),
    digitoVerificacion: nullableVarchar<1>(input.digitoVerificacion),
    razonSocial: varchar<200>(input.razonSocial),
    direccion: nullableVarchar<250>(input.direccion ?? null),
    telefono: nullableVarchar<30>(input.telefono ?? null),
    email: nullableVarchar<200>(input.email ?? null),
    regimenFiscal: nullableVarchar<150>(input.regimenFiscal ?? null),
    updatedAt: Temporal.Now.instant(),
  };

  const existing = await getEmpresa();

  if (existing) {
    await db.orm.public.ConfiguracionEmpresa.where({ id: existing.id }).update(data);
  } else {
    await db.orm.public.ConfiguracionEmpresa.create({ singleton: true, ...data });
  }

  return getConfiguracion();
};

export const updateResolucion = async (input: UpdateResolucionInput) => {
  const empresa = await getEmpresa();

  if (!empresa) {
    throw badRequest("Registra primero los datos de la empresa");
  }

  const existing = await getResolucion(empresa.id);

  // Una resolucion o prefijo distinto empieza su propio rango desde cero.
  const esNuevaResolucion =
    !existing ||
    existing.numeroResolucion !== input.numeroResolucion ||
    existing.prefijoFacturacion !== input.prefijoFacturacion;
  const consecutivoActual = esNuevaResolucion ? null : existing.consecutivoActual;

  if (consecutivoActual !== null && input.rangoHasta < consecutivoActual) {
    throw badRequest(
      `Ya se emitio el numero ${consecutivoActual}; rangoHasta no puede ser menor`,
    );
  }

  if (consecutivoActual !== null && input.rangoDesde > consecutivoActual) {
    throw badRequest(
      `Ya se emitio el numero ${consecutivoActual}; rangoDesde no puede ser mayor`,
    );
  }

  const data = {
    ambiente: input.ambiente,
    prefijoFacturacion: nullableVarchar<20>(input.prefijoFacturacion),
    numeroResolucion: nullableVarchar<100>(input.numeroResolucion),
    fechaResolucion: Temporal.PlainDate.from(input.fechaResolucion),
    rangoDesde: input.rangoDesde,
    rangoHasta: input.rangoHasta,
    consecutivoActual,
    vigenciaDesde: Temporal.PlainDate.from(input.vigenciaDesde),
    vigenciaHasta: Temporal.PlainDate.from(input.vigenciaHasta),
    updatedAt: Temporal.Now.instant(),
  };

  if (existing) {
    await db.orm.public.ConfiguracionDian.where({ id: existing.id }).update(data);
  } else {
    await db.orm.public.ConfiguracionDian.create({ empresaId: empresa.id, ...data });
  }

  return getConfiguracion();
};
