import { Router } from "express";

import { catalogoRouter } from "./catalogo/catalogo.routes.js";
import { clientesRouter } from "./clientes/clientes.routes.js";
import {
  clienteMotocicletasRouter,
  motocicletasRouter,
} from "./motocicletas/motocicletas.routes.js";

export const apiRouter = Router();

apiRouter.use("/clientes/:clienteId/motocicletas", clienteMotocicletasRouter);
apiRouter.use("/clientes", clientesRouter);
apiRouter.use("/motocicletas", motocicletasRouter);
apiRouter.use("/catalogo", catalogoRouter);
