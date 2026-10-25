import { and, or } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { badRequest, conflict, serviceUnavailable } from "../../shared/http-error.js";
import { nullableVarchar } from "../../shared/prisma-types.js";
import { nowInstant } from "../../shared/time.js";
import {
  getCertificadoFirma,
  getConfiguracionEmision,
} from "../configuracion/configuracion.service.js";
import { getFacturaById, xmlPath, xmlFirmadoPath } from "../facturas/facturas.service.js";
import { SimuladorDianGateway, type ResultadoDian } from "./gateway.js";
import { renderFacturaPdf } from "./pdf.js";
import { firmarXml } from "./signer.js";
import { guardarDocumento, leerDocumento } from "./storage.js";
import { fechaHoraColombia, TIPO_DOCUMENTO, type Linea, type Parte } from "./ubl.js";

type FacturaCompleta = Awaited<ReturnType<typeof getFacturaById>>;

const CONSUMIDOR_FINAL = "222222222222";

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

// Todo lo que HU-07 necesita para firmar y transmitir: emisor, software, certificado y gateway.
// Sale de la configuracion de HU-13 (base de datos y Vault), nunca del .env.
export const cargarContextoDian = async () => {
  const { empresa, numeracion, claveTecnica, pin } = await getConfiguracionEmision({ transmitir: true });
  const certificado = await getCertificadoFirma(numeracion);

  const emisor: Parte = {
    tipoPersona: empresa.tipoPersona === "NATURAL" ? "2" : "1",
    tipoDocumento: TIPO_DOCUMENTO.NIT,
    numeroDocumento: empresa.nit,
    digitoVerificacion: empresa.digitoVerificacion,
    nombre: empresa.razonSocial,
    responsabilidades: empresa.responsabilidadesFiscales!,
    // Igual que la factura (facturas.xml.ts): el emisor declara el esquema 01 IVA.
    responsableIva: true,
    ubicacion: {
      municipioCodigo: empresa.codigoMunicipio!,
      ciudad: empresa.ciudad!,
      departamento: empresa.departamento!,
      departamentoCodigo: empresa.codigoMunicipio!.slice(0, 2),
      direccion: empresa.direccion!,
    },
    telefono: empresa.telefono,
    email: empresa.email,
  };

  return {
    emisor,
    ambiente: (numeracion.ambiente === "PRODUCCION" ? "1" : "2") as "1" | "2",
    // Software propio: el proveedor tecnologico es el mismo facturador.
    software: {
      id: numeracion.softwareId!,
      pin,
      nitProveedor: empresa.nit,
      dvProveedor: empresa.digitoVerificacion!,
    },
    certificado,
    // Unico lugar que decide a que DIAN se habla. Hoy siempre es el simulador.
    gateway: new SimuladorDianGateway(claveTecnica, pin),
  };
};

const ESTADO_FACTURA = { VALIDADO: "VALIDADA", RECHAZADO: "RECHAZADA" } as const;

export const enviarFactura = async (facturaId: string) => {
  const factura = await getFacturaById(facturaId);

  if (factura.estadoDian === "VALIDADA") {
    throw conflict("La factura ya fue validada por la DIAN");
  }

  if (!factura.xmlPath || !factura.cufe) {
    throw badRequest("La factura se emitio antes de HU-06 y no tiene documento electronico");
  }

  // La configuracion se valida antes de tomar la factura: si falta algo no cuenta como intento.
  const contexto = await cargarContextoDian();

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
  let firmadoPath: string;

  try {
    // Se firma siempre el XML original de HU-06; reintentar no apila firmas.
    const xml = (await leerDocumento(xmlPath(factura.numero))).toString("utf8");
    const firmado = await firmarXml(xml, contexto.certificado);

    firmadoPath = await guardarDocumento(xmlFirmadoPath(factura.numero), firmado, "application/xml");
    resultado = await contexto.gateway.enviarFactura(firmado);
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
    "application/json",
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
      xmlPath: firmadoPath,
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
