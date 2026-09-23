import express from "express";
import cors from "cors";
import helmet from "helmet";

import { errorHandler } from "./middlewares/error-handler.js";
import { notFoundHandler } from "./middlewares/not-found.js";
import { apiRouter } from "./modules/routes.js";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "FactuX API",
  });
});

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
