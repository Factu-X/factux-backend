import { app } from "./app.js";
import { env } from "./config/env.js";
import { db } from "./prisma/db.js";

app.listen(env.PORT, () => {
  console.log(`FactuX API ejecutandose en http://localhost:${env.PORT}`);
  // Abre la conexion a la BD de una vez (~1,2 s en frio) para que no la pague el primer click.
  db.orm.public.Profiles.first({ id: "00000000-0000-0000-0000-000000000000" }).catch((error: unknown) =>
    console.warn("No se pudo precalentar la conexion a la BD:", error),
  );
});
