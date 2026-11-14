import { env } from "../config/env.js";

export type CorreoSaliente = {
  para: string;
  asunto: string;
  texto: string;
};

export const correoConfigurado = () => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

// Resend por HTTP: no agrega dependencias y falla con un error legible si el proveedor rechaza el envio.
export const enviarCorreo = async ({ para, asunto, texto }: CorreoSaliente) => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("El envio de correo no esta configurado");
  }

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [para], subject: asunto, text: texto }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!respuesta.ok) {
    throw new Error(`El proveedor de correo respondio ${respuesta.status}`);
  }
};
