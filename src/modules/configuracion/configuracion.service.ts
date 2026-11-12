import { supabaseAdmin } from "../../config/supabase.js";
import { db } from "../../prisma/db.js";
import { badRequest, conflict, serviceUnavailable } from "../../shared/http-error.js";
import { nullableVarchar, varchar } from "../../shared/prisma-types.js";
import { hoyColombia } from "../../shared/time.js";
import type { RolUsuario } from "../auth/types.js";
import { leerCertificadoP12 } from "../dian/signer.js";
import {
  calcularDvNit,
  evaluarConfiguracion,
  SECRETOS,
  siguienteConsecutivo,
} from "./configuracion.rules.js";
import type { NumeracionConfig } from "./configuracion.rules.js";
import type {
  UpdateCertificadoInput,
  UpdateCredencialesInput,
  UpdateEmpresaInput,
  UpdateNumeracionInput,
} from "./configuracion.schemas.js";

export const BUCKET_PRIVADO = "factux-privado";
const CERTIFICADO_PATH = "dian/certificado.p12";

type DbContext = {
  orm: typeof db.orm;
};

export const requireSecretsClient = () => {
  if (!supabaseAdmin) {
    throw serviceUnavailable(
      "Las credenciales DIAN y los documentos requieren SUPABASE_SERVICE_ROLE_KEY en el backend",
    );
  }

  return supabaseAdmin;
};

// Sin service role no se puede consultar Vault: se reporta como "no configurado".
const listSecretosConfigurados = async () => {
  if (!supabaseAdmin) return new Set<string>();

  const { data, error } = await supabaseAdmin.rpc("factux_secretos_configurados");
  if (error) throw error;

  return new Set<string>((data as string[] | null) ?? []);
};

const guardarSecreto = async (nombre: string, valor: string) => {
  const { error } = await requireSecretsClient().rpc("factux_guardar_secreto", {
    p_nombre: nombre,
    p_valor: valor,
  });
  if (error) throw error;
};

export const leerSecreto = async (nombre: string) => {
  const { data, error } = await requireSecretsClient().rpc("factux_leer_secreto", {
    p_nombre: nombre,
  });
  if (error) throw error;

  return (data as string | null) ?? null;
};

const getEmpresa = (client: DbContext = db) =>
  client.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();

const getNumeracion = (empresaId: string, client: DbContext = db) =>
  client.orm.public.ConfiguracionDian.where({ empresaId }).first();

type NumeracionRow = NonNullable<Awaited<ReturnType<typeof getNumeracion>>>;

const toNumeracionConfig = (row: NumeracionRow): NumeracionConfig => ({
  ambiente: row.ambiente,
  numeroResolucion: row.numeroResolucion,
  fechaResolucion: row.fechaResolucion?.toString() ?? null,
  rangoDesde: row.rangoDesde,
  rangoHasta: row.rangoHasta,
  consecutivoActual: row.consecutivoActual,
  vigenciaDesde: row.vigenciaDesde?.toString() ?? null,
  vigenciaHasta: row.vigenciaHasta?.toString() ?? null,
  softwareId: row.softwareId,
  testSetId: row.testSetId,
  certificadoPath: row.certificadoPath,
  certificadoExpira: row.certificadoExpira?.toString() ?? null,
});

const cargarConfiguracion = async () => {
  // Los secretos (HTTPS a Vault) no dependen de la BD: se piden en paralelo para no sumar las esperas.
  const [{ empresa, numeracionRow }, secretos] = await Promise.all([
    getEmpresa().then(async (empresa) => ({
      empresa,
      numeracionRow: empresa ? await getNumeracion(empresa.id) : null,
    })),
    listSecretosConfigurados(),
  ]);
  const numeracion = numeracionRow ? toNumeracionConfig(numeracionRow) : null;
  const estado = evaluarConfiguracion(empresa, numeracion, secretos, hoyColombia());

  return { empresa, numeracionRow, numeracion, secretos, estado };
};

