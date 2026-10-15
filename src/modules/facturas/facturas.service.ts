import { or } from "@prisma/orm-postgres/orm-client";

import { db } from "../../prisma/db.js";
import { isUniqueConstraintError } from "../../shared/db-errors.js";
import { decimalFromScale } from "../../shared/decimal.js";
import { badRequest, conflict, notFound } from "../../shared/http-error.js";
import { numeric, nullableVarchar, varchar } from "../../shared/prisma-types.js";
import { nowInstant, ZONA_COLOMBIA } from "../../shared/time.js";
import { siguienteConsecutivo } from "../configuracion/configuracion.rules.js";
import {
  BUCKET_PRIVADO,
  getConfiguracionEmision,
  requireSecretsClient,
} from "../configuracion/configuracion.service.js";
import { buildFacturaXml } from "./facturas.xml.js";
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

const getFacturaByIdWithClient = async (id: string, client: DbContext = db) => {
  const factura = await client.orm.public.Facturas.first({ id });

  if (!factura) {
    throw notFound("Factura no encontrada");
  }

  return factura;
};

// Cliente y orden viajan con la factura para que la pantalla no haga N+1 requests.
const facturasConRelaciones = () => db.orm.public.Facturas.include("cliente").include("orden");

export const listFacturas = (query: FacturasQuery) => {
  if (query.search) {
    const search = `%${query.search}%`;

    return facturasConRelaciones()
      .where((factura) => or(factura.numero.ilike(search), factura.cufe.ilike(search)))
      .orderBy((factura) => factura.fechaEmision.desc())
      .all();
  }

  return facturasConRelaciones().orderBy((factura) => factura.fechaEmision.desc()).all();
};

export const getFacturaById = async (id: string) => {
  const factura = await facturasConRelaciones().where({ id }).first();

  if (!factura) {
    throw notFound("Factura no encontrada");
  }

  return factura;
};

export const listDetallesFactura = async (facturaId: string) => {
  await getFacturaByIdWithClient(facturaId);

  return db.orm.public.DetallesFactura
    .where({ facturaId })
    .orderBy((detalle) => detalle.createdAt.asc())
    .all();
};

const fechaHoraColombia = (instant: Temporal.Instant) => {
  const zoned = instant.toZonedDateTimeISO(ZONA_COLOMBIA);

  return {
    fecha: zoned.toPlainDate().toString(),
    hora: `${zoned.toPlainTime().toString({ smallestUnit: "second" })}${zoned.offset}`,
  };
};

const xmlPath = (numero: string) => `facturas/${numero}.xml`;

