import { app } from "./app.js";
import { env } from "./config/env.js";
import { notificarVencidos } from "./modules/recordatorios/recordatorios.service.js";
import { db } from "./prisma/db.js";
import { correoConfigurado } from "./shared/email.js";

// HU-11: avisa por correo los recordatorios que llegaron a su fecha o kilometraje, sin esperar el boton.
// notificacionEnviadaAt evita repetir el aviso, asi que correrlo varias veces al dia es seguro.
// shortcut: temporizador dentro del proceso; si el API se despliega con varias instancias, moverlo a un cron externo.
const AVISOS_CADA_MS = 6 * 60 * 60 * 1000;
const avisarVencidos = () =>
  notificarVencidos()
    .then((r) => console.log(`Recordatorios: ${r.enviados} enviados, ${r.sinCorreo} sin correo, ${r.fallidos} fallidos`))
    .catch((error: unknown) => console.warn("No se pudieron enviar los recordatorios automaticos:", error));

app.listen(env.PORT, () => {
  console.log(`FactuX API ejecutandose en http://localhost:${env.PORT}`);
  // Abre la conexion a la BD de una vez (~1,2 s en frio) para que no la pague el primer click.
  db.orm.public.Profiles.first({ id: "00000000-0000-0000-0000-000000000000" }).catch((error: unknown) =>
    console.warn("No se pudo precalentar la conexion a la BD:", error),
  );

  if (correoConfigurado()) {
    void avisarVencidos();
    setInterval(() => void avisarVencidos(), AVISOS_CADA_MS);
  } else {
    console.warn("Recordatorios automaticos apagados: faltan RESEND_API_KEY y EMAIL_FROM");
  }
});
