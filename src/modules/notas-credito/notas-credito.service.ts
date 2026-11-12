import { and, or } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { isUniqueConstraintError } from "../../shared/db-errors.js";
import { decimalFromScale } from "../../shared/decimal.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../shared/http-error.js";
import { nullableVarchar, numeric, varchar } from "../../shared/prisma-types.js";
import { nowInstant } from "../../shared/time.js";
import { cargarContextoDian, parteAdquirente } from "../dian/dian.service.js";
import type { ResultadoDian } from "../dian/gateway.js";
import { renderFacturaPdf } from "../dian/pdf.js";
import { firmarXml } from "../dian/signer.js";
import { guardarDocumento, leerDocumento } from "../dian/storage.js";
import { CONCEPTO_CORRECCION, construirNotaCreditoXml } from "../dian/ubl-nota-credito.js";
import { fechaHoraColombia, type Linea } from "../dian/ubl.js";
import { getFacturaById } from "../facturas/facturas.service.js";
import { calcularLineasNota, disponiblesPorLinea, type LineaFacturada } from "./notas-credito.rules.js";
import type { CreateNotaCreditoInput, NotasCreditoQuery } from "./notas-credito.schemas.js";

type FacturaCompleta = Awaited<ReturnType<typeof getFacturaById>>;

const lineasFacturadas = (factura: FacturaCompleta): LineaFacturada[] =>
  factura.detallesFacturas.map((detalle) => ({
    id: detalle.id,
    codigoItem: detalle.codigoItem,
    descripcion: detalle.descripcion,
    cantidad: detalle.cantidad,
    precioUnitario: detalle.precioUnitario,
    tarifaIva: detalle.tarifaIva,
    tratamientoIva:
      detalle.detalleOrden?.tratamientoIva ?? (Number(detalle.tarifaIva) > 0 ? "GRAVADO" : "EXCLUIDO"),
  }));

// Todas las notas previas reservan cantidades, incluso rechazadas: se pueden reintentar y luego validarse.
const lineasYaAcreditadas = (facturaId: string) =>
  db.orm.public.DetallesNotaCredito
    .where((d) => d.notaCredito.some((nc) => nc.facturaId.eq(facturaId)))
    .select("detalleFacturaId", "cantidad")
    .all();

const notaConRelaciones = () =>
  db.orm.public.NotasCredito
    .include("factura", (factura) =>
      factura
        .select("id", "numero", "cufe", "fechaEmision", "total", "clienteId")
        .include("cliente", (c) => c.select("id", "tipoIdentificacion", "numeroIdentificacion", "nombreRazonSocial")),
    );

export const listNotasCredito = (query: NotasCreditoQuery) =>
  notaConRelaciones()
    .where((nc) => (query.facturaId ? nc.facturaId.eq(query.facturaId) : nc.id.isNotNull()))
    .orderBy((nc) => nc.fechaEmision.desc())
    .all();

export const getNotaCreditoById = async (id: string) => {
  const nota = await notaConRelaciones()
    .include("detallesNotaCreditos", (d) =>
      d
        .include("detalleFactura", (df) =>
          df.select("id", "codigoItem").include("detalleOrden", (o) => o.select("tipoItem", "tratamientoIva")),
        )
        .orderBy((x) => x.createdAt.asc()),
    )
    .where({ id })
    .first();

  if (!nota) {
    throw notFound("Nota credito no encontrada");
  }

  return nota;
};

// Lo que todavia se puede acreditar de cada linea de una factura.
export const getAcreditable = async (facturaId: string) => {
  const factura = await getFacturaById(facturaId);
  const lineas = lineasFacturadas(factura);
  const disponibles = disponiblesPorLinea(lineas, await lineasYaAcreditadas(facturaId));

  return {
    facturaId: factura.id,
    numero: factura.numero,
    estadoDian: factura.estadoDian,
    puedeAcreditar: factura.estadoDian === "VALIDADA" && !!factura.cufe,
    lineas: lineas.map((linea) => ({
      ...linea,
      disponible: decimalFromScale(disponibles.get(linea.id) ?? 0n, 2),
    })),
  };
};

const siguienteNumero = async () => {
  const ultima = await db.orm.public.NotasCredito.orderBy((nc) => nc.createdAt.desc()).first();
  const ultimo = Number(ultima?.numero.replace(/\D/g, "") ?? 0);
  return `NC-${String(ultimo + 1).padStart(6, "0")}`;
};

