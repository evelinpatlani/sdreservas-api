import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { notFound } from "../../lib/errors.js";
import { calcularVentana, mesasLibres } from "./availability.js";

export const availabilityRouter = Router();

const querySchema = z.object({
  date: z.string(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM"),
  duration: z.coerce.number().int(),
  guests: z.coerce.number().int().min(1).max(100),
});

availabilityRouter.get("/restaurants/:id/availability", requireAuth, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const u = req.user!;
  const q = querySchema.parse(req.query);

  let restaurante;
  if (u.rol === "CLIENTE") {
    restaurante = await prisma.restaurante.findFirst({ where: { id, activo: true } });
    if (!restaurante) throw notFound("Restaurante no encontrado");
  } else {
    restaurante = await restauranteAutorizado(u, id, "personal");
  }

  const v = await calcularVentana(restaurante, q.date, q.time, q.duration, {
    pasoDe30: u.rol === "CLIENTE",
  });
  if (!v.ok) return res.json({ disponible: false, motivo: v.motivo, mesas: [], zonas: [] });

  const mesas = await mesasLibres(prisma, id, v.inicio, v.fin, q.guests);

  const zonas = new Map<string, { areaId: string; area: string; piso: string; mesasDisponibles: number }>();
  for (const m of mesas) {
    const z = zonas.get(m.area.id) ?? {
      areaId: m.area.id,
      area: m.area.nombre,
      piso: m.area.piso.nombre,
      mesasDisponibles: 0,
    };
    z.mesasDisponibles++;
    zonas.set(m.area.id, z);
  }

  res.json({
    disponible: mesas.length > 0,
    motivo: mesas.length > 0 ? null : "No hay mesas libres para ese horario y número de personas",
    ventana: { inicio: v.inicio, fin: v.fin },
    zonas: [...zonas.values()],
    mesas: mesas.map((m) => ({
      id: m.id,
      etiqueta: m.etiqueta,
      capacidad: m.capacidad,
      areaId: m.area.id,
      area: m.area.nombre,
      piso: m.area.piso.nombre,
    })),
  });
});

