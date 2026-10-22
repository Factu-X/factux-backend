import { and, or } from "@prisma/orm-postgres/orm-client";

import { env } from "../../config/env.js";
import { db } from "../../prisma/db.js";
import { badRequest, conflict, serviceUnavailable } from "../../shared/http-error.js";
import { nullableVarchar } from "../../shared/prisma-types.js";
import { nowInstant } from "../../shared/time.js";
import { getFacturaById } from "../facturas/facturas.service.js";
import { SimuladorDianGateway, type DianGateway, type ResultadoDian } from "./gateway.js";
import { renderFacturaPdf } from "./pdf.js";
import { cargarCertificado, firmarXml, type Certificado } from "./signer.js";
import { guardarDocumento, leerDocumento } from "./storage.js";
import {
  construirFacturaXml,
  fechaHoraColombia,
  TIPO_DOCUMENTO,
  type DocumentoFactura,
  type Linea,
  type Parte,
} from "./ubl.js";

type FacturaCompleta = Awaited<ReturnType<typeof getFacturaById>>;

const CONSUMIDOR_FINAL = "222222222222";

let certificadoCache: { path: string; certificado: Certificado } | null = null;

export const obtenerCertificado = async () => {
  const path = env.DIAN_CERT_PATH!;

  if (certificadoCache?.path !== path) {
    try {
      certificadoCache = { path, certificado: await cargarCertificado(path, env.DIAN_CERT_PASSWORD ?? "") };
    } catch (error) {
      throw badRequest(
        `No se pudo leer el certificado de firma (${error instanceof Error ? error.message : "error desconocido"})`,
      );
    }
  }

  return certificadoCache.certificado;
};

export const parametrosFaltantes = () =>
  [
    ["DIAN_SOFTWARE_ID", env.DIAN_SOFTWARE_ID],
    ["DIAN_SOFTWARE_PIN", env.DIAN_SOFTWARE_PIN],
    ["DIAN_CLAVE_TECNICA", env.DIAN_CLAVE_TECNICA],
    ["DIAN_CERT_PATH", env.DIAN_CERT_PATH],
  ]
    .filter(([, valor]) => !valor)
    .map(([nombre]) => nombre);

// Unico lugar que decide a que DIAN se habla. Hoy siempre es el simulador.
export const getGateway = (): DianGateway => new SimuladorDianGateway(env.DIAN_CLAVE_TECNICA!, env.DIAN_SOFTWARE_PIN!);

export const validarParametrosDian = () => {
  const faltantes = parametrosFaltantes();

  if (faltantes.length > 0) {
    throw badRequest(`Faltan parametros DIAN en el servidor: ${faltantes.join(", ")}`);
  }
};

export const parteAdquirente = (cliente: FacturaCompleta["cliente"]): Parte => ({
  tipoPersona: cliente.tipoIdentificacion === "NIT" ? "1" : "2",
  tipoDocumento: TIPO_DOCUMENTO[cliente.tipoIdentificacion],
  numeroDocumento: cliente.numeroIdentificacion,
  digitoVerificacion: cliente.digitoVerificacion,
  nombre: cliente.numeroIdentificacion === CONSUMIDOR_FINAL ? "Consumidor final" : cliente.nombreRazonSocial,
  responsabilidades: "R-99-PN",
  responsableIva: false,
  ubicacion: null,
  telefono: cliente.telefono,
  email: cliente.email,
});

export const lineasFactura = (factura: FacturaCompleta): Linea[] =>
  factura.detallesFacturas.map((detalle) => ({
    codigo: detalle.codigoItem,
    descripcion: detalle.descripcion,
    cantidad: detalle.cantidad,
    precioUnitario: detalle.precioUnitario,
    subtotal: detalle.subtotal,
    impuesto: detalle.impuesto,
    tarifaIva: detalle.tarifaIva,
    tratamientoIva:
      detalle.detalleOrden?.tratamientoIva ?? (Number(detalle.tarifaIva) > 0 ? "GRAVADO" : "EXCLUIDO"),
  }));

