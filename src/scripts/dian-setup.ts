import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { db } from "../prisma/db.js";
import {
  getConfiguracion,
  updateCertificado,
  updateCredenciales,
} from "../modules/configuracion/configuracion.service.js";
import { generarCertificadoPruebas } from "../modules/dian/certificado-pruebas.js";

// Prepara el ambiente DIAN simulado sobre la configuracion de HU-13: sube un certificado autofirmado
// al bucket privado y, con --credenciales, guarda Software ID, PIN, clave tecnica y TestSetId de pruebas
// (los secretos van a Vault). Requiere empresa y numeracion registradas y SUPABASE_SERVICE_ROLE_KEY.
// Uso: npm run dian:setup [-- --credenciales]

// Clave tecnica que la DIAN publica para la resolucion de pruebas 18760000001 (prefijo SETP).
const CLAVE_TECNICA_PRUEBAS = "fc8eac422eba16e22ffd8c6f94b3f40a6e38162c";

const main = async () => {
  const { empresa } = await getConfiguracion("ADMINISTRADOR");

  if (!empresa) {
    throw new Error("Registra la empresa y la numeracion antes de generar el certificado");
  }

  const password = randomBytes(12).toString("hex");
  const archivo = generarCertificadoPruebas({ nombre: empresa.razonSocial, nit: empresa.nit, password });
  const expira = Temporal.Now.plainDateISO("America/Bogota").add({ years: 2 }).subtract({ days: 1 });

  await updateCertificado({ archivoBase64: archivo.toString("base64"), password, expira: expira.toString() });
  console.log(`Certificado de pruebas cargado (vence ${expira.toString()})`);

  if (process.argv.includes("--credenciales")) {
    await updateCredenciales({
      softwareId: randomUUID(),
      testSetId: randomUUID(),
      pin: String(randomInt(10000, 99999)),
      claveTecnica: CLAVE_TECNICA_PRUEBAS,
    });
    console.log("Credenciales de pruebas guardadas (secretos en Vault)");
  }
};

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
