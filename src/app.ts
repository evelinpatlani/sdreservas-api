import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { restaurantsRouter } from "./modules/restaurants/restaurants.routes.js";
import { employeesRouter } from "./modules/employees/employees.routes.js";
import { structureRouter } from "./modules/structure/structure.routes.js";
import { tablesRouter } from "./modules/tables/tables.routes.js";
import { methodsRouter } from "./modules/reservations/methods.routes.js";
import { availabilityRouter } from "./modules/reservations/availability.routes.js";
import { reservationsRouter } from "./modules/reservations/reservations.routes.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { staffRouter } from "./modules/reservations/staff.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(","), credentials: true }));
app.use(express.json({ limit: "100kb" }));

app.use("/api/v1/health", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/restaurants", restaurantsRouter);
app.use("/api/v1", employeesRouter);
app.use("/api/v1", structureRouter);
app.use("/api/v1", tablesRouter);
app.use("/api/v1", methodsRouter);
app.use("/api/v1", availabilityRouter);
app.use("/api/v1", reservationsRouter);
app.use("/api/v1", staffRouter);
app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
});

app.use(errorHandler);
