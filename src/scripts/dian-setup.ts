import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { db } from "../prisma/db.js";
import { getConfiguracion } from "../modules/configuracion/configuracion.service.js";
import { generarCertificadoPruebas } from "../modules/dian/certificado-pruebas.js";

// Prepara el ambiente DIAN simulado: certificado autofirmado y parametros del software.
// Uso: npm run dian:setup            -> muestra las variables
//      npm run dian:setup -- --env   -> ademas las agrega al .env (solo las que falten)
const CERT_PATH = "certs/factux-pruebas.p12";

// Clave tecnica que la DIAN publica para la resolucion de pruebas 18760000001 (prefijo SETP).
const CLAVE_TECNICA_PRUEBAS = "fc8eac422eba16e22ffd8c6f94b3f40a6e38162c";

const main = async () => {
  const { empresa } = await getConfiguracion();

  if (!empresa) {
    throw new Error("Registra la empresa (o corre npm run db:seed) antes de generar el certificado");
  }

  const password = randomBytes(12).toString("hex");
  await mkdir("certs", { recursive: true });
  await writeFile(CERT_PATH, generarCertificadoPruebas({ nombre: empresa.razonSocial, nit: empresa.nit, password }));

  const variables: Record<string, string> = {
    DIAN_SOFTWARE_ID: randomUUID(),
    DIAN_SOFTWARE_PIN: String(randomInt(10000, 99999)),
    DIAN_CLAVE_TECNICA: CLAVE_TECNICA_PRUEBAS,
    DIAN_CERT_PATH: CERT_PATH,
    DIAN_CERT_PASSWORD: password,
  };

  console.log(`Certificado de pruebas creado en ${CERT_PATH}`);

  if (!process.argv.includes("--env")) {
    console.log("\nAgrega estas variables al .env del backend:\n");
    for (const [clave, valor] of Object.entries(variables)) console.log(`${clave}="${valor}"`);
    return;
  }

  const actual = await readFile(".env", "utf8").catch(() => "");
  const definidas = new Set(
    actual
      .split(/\r?\n/)
      .filter((linea) => /^\s*[A-Z_]+\s*=\s*\S/.test(linea) && !/=\s*""\s*$/.test(linea))
      .map((linea) => linea.split("=")[0]!.trim()),
  );
  // Si el .env ya trae un certificado, no se reemplaza su contrasena.
  const nuevas = Object.entries(variables).filter(
    ([clave]) => !definidas.has(clave) && !(clave === "DIAN_CERT_PASSWORD" && definidas.has("DIAN_CERT_PATH")),
  );

  if (nuevas.length === 0) {
    console.log(".env ya tenia todas las variables DIAN; no se modifico");
    return;
  }

  await appendFile(
    ".env",
    `\n# Ambiente DIAN simulado (npm run dian:setup)\n${nuevas.map(([k, v]) => `${k}="${v}"`).join("\n")}\n`,
  );
  console.log(`Se agregaron al .env: ${nuevas.map(([k]) => k).join(", ")}`);
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
