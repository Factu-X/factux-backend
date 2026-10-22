import { resolve } from "node:path";

import { env } from "../config/env.js";
import { db } from "../prisma/db.js";
import { getConfiguracion } from "../modules/configuracion/configuracion.service.js";
import { enviarFactura, getPdfFactura, getXmlFactura } from "../modules/dian/dian.service.js";
import { cargarCertificado, verificarFirma } from "../modules/dian/signer.js";
import { guardarDocumento } from "../modules/dian/storage.js";
import { createFacturaFromOrden, getFacturaById } from "../modules/facturas/facturas.service.js";

// Recorre la Fase B de punta a punta y muestra cada resultado para poder validarlo a simple vista.
// Uso: npm run verificar:dian                     -> factura la primera orden finalizada pendiente y la envia
//      npm run verificar:dian -- --factura SETP990000000  -> solo revisa una factura existente
const ok = (texto: string) => console.log(`  [OK]    ${texto}`);
const falla = (texto: string) => console.log(`  [FALLA] ${texto}`);
const info = (texto: string) => console.log(`          ${texto}`);
const paso = (titulo: string) => console.log(`\n${titulo}`);

const argumento = (nombre: string) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async () => {
  let fallas = 0;
  const check = (condicion: boolean, bien: string, mal: string) => {
    if (condicion) ok(bien);
    else {
      falla(mal);
      fallas += 1;
    }
  };

  paso("1. Configuracion");
  const config = await getConfiguracion();
  check(!!config.empresa, `Empresa: ${config.empresa?.razonSocial} NIT ${config.empresa?.nit}-${config.empresa?.digitoVerificacion}`, "No hay empresa configurada");
  check(
    !config.alertas.some((a) => a.nivel === "ERROR"),
    `Resolucion ${config.resolucion?.numeroResolucion}, prefijo ${config.resolucion?.prefijoFacturacion}, siguiente numero ${config.resolucion?.siguienteNumero}`,
    `La resolucion bloquea la facturacion: ${config.alertas.map((a) => a.mensaje).join("; ")}`,
  );
  const software = Object.entries(config.software);
  check(
    software.every(([, presente]) => presente),
    "Parametros del software DIAN presentes en el servidor",
    `Faltan parametros: ${software.filter(([, p]) => !p).map(([k]) => k).join(", ")} (corre npm run dian:setup -- --env)`,
  );
  if (env.DIAN_CERT_PATH) {
    const cert = await cargarCertificado(env.DIAN_CERT_PATH, env.DIAN_CERT_PASSWORD ?? "");
    ok(`Certificado "${cert.sujeto}", vence ${cert.venceEl.toISOString().slice(0, 10)}`);
  }

  paso("2. Factura");
  const numeroFactura = argumento("--factura");
  let facturaId: string;

  if (numeroFactura) {
    const existente = await db.orm.public.Facturas.where({ numero: numeroFactura as never }).first();
    if (!existente) throw new Error(`No existe la factura ${numeroFactura}`);
    facturaId = existente.id;
    ok(`Usando la factura existente ${numeroFactura}`);
  } else {
    const ordenes = await db.orm.public.OrdenesServicio.include("facturas").where({ estado: "FINALIZADA" }).all();
    const pendiente = ordenes.find((orden) => !orden.facturas);
    if (!pendiente) {
      falla("No hay ordenes finalizadas sin factura. Finaliza una orden en la app o usa --factura <numero>");
      return 1;
    }
    const creada = await createFacturaFromOrden({ ordenId: pendiente.id, formaPago: "CONTADO" });
    facturaId = creada.id;
    ok(`Factura ${creada.numero} creada desde la orden ${pendiente.numero}`);
    info(`Subtotal ${creada.subtotal} + IVA ${creada.impuestos} = Total ${creada.total}`);
  }

  paso("3. Envio a la DIAN (simulador)");
  const antes = await getFacturaById(facturaId);
  if (antes.estadoDian === "VALIDADA") {
    ok(`La factura ya estaba validada (CUFE ${antes.cufe?.slice(0, 16)}...)`);
  } else {
    const { resultado } = await enviarFactura(facturaId);
    check(
      resultado.estado === "VALIDADO",
      `Respuesta ${resultado.codigo}: ${resultado.mensaje}`,
      `Respuesta ${resultado.codigo}: ${resultado.errores.map((e) => `${e.regla} ${e.mensaje}`).join("; ")}`,
    );
  }

  paso("4. Verificacion independiente del XML guardado");
  const factura = await getFacturaById(facturaId);
  const { contenido } = await getXmlFactura(facturaId);
  const xml = contenido.toString("utf8");
  check(await verificarFirma(xml), "La firma XAdES es valida", "La firma XAdES NO es valida");
  check(!!factura.cufe && xml.includes(`>${factura.cufe}</cbc:UUID>`), `CUFE en el XML = CUFE en la base (${factura.cufe?.slice(0, 16)}...)`, "El CUFE del XML no coincide con la base");
  check(xml.includes(`documentkey=${factura.cufe}`), "El QR apunta a la consulta DIAN con ese CUFE", "El QR no contiene el CUFE");
  const alterado = xml.replace(`>${factura.total}</cbc:PayableAmount>`, ">1.00</cbc:PayableAmount>");
  check(!(await verificarFirma(alterado)), "Si se altera el total, la firma deja de ser valida", "Un XML alterado paso la verificacion");

  paso("5. Archivos para revisar");
  const pdf = await getPdfFactura(facturaId);
  const pdfPath = await guardarDocumento(`pdf/${factura.numero}.pdf`, pdf.contenido);
  info(`XML firmado: ${resolve(env.STORAGE_DIR, factura.xmlPath ?? "")}`);
  info(`PDF:         ${resolve(env.STORAGE_DIR, pdfPath)}`);
  info(`Consulta:    https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${factura.cufe}`);
  info("(La consulta en la DIAN real no encontrara el documento: el envio fue al simulador.)");

  console.log(fallas === 0 ? "\nResultado: todo OK" : `\nResultado: ${fallas} verificacion(es) fallaron`);
  return fallas === 0 ? 0 : 1;
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
