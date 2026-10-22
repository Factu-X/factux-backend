import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";

import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFoundHandler } from "./middlewares/not-found.js";
import { apiRouter } from "./modules/routes.js";

const isTest = process.env["NODE_ENV"] === "test";

export const app = express();

app.use(helmet());
app.use(cors(env.CORS_ORIGINS.length > 0 ? { origin: env.CORS_ORIGINS } : undefined));
app.use(express.json());

if (!isTest) {
  app.use(morgan("dev"));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: env.RATE_LIMIT_PER_MINUTE,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: {
        error: {
          message: "Demasiadas solicitudes, intenta de nuevo en un minuto",
          code: "TOO_MANY_REQUESTS",
        },
      },
    }),
  );
}

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "FactuX API",
  });
});

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
