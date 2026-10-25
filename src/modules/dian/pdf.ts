import PDFDocument from "pdfkit";
import QRCode from "qrcode";

import { agruparIva, URL_CONSULTA, type Linea } from "./ubl.js";

export type DatosPdf = {
  numero: string;
  fechaEmision: string;
  formaPago: "CONTADO" | "CREDITO";
  fechaVencimiento: string | null;
  estadoDian: string;
  cufe: string | null;
  ambiente: "1" | "2";
  empresa: {
    razonSocial: string;
    nit: string;
    dv: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
    regimen: string | null;
  };
  resolucion: { numero: string; fecha: string; prefijo: string; desde: number; hasta: number; vigenciaHasta: string } | null;
  cliente: { nombre: string; documento: string; email: string | null; telefono: string | null };
  orden: { numero: string; placa: string; vehiculo: string; kilometraje: number };
  lineas: Linea[];
  totales: { subtotal: string; impuestos: string; total: string };
  // Presente solo cuando el documento es una nota credito.
  notaCredito?: { facturaNumero: string; facturaCufe: string | null; concepto: string; motivo: string };
};

const cop = (valor: string | number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2 }).format(
    Number(valor),
  );

const ESTADOS: Record<string, string> = {
  PENDIENTE_ENVIO: "Pendiente de envío",
  ENVIADA: "Enviada",
  VALIDADA: "Validada",
  RECHAZADA: "Rechazada",
};

const GRIS = "#5a6474";
const TINTA = "#18202b";
const ACENTO = "#c2410c";

