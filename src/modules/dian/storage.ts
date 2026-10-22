import { BUCKET_PRIVADO, requireSecretsClient } from "../configuracion/configuracion.service.js";

// Documentos fiscales en el bucket privado (solo service_role). Las rutas guardadas en la base
// son relativas al bucket.
const bucket = () => requireSecretsClient().storage.from(BUCKET_PRIVADO);

export const guardarDocumento = async (ruta: string, contenido: string | Buffer, contentType: string) => {
  const { error } = await bucket().upload(ruta, contenido, { contentType, upsert: true });
  if (error) throw error;
  return ruta;
};

export const leerDocumento = async (ruta: string) => {
  const { data, error } = await bucket().download(ruta);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
};