export const getConfiguracion = async (rol: RolUsuario) => {
  const { empresa, numeracionRow, numeracion, secretos, estado } = await cargarConfiguracion();
  const siguiente = numeracion ? siguienteConsecutivo(numeracion) : null;

  return {
    empresa,
    numeracion: numeracionRow && {
      ambiente: numeracionRow.ambiente,
      prefijoFacturacion: numeracionRow.prefijoFacturacion,
      numeroResolucion: numeracionRow.numeroResolucion,
      fechaResolucion: numeracionRow.fechaResolucion,
      rangoDesde: numeracionRow.rangoDesde,
      rangoHasta: numeracionRow.rangoHasta,
      vigenciaDesde: numeracionRow.vigenciaDesde,
      vigenciaHasta: numeracionRow.vigenciaHasta,
      consecutivoActual: numeracionRow.consecutivoActual,
      siguienteConsecutivo: siguiente,
      disponibles:
        siguiente !== null && numeracionRow.rangoHasta !== null
          ? Math.max(0, numeracionRow.rangoHasta - siguiente + 1)
          : 0,
    },
    // HU-13: las credenciales y el certificado solo los ve el administrador, y nunca su valor.
    credenciales:
      rol === "ADMINISTRADOR"
        ? {
            softwareId: numeracionRow?.softwareId ?? null,
            testSetId: numeracionRow?.testSetId ?? null,
            pinConfigurado: secretos.has(SECRETOS.pin),
            claveTecnicaConfigurada: secretos.has(SECRETOS.claveTecnica),
            certificadoCargado:
              !!numeracionRow?.certificadoPath && secretos.has(SECRETOS.certificadoPassword),
            certificadoExpira: numeracionRow?.certificadoExpira ?? null,
            servicioSecretosDisponible: !!supabaseAdmin,
          }
        : undefined,
    estado,
  };
};

// HU-06 emite con lo minimo; HU-07 (transmitir) exige ademas certificado y TestSetId.
export const getConfiguracionEmision = async ({ transmitir = false } = {}) => {
  const { empresa, numeracionRow, estado } = await cargarConfiguracion();
  const faltantes = transmitir
    ? [...estado.faltantesEmision, ...estado.faltantesTransmision]
    : estado.faltantesEmision;

  if (faltantes.length > 0 || !empresa || !numeracionRow) {
    throw badRequest(`La configuracion de facturacion esta incompleta: ${faltantes.join(", ")}`);
  }

  const [claveTecnica, pin] = await Promise.all([
    leerSecreto(SECRETOS.claveTecnica),
    leerSecreto(SECRETOS.pin),
  ]);

  if (!claveTecnica || !pin) {
    throw badRequest("La clave tecnica y el PIN del software son obligatorios para emitir");
  }

  return { empresa, numeracion: numeracionRow, claveTecnica, pin };
};

export const updateEmpresa = async (input: UpdateEmpresaInput) => {
  if (input.digitoVerificacion !== calcularDvNit(input.nit)) {
    throw badRequest("El digito de verificacion no corresponde al NIT");
  }

  const data = {
    nit: varchar<20>(input.nit),
    digitoVerificacion: nullableVarchar<1>(input.digitoVerificacion),
    razonSocial: varchar<200>(input.razonSocial),
    nombreComercial: nullableVarchar<200>(input.nombreComercial ?? null),
    tipoPersona: varchar<10>(input.tipoPersona),
    regimenFiscal: nullableVarchar<150>(input.regimenFiscal ?? null),
    responsabilidadesFiscales: nullableVarchar<100>(input.responsabilidadesFiscales),
    direccion: nullableVarchar<250>(input.direccion),
    ciudad: nullableVarchar<100>(input.ciudad),
    departamento: nullableVarchar<100>(input.departamento),
    codigoMunicipio: nullableVarchar<5>(input.codigoMunicipio),
    telefono: nullableVarchar<30>(input.telefono),
    email: nullableVarchar<200>(input.email),
  };

  const existing = await getEmpresa();

  if (existing) {
    await db.orm.public.ConfiguracionEmpresa.where({ id: existing.id }).update({
      ...data,
      updatedAt: Temporal.Now.instant(),
    });
  } else {
    await db.orm.public.ConfiguracionEmpresa.create({ ...data, singleton: true });
  }

  return getEmpresa();
};

const requireEmpresa = async (client: DbContext = db) => {
  const empresa = await getEmpresa(client);

  if (!empresa) {
    throw badRequest("Registre primero los datos de la empresa");
  }

  return empresa;
};

const requireNumeracion = async () => {
  const empresa = await requireEmpresa();
  const numeracion = await getNumeracion(empresa.id);

  if (!numeracion) {
    throw badRequest("Registre primero la resolucion y el rango de numeracion");
  }

  return numeracion;
};

const ultimoConsecutivoEmitido = async (prefijo: string | null, client: DbContext) => {
  const facturas = client.orm.public.Facturas;
  const ultima = await (prefijo === null
    ? facturas.where((factura) => factura.prefijo.isNull())
    : facturas.where({ prefijo: varchar<20>(prefijo) })
  )
    .orderBy((factura) => factura.consecutivo.desc())
    .limit(1)
    .first();

  return ultima?.consecutivo ?? 0;
};