// Representacion grafica de la factura o nota credito. Sin CUFE/CUDE se marca como documento sin validez fiscal.
export const renderFacturaPdf = async (datos: DatosPdf): Promise<Buffer> => {
  const nc = datos.notaCredito;
  const etiquetaCodigo = nc ? "CUDE" : "CUFE";
  const qr = datos.cufe
    ? await QRCode.toBuffer(`${URL_CONSULTA[datos.ambiente]}${datos.cufe}`, { margin: 0, width: 220 })
    : null;

  const pdf = new PDFDocument({ size: "LETTER", margin: 42, info: { Title: `${nc ? "Nota credito" : "Factura"} ${datos.numero}` } });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const terminado = new Promise<Buffer>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));

  const ancho = pdf.page.width - 84;
  const izquierda = 42;

  // Encabezado: emisor a la izquierda, numero de factura a la derecha.
  pdf.fillColor(TINTA).font("Helvetica-Bold").fontSize(15).text(datos.empresa.razonSocial, izquierda, 42, { width: 320 });
  pdf.font("Helvetica").fontSize(9).fillColor(GRIS);
  pdf.text(`NIT ${datos.empresa.nit}${datos.empresa.dv ? `-${datos.empresa.dv}` : ""}`);
  if (datos.empresa.regimen) pdf.text(datos.empresa.regimen);
  if (datos.empresa.direccion) pdf.text(datos.empresa.direccion);
  pdf.text([datos.empresa.telefono, datos.empresa.email].filter(Boolean).join(" · "));

  pdf.font("Helvetica-Bold").fontSize(9).fillColor(GRIS).text(nc ? "NOTA CRÉDITO ELECTRÓNICA" : "FACTURA ELECTRÓNICA DE VENTA", 372, 42, { width: 198, align: "right" });
  pdf.fontSize(16).fillColor(ACENTO).text(datos.numero, { width: 198, align: "right" });
  pdf.font("Helvetica").fontSize(9).fillColor(GRIS);
  pdf.text(`Emisión: ${datos.fechaEmision}`, { width: 198, align: "right" });
  pdf.text(
    nc
      ? `Afecta la factura ${nc.facturaNumero}`
      : datos.formaPago === "CONTADO" ? "Pago de contado" : `Crédito · vence ${datos.fechaVencimiento ?? ""}`,
    { width: 198, align: "right" },
  );

  let y = 138;
  pdf.moveTo(izquierda, y).lineTo(izquierda + ancho, y).strokeColor("#dde1e8").stroke();
  y += 10;

  // Adquirente y vehiculo.
  pdf.font("Helvetica-Bold").fontSize(8).fillColor(GRIS).text("ADQUIRENTE", izquierda, y);
  pdf.text("ORDEN DE SERVICIO", izquierda + ancho / 2, y);
  pdf.font("Helvetica").fontSize(10).fillColor(TINTA);
  pdf.text(datos.cliente.nombre, izquierda, y + 12, { width: ancho / 2 - 10 });
  pdf.text(`${datos.orden.numero} · ${datos.orden.placa}`, izquierda + ancho / 2, y + 12, { width: ancho / 2 });
  pdf.fontSize(9).fillColor(GRIS);
  pdf.text(datos.cliente.documento, izquierda, y + 26, { width: ancho / 2 - 10 });
  pdf.text(`${datos.orden.vehiculo} · ${datos.orden.kilometraje.toLocaleString("es-CO")} km`, izquierda + ancho / 2, y + 26, { width: ancho / 2 });
  const contacto = [datos.cliente.email, datos.cliente.telefono].filter(Boolean).join(" · ");
  if (contacto) pdf.text(contacto, izquierda, y + 38, { width: ancho / 2 - 10 });

  // Tabla de lineas.
  y += 64;
  const columnas = [
    { titulo: "DESCRIPCIÓN", x: izquierda, w: 240, align: "left" as const },
    { titulo: "CANT.", x: izquierda + 240, w: 50, align: "right" as const },
    { titulo: "V. UNITARIO", x: izquierda + 290, w: 85, align: "right" as const },
    { titulo: "IVA", x: izquierda + 375, w: 60, align: "right" as const },
    { titulo: "TOTAL", x: izquierda + 435, w: ancho - 435, align: "right" as const },
  ];

  pdf.rect(izquierda, y, ancho, 18).fill("#f1f3f6");
  pdf.font("Helvetica-Bold").fontSize(8).fillColor(GRIS);
  for (const col of columnas) pdf.text(col.titulo, col.x + 4, y + 5, { width: col.w - 8, align: col.align });
  y += 22;

  pdf.font("Helvetica").fontSize(9).fillColor(TINTA);
  for (const linea of datos.lineas) {
    const iva = linea.tratamientoIva === "GRAVADO" ? `${Number(linea.tarifaIva)}%` : linea.tratamientoIva.toLowerCase();
    const total = Number(linea.subtotal) + Number(linea.impuesto);
    const valores = [
      `${linea.descripcion}${linea.codigo ? `  (${linea.codigo})` : ""}`,
      Number(linea.cantidad).toString(),
      cop(linea.precioUnitario),
      iva,
      cop(total),
    ];
    const alto = pdf.heightOfString(valores[0]!, { width: columnas[0]!.w - 8 });
    columnas.forEach((col, i) => pdf.text(valores[i]!, col.x + 4, y, { width: col.w - 8, align: col.align }));
    y += Math.max(alto, 12) + 6;
    pdf.moveTo(izquierda, y - 3).lineTo(izquierda + ancho, y - 3).strokeColor("#eef0f3").stroke();
  }

  // Totales con IVA agrupado por tarifa.
  y += 8;
  const xTot = izquierda + ancho - 220;
  const filaTotal = (etiqueta: string, valor: string, destacado = false) => {
    pdf.font(destacado ? "Helvetica-Bold" : "Helvetica").fontSize(destacado ? 11 : 9).fillColor(destacado ? TINTA : GRIS);
    pdf.text(etiqueta, xTot, y, { width: 120 });
    pdf.text(valor, xTot + 120, y, { width: 100, align: "right" });
    y += destacado ? 18 : 14;
  };
  filaTotal("Subtotal", cop(datos.totales.subtotal));
  for (const grupo of agruparIva(datos.lineas)) {
    filaTotal(`IVA ${Number(grupo.tarifa)}% sobre ${cop(grupo.base)}`, cop(grupo.impuesto));
  }
  filaTotal(nc ? "Total acreditado" : "Total a pagar", cop(datos.totales.total), true);

  if (nc) {
    y += 6;
    pdf.font("Helvetica-Bold").fontSize(8).fillColor(GRIS).text("CONCEPTO DE CORRECCIÓN", izquierda, y);
    pdf.font("Helvetica").fontSize(9).fillColor(TINTA).text(nc.concepto, izquierda, y + 11, { width: ancho });
    pdf.font("Helvetica-Bold").fontSize(8).fillColor(GRIS).text("MOTIVO", izquierda, pdf.y + 6);
    pdf.font("Helvetica").fontSize(9).fillColor(TINTA).text(nc.motivo, izquierda, pdf.y + 2, { width: ancho });
    pdf.font("Helvetica").fontSize(8).fillColor(GRIS)
      .text(`Factura afectada: ${nc.facturaNumero}${nc.facturaCufe ? ` · CUFE ${nc.facturaCufe}` : ""}`, izquierda, pdf.y + 6, { width: ancho });
    y = pdf.y;
  }

  // Pie: CUFE/CUDE, QR y resolucion.
  const yPie = Math.max(y + 20, 560);
  if (qr) pdf.image(qr, izquierda, yPie, { width: 96 });
  const xPie = qr ? izquierda + 110 : izquierda;
  pdf.font("Helvetica-Bold").fontSize(8).fillColor(GRIS).text(etiquetaCodigo, xPie, yPie);
  pdf.font("Courier").fontSize(7.5).fillColor(TINTA).text(datos.cufe ?? "Pendiente de envío a la DIAN", xPie, yPie + 11, { width: ancho - (xPie - izquierda) });
  pdf.font("Helvetica").fontSize(8).fillColor(GRIS);
  if (datos.resolucion) {
    pdf.text(
      `Resolución DIAN ${datos.resolucion.numero} del ${datos.resolucion.fecha}, prefijo ${datos.resolucion.prefijo} del ${datos.resolucion.desde} al ${datos.resolucion.hasta}, vigente hasta ${datos.resolucion.vigenciaHasta}.`,
      xPie,
      yPie + 44,
      { width: ancho - (xPie - izquierda) },
    );
  }
  pdf.text(`Estado DIAN: ${ESTADOS[datos.estadoDian] ?? datos.estadoDian}${datos.ambiente === "2" ? " · ambiente de pruebas (simulado)" : ""}`, xPie, pdf.y + 4, {
    width: ancho - (xPie - izquierda),
  });

  if (!datos.cufe) {
    pdf.save().rotate(-30, { origin: [306, 396] }).font("Helvetica-Bold").fontSize(40).fillColor("#c0c4cc").opacity(0.35)
      .text("SIN VALIDEZ FISCAL", 60, 380, { width: 492, align: "center" }).restore();
  }

  pdf.end();
  return terminado;
};
