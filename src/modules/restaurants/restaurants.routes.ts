import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { forbidden, notFound } from "../../lib/errors.js";

export const restaurantsRouter = Router();

const zonaHoraria = z.string().refine((z) => {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}, "Zona horaria inválida");

// RFC de prueba: solo formato (sin consulta al SAT)
const rfc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "RFC con formato inválido");

const crearSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  tipoCocina: z.string().trim().min(2).max(80),
  ubicacion: z.string().trim().min(2).max(200),
  rfc,
  limiteMesas: z.number().int().min(1).max(500),
  zonaHoraria: zonaHoraria.optional(),
});

const editarSchema = z
  .object({
    nombre: z.string().trim().min(2).max(120),
    tipoCocina: z.string().trim().min(2).max(80),
    ubicacion: z.string().trim().min(2).max(200),
    activo: z.boolean(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, "Envía al menos un campo");

restaurantsRouter.post("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const data = crearSchema.parse(req.body);
  const r = await prisma.restaurante.create({
    data: { ...data, adminId: req.user!.id },
  });
  await registrarAuditoria({
    actorId: req.user!.id,
    restauranteId: r.id,
    accion: "RESTAURANT_CREATED",
    entidad: "restaurante",
    entidadId: r.id,
  });
  res.status(201).json({ restaurante: r });
});

restaurantsRouter.get("/", requireAuth, async (req, res) => {
  const u = req.user!;
  let where: Prisma.RestauranteWhereInput;
  if (u.rol === "ADMIN") where = { adminId: u.id };
  else if (u.rol === "CLIENTE") where = { activo: true };
  else where = { empleados: { some: { usuarioId: u.id } } };

  const lista = await prisma.restaurante.findMany({
    where,
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      tipoCocina: true,
      ubicacion: true,
      zonaHoraria: true,
      activo: true,
      ...(u.rol === "ADMIN" ? { rfc: true, limiteMesas: true } : {}),
    },
  });
  res.json({ restaurantes: lista });
});

restaurantsRouter.get("/:id", requireAuth, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const u = req.user!;

  if (u.rol === "CLIENTE") {
    const r = await prisma.restaurante.findFirst({ where: { id, activo: true } });
    if (!r) throw notFound("Restaurante no encontrado");
  } else {
    await restauranteAutorizado(u, id, "personal");
  }

  const r = await prisma.restaurante.findUnique({
    where: { id },
    select: {
      id: true,
      nombre: true,
      tipoCocina: true,
      ubicacion: true,
      zonaHoraria: true,
      activo: true,
      ...(u.rol === "ADMIN" ? { rfc: true, limiteMesas: true } : {}),
      horarios: { orderBy: { diaSemana: "asc" } },
      pisos: {
        orderBy: { orden: "asc" },
        include: { areas: { include: { mesas: { orderBy: { etiqueta: "asc" } } } } },
      },
    },
  });
  res.json({ restaurante: r });
});

// El límite de mesas NO se edita aquí: está pendiente en el documento.
restaurantsRouter.patch("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "admin");
  const data = editarSchema.parse(req.body);
  const r = await prisma.restaurante.update({ where: { id }, data });
  await registrarAuditoria({
    actorId: req.user!.id,
    restauranteId: id,
    accion: "RESTAURANT_UPDATED",
    entidad: "restaurante",
    entidadId: id,
    detalle: data,
  });
  res.json({ restaurante: r });
});
