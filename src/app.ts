import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { healthRouter } from "./modules/health/health.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(","), credentials: true }));
app.use(express.json());

app.use("/api/v1/health", healthRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
});
