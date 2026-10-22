import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

import { env } from "../../config/env.js";

// Documentos fiscales en disco local. Las rutas que se guardan en la base son relativas a STORAGE_DIR,
// asi que mover la carpeta (o cambiar a un bucket) no obliga a reescribir datos.
const raiz = () => resolve(env.STORAGE_DIR);

const rutaSegura = (relativa: string) => {
  const limpia = normalize(relativa);

  if (isAbsolute(limpia) || limpia.startsWith("..")) {
    throw new Error(`Ruta de almacenamiento invalida: ${relativa}`);
  }

  return join(raiz(), limpia);
};

export const guardarDocumento = async (relativa: string, contenido: string | Buffer) => {
  const destino = rutaSegura(relativa);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, contenido);
  return relativa.replaceAll("\\", "/");
};

export const leerDocumento = (relativa: string) => readFile(rutaSegura(relativa));