export const updateNumeracion = async (input: UpdateNumeracionInput) =>
  db.transaction(async (tx) => {
    const empresa = await requireEmpresa(tx);
    const existing = await getNumeracion(empresa.id, tx);
    const prefijo = input.prefijoFacturacion ?? null;

    // El consecutivo nunca retrocede: ni por debajo de lo ya emitido con ese prefijo, ni del rango.
    const actualMismoPrefijo =
      existing && existing.prefijoFacturacion === prefijo ? (existing.consecutivoActual ?? 0) : 0;
    const consecutivoActual = Math.max(
      actualMismoPrefijo,
      await ultimoConsecutivoEmitido(prefijo, tx),
      input.rangoDesde - 1,
    );

    if (consecutivoActual > input.rangoHasta) {
      throw badRequest(
        `El rango hasta no puede ser menor al ultimo consecutivo emitido (${consecutivoActual})`,
      );
    }

    const data = {
      ambiente: input.ambiente,
      prefijoFacturacion: nullableVarchar<20>(prefijo),
      numeroResolucion: nullableVarchar<100>(input.numeroResolucion),
      fechaResolucion: Temporal.PlainDate.from(input.fechaResolucion),
      rangoDesde: input.rangoDesde,
      rangoHasta: input.rangoHasta,
      vigenciaDesde: Temporal.PlainDate.from(input.vigenciaDesde),
      vigenciaHasta: Temporal.PlainDate.from(input.vigenciaHasta),
      consecutivoActual,
    };

    if (!existing) {
      return tx.orm.public.ConfiguracionDian.create({ ...data, empresaId: empresa.id });
    }

    // Condicionado al consecutivo leido: si se emitio una factura entretanto, no se pisa.
    const updated = await (existing.consecutivoActual === null
      ? tx.orm.public.ConfiguracionDian.where({ id: existing.id })
      : tx.orm.public.ConfiguracionDian.where({
          id: existing.id,
          consecutivoActual: existing.consecutivoActual,
        })
    ).update({ ...data, updatedAt: Temporal.Now.instant() });

    if (!updated) {
      throw conflict("Se emitio una factura mientras guardaba. Recargue e intente de nuevo");
    }

    return updated;
  });

export const updateCredenciales = async (input: UpdateCredencialesInput) => {
  if (input.softwareId !== undefined || input.testSetId !== undefined) {
    const numeracion = await requireNumeracion();
    await db.orm.public.ConfiguracionDian.where({ id: numeracion.id }).update({
      ...(input.softwareId !== undefined && { softwareId: varchar<100>(input.softwareId) }),
      ...(input.testSetId !== undefined && { testSetId: nullableVarchar<100>(input.testSetId) }),
      updatedAt: Temporal.Now.instant(),
    });
  }

  if (input.pin) await guardarSecreto(SECRETOS.pin, input.pin);
  if (input.claveTecnica) await guardarSecreto(SECRETOS.claveTecnica, input.claveTecnica);
};

const abrirCertificado = async (archivo: Buffer, password: string) => {
  let certificado;
  try {
    certificado = await leerCertificadoP12(archivo, password);
  } catch {
    throw badRequest("El archivo no es un certificado .p12 valido o la contrasena no es correcta");
  }
  if (certificado.venceEl.getTime() < Date.now()) {
    throw badRequest("El certificado digital esta vencido");
  }
  return certificado;
};

// Certificado de firma para HU-07, descargado del bucket y abierto con la contrasena de Vault.
let certificadoCache: { clave: string; certificado: Awaited<ReturnType<typeof abrirCertificado>> } | null = null;

export const getCertificadoFirma = async (numeracion: { certificadoPath: string | null; updatedAt: Temporal.Instant }) => {
  if (!numeracion.certificadoPath) {
    throw badRequest("Cargue el certificado digital antes de transmitir");
  }

  // updatedAt cambia cada vez que se carga un certificado nuevo, asi el cache no queda viejo.
  const clave = `${numeracion.certificadoPath}:${numeracion.updatedAt.toString()}`;

  if (certificadoCache?.clave !== clave) {
    const { data, error } = await requireSecretsClient()
      .storage.from(BUCKET_PRIVADO)
      .download(numeracion.certificadoPath);
    if (error) throw error;

    const password = (await leerSecreto(SECRETOS.certificadoPassword)) ?? "";
    certificadoCache = {
      clave,
      certificado: await abrirCertificado(Buffer.from(await data.arrayBuffer()), password),
    };
  }

  return certificadoCache.certificado;
};

export const updateCertificado = async (input: UpdateCertificadoInput) => {
  const client = requireSecretsClient();
  const numeracion = await requireNumeracion();
  const archivo = Buffer.from(input.archivoBase64, "base64");

  await abrirCertificado(archivo, input.password);

  const { error } = await client.storage
    .from(BUCKET_PRIVADO)
    .upload(CERTIFICADO_PATH, archivo, { contentType: "application/x-pkcs12", upsert: true });
  if (error) throw error;

  await guardarSecreto(SECRETOS.certificadoPassword, input.password);
  await db.orm.public.ConfiguracionDian.where({ id: numeracion.id }).update({
    certificadoPath: CERTIFICADO_PATH,
    certificadoExpira: Temporal.PlainDate.from(input.expira),
    updatedAt: Temporal.Now.instant(),
  });
};