export const createFacturaFromOrden = async (input: CreateFacturaInput, creadaPor?: string) => {
  // HU-13: sin configuracion minima (empresa, resolucion vigente, clave tecnica, software) no se emite.
  const config = await getConfiguracionEmision();
  const storage = requireSecretsClient().storage.from(BUCKET_PRIVADO);

  try {
    return await db.transaction(async (tx) => {
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

      const detallesOrden = await tx.orm.public.DetallesOrden
        .where({ ordenId: input.ordenId })
        .orderBy((detalle) => detalle.createdAt.asc())
        .all();

      if (detallesOrden.length === 0) {
        throw badRequest("No se puede facturar una orden sin detalles");
      }

      const cliente = await tx.orm.public.Clientes.first({ id: orden.clienteId });

      if (!cliente) {
        throw notFound("Cliente no encontrado");
      }

      if (cliente.tipoIdentificacion === "NIT" && !cliente.digitoVerificacion) {
        throw badRequest("El cliente con NIT debe tener digito de verificacion para facturar");
      }

      // Numeracion atomica: el UPDATE condicionado al consecutivo leido bloquea a la otra
      // transaccion concurrente, que al continuar ya no encuentra la fila y responde 409.
      const numeracion = await tx.orm.public.ConfiguracionDian.first({ id: config.numeracion.id });

      if (!numeracion || numeracion.consecutivoActual === null || numeracion.rangoHasta === null) {
        throw badRequest("Guarde de nuevo la configuracion de numeracion antes de facturar");
      }

      const consecutivo = siguienteConsecutivo(numeracion)!;

      if (consecutivo > numeracion.rangoHasta) {
        throw badRequest("El rango de numeracion autorizado esta agotado");
      }

      const reservado = await tx.orm.public.ConfiguracionDian
        .where({ id: numeracion.id, consecutivoActual: numeracion.consecutivoActual })
        .update({ consecutivoActual: consecutivo });

      if (!reservado) {
        throw conflict("Otra factura tomo este consecutivo al mismo tiempo. Intente de nuevo");
      }

      const prefijo = numeracion.prefijoFacturacion;
      const numero = `${prefijo ?? ""}${consecutivo}`;
      const fechaEmision = nowInstant();
      const { fecha, hora } = fechaHoraColombia(fechaEmision);
      const fechaVencimiento = parsePlainDate(input.fechaVencimiento);
      const { empresa } = config;

      const { cufe, xml, totales } = buildFacturaXml({
        numero,
        prefijo,
        fechaEmision: fecha,
        horaEmision: hora,
        fechaVencimiento: fechaVencimiento?.toString() ?? null,
        formaPago: input.formaPago,
        ambiente: numeracion.ambiente,
        resolucion: {
          numero: numeracion.numeroResolucion!,
          vigenciaDesde: numeracion.vigenciaDesde!.toString(),
          vigenciaHasta: numeracion.vigenciaHasta!.toString(),
          rangoDesde: numeracion.rangoDesde!,
          rangoHasta: numeracion.rangoHasta,
        },
        software: { id: numeracion.softwareId!, pin: config.pin },
        claveTecnica: config.claveTecnica,
        emisor: {
          nit: empresa.nit,
          dv: empresa.digitoVerificacion!,
          razonSocial: empresa.razonSocial,
          nombreComercial: empresa.nombreComercial,
          tipoPersona: empresa.tipoPersona,
          responsabilidadesFiscales: empresa.responsabilidadesFiscales!,
          direccion: empresa.direccion!,
          ciudad: empresa.ciudad!,
          departamento: empresa.departamento!,
          codigoMunicipio: empresa.codigoMunicipio!,
          telefono: empresa.telefono!,
          email: empresa.email!,
        },
        adquiriente: {
          tipoIdentificacion: cliente.tipoIdentificacion,
          numeroIdentificacion: cliente.numeroIdentificacion,
          dv: cliente.digitoVerificacion,
          nombre: cliente.nombreRazonSocial,
          direccion: cliente.direccion,
          telefono: cliente.telefono,
          email: cliente.email,
        },
        // Cada concepto conserva la cantidad, precio, IVA y subtotal calculados en la orden (HU-03).
        lineas: detallesOrden.map((detalle) => ({
          codigo: detalle.codigoItem,
          descripcion: detalle.nombreItem,
          cantidad: detalle.cantidad,
          precioUnitario: detalle.precioUnitario,
          subtotal: detalle.subtotal,
          impuesto: detalle.impuesto,
          tarifaIva: detalle.tarifaIva,
          tratamientoIva: detalle.tratamientoIva,
        })),
      });

      const factura = await tx.orm.public.Facturas.create({
        ordenId: orden.id,
        clienteId: orden.clienteId,
        creadaPor: creadaPor ?? null,
        prefijo: nullableVarchar<20>(prefijo),
        consecutivo,
        numero: varchar<50>(numero),
        fechaEmision,
        fechaVencimiento,
        formaPago: input.formaPago,
        subtotal: numeric<14, 2>(decimalFromScale(totales.valorBruto, 2)),
        impuestos: numeric<14, 2>(decimalFromScale(totales.iva, 2)),
        total: numeric<14, 2>(decimalFromScale(totales.total, 2)),
        cufe: nullableVarchar<100>(cufe),
        // Generada y lista para firmar; aun no se envia a la DIAN (eso es HU-07).
        estadoDian: "PENDIENTE_ENVIO",
        xmlPath: xmlPath(numero),
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

      // Se sube antes del commit: si falla, la factura y el consecutivo se revierten.
      const { error } = await storage.upload(xmlPath(numero), xml, {
        contentType: "application/xml",
        upsert: true,
      });
      if (error) throw error;

      return getFacturaByIdWithClient(factura.id, tx);
    });
  } catch (error) {
    // Dos usuarios facturando la misma orden a la vez: la restriccion unica responde por nosotros.
    if (isUniqueConstraintError(error)) {
      throw conflict("La orden ya tiene una factura o el numero ya fue usado. Recargue la lista");
    }
    throw error;
  }
};

export const getFacturaXml = async (id: string) => {
  const factura = await getFacturaByIdWithClient(id);

  if (!factura.xmlPath) {
    throw notFound("Esta factura no tiene documento electronico (se emitio antes de HU-06)");
  }

  const { data, error } = await requireSecretsClient()
    .storage.from(BUCKET_PRIVADO)
    .download(factura.xmlPath);
  if (error) throw error;

  return { numero: factura.numero, xml: await data.text() };
};