// Emisor, software y ambiente: lo comun a facturas y notas credito.
export const cargarEmisor = async () => {
  const empresa = await db.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();
  const resolucion = empresa
    ? await db.orm.public.ConfiguracionDian.where({ empresaId: empresa.id }).first()
    : null;

  if (!empresa?.digitoVerificacion || !resolucion?.numeroResolucion) {
    throw badRequest("Completa los datos de la empresa y la resolucion antes de enviar a la DIAN");
  }

  const emisor: Parte = {
    tipoPersona: env.EMISOR_TIPO_PERSONA,
    tipoDocumento: TIPO_DOCUMENTO.NIT,
    numeroDocumento: empresa.nit,
    digitoVerificacion: empresa.digitoVerificacion,
    nombre: empresa.razonSocial,
    responsabilidades: env.EMISOR_RESPONSABILIDADES,
    responsableIva: empresa.regimenFiscal === "Responsable de IVA",
    ubicacion: {
      municipioCodigo: env.EMISOR_MUNICIPIO_CODIGO,
      ciudad: env.EMISOR_CIUDAD,
      departamento: env.EMISOR_DEPARTAMENTO,
      departamentoCodigo: env.EMISOR_DEPARTAMENTO_CODIGO,
      direccion: empresa.direccion ?? "Sin direccion",
    },
    telefono: empresa.telefono,
    email: empresa.email,
  };

  return {
    empresa,
    resolucion,
    emisor,
    ambiente: (resolucion.ambiente === "PRODUCCION" ? "1" : "2") as "1" | "2",
    // Software propio: el proveedor tecnologico es el mismo facturador.
    software: {
      id: env.DIAN_SOFTWARE_ID!,
      pin: env.DIAN_SOFTWARE_PIN!,
      nitProveedor: empresa.nit,
      dvProveedor: empresa.digitoVerificacion,
    },
  };
};

export const armarDocumento = async (factura: FacturaCompleta): Promise<DocumentoFactura> => {
  const { resolucion, emisor, ambiente, software } = await cargarEmisor();
  const { vigenciaDesde, vigenciaHasta, rangoDesde, rangoHasta } = resolucion;

  if (!vigenciaDesde || !vigenciaHasta || rangoDesde === null || rangoHasta === null || !resolucion.numeroResolucion) {
    throw badRequest("La resolucion de numeracion esta incompleta");
  }

  return {
    numero: factura.numero,
    prefijo: factura.prefijo ?? "",
    emitidaEn: factura.fechaEmision,
    formaPago: factura.formaPago,
    fechaVencimiento: factura.fechaVencimiento?.toString() ?? null,
    ambiente,
    emisor,
    adquirente: parteAdquirente(factura.cliente),
    lineas: lineasFactura(factura),
    resolucion: {
      numero: resolucion.numeroResolucion,
      vigenciaDesde: vigenciaDesde.toString(),
      vigenciaHasta: vigenciaHasta.toString(),
      rangoDesde,
      rangoHasta,
    },
    software,
    claveTecnica: env.DIAN_CLAVE_TECNICA!,
  };
};

const ESTADO_FACTURA = { VALIDADO: "VALIDADA", RECHAZADO: "RECHAZADA" } as const;

export const enviarFactura = async (facturaId: string) => {
  validarParametrosDian();

  const factura = await getFacturaById(facturaId);

  if (factura.estadoDian === "VALIDADA") {
    throw conflict("La factura ya fue validada por la DIAN");
  }

  // Marca la factura como ENVIADA solo si nadie mas la esta enviando; evita dobles envios.
  const tomadas = await db.orm.public.Facturas
    .where((f) =>
      and(f.id.eq(facturaId), or(f.estadoDian.eq("PENDIENTE_ENVIO"), f.estadoDian.eq("RECHAZADA"))),
    )
    .updateAndCount({ estadoDian: "ENVIADA" });

  if (tomadas === 0) {
    throw conflict("La factura ya se esta enviando; espera la respuesta");
  }

  const intentos = await db.orm.public.EnviosDian
    .where({ facturaId })
    .aggregate((a) => ({ total: a.count() }));
  const numeroIntento = intentos.total + 1;

  let resultado: ResultadoDian;
  let cufe: string;
  let xmlPath: string;

  try {
    const documento = await armarDocumento(factura);
    const generado = construirFacturaXml(documento);
    const firmado = await firmarXml(generado.xml, await obtenerCertificado());

    cufe = generado.cufe;
    xmlPath = await guardarDocumento(`facturas/${factura.numero}.xml`, firmado);
    resultado = await getGateway().enviarFactura(firmado);
  } catch (error) {
    // Nada salio hacia la DIAN o no hubo respuesta: la factura vuelve a quedar disponible para reintentar.
    await db.orm.public.Facturas.where({ id: facturaId }).update({ estadoDian: factura.estadoDian });
    await db.orm.public.EnviosDian.create({
      facturaId,
      notaCreditoId: null,
      numeroIntento,
      fechaEnvio: nowInstant(),
      estado: "ERROR_CONEXION",
      codigoRespuesta: null,
      mensajeRespuesta: error instanceof Error ? error.message : "Error desconocido",
      respuestaPath: null,
    });

    if (error instanceof Error && "statusCode" in error) throw error;
    throw serviceUnavailable("No fue posible completar el envio a la DIAN; puedes reintentar");
  }

  const respuestaPath = await guardarDocumento(
    `respuestas/${factura.numero}-intento-${numeroIntento}.json`,
    JSON.stringify(resultado, null, 2),
  );

  await db.transaction(async (tx) => {
    await tx.orm.public.EnviosDian.create({
      facturaId,
      notaCreditoId: null,
      numeroIntento,
      fechaEnvio: nowInstant(),
      estado: resultado.estado,
      codigoRespuesta: nullableVarchar<150>(resultado.codigo),
      mensajeRespuesta: [resultado.mensaje, ...resultado.errores.map((e) => `${e.regla}: ${e.mensaje}`)].join("\n"),
      respuestaPath,
    });
    await tx.orm.public.Facturas.where({ id: facturaId }).update({
      estadoDian: ESTADO_FACTURA[resultado.estado],
      cufe: nullableVarchar<100>(cufe),
      xmlPath,
    });
  });

  return { factura: await getFacturaById(facturaId), resultado };
};