export const createNotaCredito = async (input: CreateNotaCreditoInput, creadaPor?: string) => {
  const factura = await getFacturaById(input.facturaId);

  if (factura.estadoDian !== "VALIDADA" || !factura.cufe) {
    throw badRequest("Solo se emiten notas credito sobre facturas validadas por la DIAN");
  }

  const { lineas, totales } = calcularLineasNota(
    input.tipoAjuste,
    lineasFacturadas(factura),
    await lineasYaAcreditadas(factura.id),
    input.lineas,
  );

  // El numero se recalcula si otra nota tomo el mismo al tiempo (restriccion unica en la base).
  for (let intento = 0; intento < 3; intento += 1) {
    try {
      const id = await db.transaction(async (tx) => {
        const nota = await tx.orm.public.NotasCredito.create({
          facturaId: factura.id,
          creadaPor: creadaPor ?? null,
          numero: varchar<50>(await siguienteNumero()),
          tipoAjuste: input.tipoAjuste,
          motivo: input.motivo,
          fechaEmision: nowInstant(),
          subtotal: numeric<14, 2>(totales.subtotal),
          impuestos: numeric<14, 2>(totales.impuestos),
          total: numeric<14, 2>(totales.total),
          cude: null,
          estadoDian: "PENDIENTE_ENVIO",
          xmlPath: null,
          pdfPath: null,
        });

        for (const linea of lineas) {
          await tx.orm.public.DetallesNotaCredito.create({
            notaCreditoId: nota.id,
            detalleFacturaId: linea.detalleFacturaId,
            descripcion: varchar<250>(linea.descripcion),
            cantidad: numeric<10, 2>(linea.cantidad),
            precioUnitario: numeric<14, 2>(linea.precioUnitario),
            tarifaIva: numeric<5, 2>(linea.tarifaIva),
            subtotal: numeric<14, 2>(linea.subtotal),
            impuesto: numeric<14, 2>(linea.impuesto),
            total: numeric<14, 2>(linea.total),
          });
        }

        return nota.id;
      });

      return getNotaCreditoById(id);
    } catch (error) {
      if (!isUniqueConstraintError(error) || intento === 2) throw error;
    }
  }

  throw conflict("No fue posible asignar un numero a la nota credito; intenta de nuevo");
};

type NotaCompleta = Awaited<ReturnType<typeof getNotaCreditoById>>;

const lineasNota = (nota: NotaCompleta): Linea[] =>
  nota.detallesNotaCreditos.map((detalle) => ({
    codigo: detalle.detalleFactura?.codigoItem ?? null,
    descripcion: detalle.descripcion,
    cantidad: detalle.cantidad,
    precioUnitario: detalle.precioUnitario,
    subtotal: detalle.subtotal,
    impuesto: detalle.impuesto,
    tarifaIva: detalle.tarifaIva,
    tratamientoIva:
      detalle.detalleFactura?.detalleOrden?.tratamientoIva ?? (Number(detalle.tarifaIva) > 0 ? "GRAVADO" : "EXCLUIDO"),
  }));

const ESTADO_NOTA = { VALIDADO: "VALIDADA", RECHAZADO: "RECHAZADA" } as const;

