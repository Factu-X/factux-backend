import { Router } from "express";

import { authRouter } from "./auth/auth.routes.js";
import { carteraRouter } from "./cartera/cartera.routes.js";
import { catalogoRouter } from "./catalogo/catalogo.routes.js";
import { clientesRouter } from "./clientes/clientes.routes.js";
import { configuracionRouter } from "./configuracion/configuracion.routes.js";
import { facturasRouter } from "./facturas/facturas.routes.js";
import {
  clienteMotocicletasRouter,
  motocicletasRouter,
} from "./motocicletas/motocicletas.routes.js";
import { notasCreditoRouter } from "./notas-credito/notas-credito.routes.js";
import { ordenesRouter } from "./ordenes/ordenes.routes.js";
import { reportesRouter } from "./reportes/reportes.routes.js";
import { usuariosRouter } from "./usuarios/usuarios.routes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/clientes/:clienteId/motocicletas", clienteMotocicletasRouter);
apiRouter.use("/clientes", clientesRouter);
apiRouter.use("/motocicletas", motocicletasRouter);
apiRouter.use("/catalogo", catalogoRouter);
apiRouter.use("/ordenes", ordenesRouter);
apiRouter.use("/facturas", facturasRouter);
apiRouter.use("/configuracion", configuracionRouter);
apiRouter.use("/usuarios", usuariosRouter);
apiRouter.use("/notas-credito", notasCreditoRouter);
apiRouter.use("/cartera", carteraRouter);
apiRouter.use("/reportes", reportesRouter);