export const listEnviosFactura = async (facturaId: string) => {
  await getFacturaById(facturaId);

  return db.orm.public.EnviosDian
    .where({ facturaId })
    .orderBy((envio) => envio.numeroIntento.desc())
    .all();
};

export const getXmlFactura = async (facturaId: string) => {
  const factura = await getFacturaById(facturaId);

  if (!factura.xmlPath) {
    throw badRequest("La factura todavia no tiene documento electronico; enviala a la DIAN primero");
  }

  return { nombre: `${factura.numero}.xml`, contenido: await leerDocumento(factura.xmlPath) };
};

export const getPdfFactura = async (facturaId: string) => {
  const factura = await getFacturaById(facturaId);
  const empresa = await db.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();
  const resolucion = empresa
    ? await db.orm.public.ConfiguracionDian.where({ empresaId: empresa.id }).first()
    : null;
  const { fecha, hora } = fechaHoraColombia(factura.fechaEmision);
  const orden = factura.orden;

  if (!orden) {
    throw badRequest("La factura no tiene orden de servicio asociada");
  }

  const moto = orden.motocicleta;

  const contenido = await renderFacturaPdf({
    numero: factura.numero,
    fechaEmision: `${fecha} ${hora.slice(0, 5)}`,
    formaPago: factura.formaPago,
    fechaVencimiento: factura.fechaVencimiento?.toString() ?? null,
    estadoDian: factura.estadoDian,
    cufe: factura.cufe,
    ambiente: resolucion?.ambiente === "PRODUCCION" ? "1" : "2",
    empresa: {
      razonSocial: empresa?.razonSocial ?? "",
      nit: empresa?.nit ?? "",
      dv: empresa?.digitoVerificacion ?? null,
      direccion: empresa?.direccion ?? null,
      telefono: empresa?.telefono ?? null,
      email: empresa?.email ?? null,
      regimen: empresa?.regimenFiscal ?? null,
    },
    resolucion:
      resolucion?.numeroResolucion && resolucion.fechaResolucion && resolucion.vigenciaHasta
        ? {
            numero: resolucion.numeroResolucion,
            fecha: resolucion.fechaResolucion.toString(),
            prefijo: resolucion.prefijoFacturacion ?? "",
            desde: resolucion.rangoDesde ?? 0,
            hasta: resolucion.rangoHasta ?? 0,
            vigenciaHasta: resolucion.vigenciaHasta.toString(),
          }
        : null,
    cliente: {
      nombre: factura.cliente.nombreRazonSocial,
      documento: `${factura.cliente.tipoIdentificacion} ${factura.cliente.numeroIdentificacion}${
        factura.cliente.digitoVerificacion ? `-${factura.cliente.digitoVerificacion}` : ""
      }`,
      email: factura.cliente.email,
      telefono: factura.cliente.telefono,
    },
    orden: {
      numero: orden.numero,
      placa: moto?.placa ?? "",
      vehiculo: moto ? `${moto.marca} ${moto.modelo}${moto.anio ? ` ${moto.anio}` : ""}` : "",
      kilometraje: orden.kilometrajeIngreso,
    },
    lineas: lineasFactura(factura),
    totales: { subtotal: factura.subtotal, impuestos: factura.impuestos, total: factura.total },
  });

  return { nombre: `${factura.numero}.pdf`, contenido };
};