export const enviarNotaCredito = async (id: string) => {
  const nota = await getNotaCreditoById(id);

  if (nota.estadoDian === "VALIDADA") {
    throw conflict("La nota credito ya fue validada por la DIAN");
  }

  const factura = nota.factura;

  if (!factura?.cufe) {
    throw badRequest("La factura referenciada no tiene CUFE");
  }

  // La configuracion se valida antes de tomar la nota: si falta algo no cuenta como intento.
  const { emisor, ambiente, software, certificado, gateway } = await cargarContextoDian();

  const tomadas = await db.orm.public.NotasCredito
    .where((nc) => and(nc.id.eq(id), or(nc.estadoDian.eq("PENDIENTE_ENVIO"), nc.estadoDian.eq("RECHAZADA"))))
    .updateAndCount({ estadoDian: "ENVIADA" });

  if (tomadas === 0) {
    throw conflict("La nota credito ya se esta enviando; espera la respuesta");
  }

  const intentos = await db.orm.public.EnviosDian.where({ notaCreditoId: id }).aggregate((a) => ({ total: a.count() }));
  const numeroIntento = intentos.total + 1;

  let resultado: ResultadoDian;
  let cude: string;
  let xmlPath: string;

  try {
    const cliente = (await getFacturaById(factura.id)).cliente;
    const generado = construirNotaCreditoXml({
      numero: nota.numero,
      emitidaEn: nota.fechaEmision,
      tipoAjuste: nota.tipoAjuste,
      motivo: nota.motivo,
      factura: { numero: factura.numero, cufe: factura.cufe, fechaEmision: fechaHoraColombia(factura.fechaEmision).fecha },
      emisor,
      adquirente: parteAdquirente(cliente),
      lineas: lineasNota(nota),
      ambiente,
      software,
    });
    const firmado = await firmarXml(generado.xml, certificado);

    cude = generado.cude;
    xmlPath = await guardarDocumento(`notas-credito/${nota.numero}.xml`, firmado, "application/xml");
    resultado = await gateway.enviarNotaCredito(firmado);
  } catch (error) {
    await db.orm.public.NotasCredito.where({ id }).update({ estadoDian: nota.estadoDian });
    await db.orm.public.EnviosDian.create({
      facturaId: null,
      notaCreditoId: id,
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
    `respuestas/${nota.numero}-intento-${numeroIntento}.json`,
    JSON.stringify(resultado, null, 2),
    "application/json",
  );

  await db.transaction(async (tx) => {
    await tx.orm.public.EnviosDian.create({
      facturaId: null,
      notaCreditoId: id,
      numeroIntento,
      fechaEnvio: nowInstant(),
      estado: resultado.estado,
      codigoRespuesta: nullableVarchar<150>(resultado.codigo),
      mensajeRespuesta: [resultado.mensaje, ...resultado.errores.map((e) => `${e.regla}: ${e.mensaje}`)].join("\n"),
      respuestaPath,
    });
    await tx.orm.public.NotasCredito.where({ id }).update({
      estadoDian: ESTADO_NOTA[resultado.estado],
      cude: nullableVarchar<100>(cude),
      xmlPath,
    });
  });

  return { notaCredito: await getNotaCreditoById(id), resultado };
};

export const listEnviosNota = async (id: string) => {
  await getNotaCreditoById(id);
  return db.orm.public.EnviosDian.where({ notaCreditoId: id }).orderBy((e) => e.numeroIntento.desc()).all();
};

export const getXmlNota = async (id: string) => {
  const nota = await getNotaCreditoById(id);

  if (!nota.xmlPath) {
    throw badRequest("La nota credito todavia no tiene documento electronico; enviala a la DIAN primero");
  }

  return { nombre: `${nota.numero}.xml`, contenido: await leerDocumento(nota.xmlPath) };
};

export const getPdfNota = async (id: string) => {
  const nota = await getNotaCreditoById(id);
  const factura = await getFacturaById(nota.facturaId);
  const empresa = await db.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();
  const resolucion = empresa ? await db.orm.public.ConfiguracionDian.where({ empresaId: empresa.id }).first() : null;
  const { fecha, hora } = fechaHoraColombia(nota.fechaEmision);
  const moto = factura.orden?.motocicleta;

  const contenido = await renderFacturaPdf({
    numero: nota.numero,
    fechaEmision: `${fecha} ${hora.slice(0, 5)}`,
    formaPago: factura.formaPago,
    fechaVencimiento: null,
    estadoDian: nota.estadoDian,
    cufe: nota.cude,
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
    resolucion: null,
    cliente: {
      nombre: factura.cliente.nombreRazonSocial,
      documento: `${factura.cliente.tipoIdentificacion} ${factura.cliente.numeroIdentificacion}`,
      email: factura.cliente.email,
      telefono: factura.cliente.telefono,
    },
    orden: {
      numero: factura.orden?.numero ?? "",
      placa: moto?.placa ?? "",
      vehiculo: moto ? `${moto.marca} ${moto.modelo}` : "",
      kilometraje: factura.orden?.kilometrajeIngreso ?? 0,
    },
    lineas: lineasNota(nota),
    totales: { subtotal: nota.subtotal, impuestos: nota.impuestos, total: nota.total },
    notaCredito: {
      facturaNumero: factura.numero,
      facturaCufe: factura.cufe,
      concepto: `${CONCEPTO_CORRECCION[nota.tipoAjuste].codigo} · ${CONCEPTO_CORRECCION[nota.tipoAjuste].descripcion}`,
      motivo: nota.motivo,
    },
  });

  return { nombre: `${nota.numero}.pdf`, contenido };
};
