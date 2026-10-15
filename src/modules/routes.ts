import { Router } from "express";

import { authRouter } from "./auth/auth.routes.js";
import { catalogoRouter } from "./catalogo/catalogo.routes.js";
import { clientesRouter } from "./clientes/clientes.routes.js";
import { facturasRouter } from "./facturas/facturas.routes.js";
import {
  clienteMotocicletasRouter,
  motocicletasRouter,
} from "./motocicletas/motocicletas.routes.js";
import { ordenesRouter } from "./ordenes/ordenes.routes.js";
import { usuariosRouter } from "./usuarios/usuarios.routes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/clientes/:clienteId/motocicletas", clienteMotocicletasRouter);
apiRouter.use("/clientes", clientesRouter);
apiRouter.use("/motocicletas", motocicletasRouter);
apiRouter.use("/catalogo", catalogoRouter);
apiRouter.use("/ordenes", ordenesRouter);
apiRouter.use("/facturas", facturasRouter);
apiRouter.use("/usuarios", usuariosRouter);
