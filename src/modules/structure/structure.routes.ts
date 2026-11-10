import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";
import { esViolacionUnica } from "../../lib/prismaErrors.js";

export const structureRouter = Router();

const uuid = z.uuid();

// ---------- Pisos ----------
structureRouter.post("/restaurants/:id/floors", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "admin");
  const data = z
    .object({ nombre: z.string().trim().min(1).max(60), orden: z.number().int().min(0).optional() })
    .parse(req.body);
  try {
    const piso = await prisma.piso.create({ data: { ...data, restauranteId: id } });
    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: id, accion: "FLOOR_CREATED", entidad: "piso", entidadId: piso.id,
    });
    res.status(201).json({ piso });
  } catch (e) {
    if (esViolacionUnica(e)) throw conflict("Ya existe un piso con ese nombre");
    throw e;
  }
});

structureRouter.get("/restaurants/:id/floors", requireAuth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "personal");
  const pisos = await prisma.piso.findMany({ where: { restauranteId: id }, orderBy: { orden: "asc" } });
  res.json({ pisos });
});

structureRouter.delete("/floors/:floorId", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const floorId = uuid.parse(req.params.floorId);
  const piso = await prisma.piso.findUnique({ where: { id: floorId } });
  if (!piso) throw notFound("Piso no encontrado");
  await restauranteAutorizado(req.user!, piso.restauranteId, "admin");

  const mesas = await prisma.mesa.count({ where: { area: { pisoId: floorId } } });
  if (mesas > 0) throw conflict("El piso tiene mesas; elimínalas o muévelas primero");

  await prisma.piso.delete({ where: { id: floorId } });
  await registrarAuditoria({
    actorId: req.user!.id, restauranteId: piso.restauranteId, accion: "FLOOR_DELETED", entidad: "piso", entidadId: floorId,
  });
  res.status(204).end();
});

// ---------- Áreas ----------
structureRouter.post("/restaurants/:id/areas", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "admin");
  const data = z.object({ pisoId: uuid, nombre: z.string().trim().min(1).max(60) }).parse(req.body);

  const piso = await prisma.piso.findFirst({ where: { id: data.pisoId, restauranteId: id } });
  if (!piso) throw unprocessable("El piso no pertenece a este restaurante");

  try {
    const area = await prisma.area.create({ data });
    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: id, accion: "AREA_CREATED", entidad: "area", entidadId: area.id,
    });
    res.status(201).json({ area });
  } catch (e) {
    if (esViolacionUnica(e)) throw conflict("Ya existe un área con ese nombre en ese piso");
    throw e;
  }
});

structureRouter.get("/restaurants/:id/areas", requireAuth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "personal");
  const areas = await prisma.area.findMany({
    where: { piso: { restauranteId: id } },
    include: { piso: { select: { nombre: true } } },
  });
  res.json({ areas });
});

structureRouter.delete("/areas/:areaId", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const areaId = uuid.parse(req.params.areaId);
  const area = await prisma.area.findUnique({ where: { id: areaId }, include: { piso: true } });
  if (!area) throw notFound("Área no encontrada");
  await restauranteAutorizado(req.user!, area.piso.restauranteId, "admin");

  const mesas = await prisma.mesa.count({ where: { areaId } });
  if (mesas > 0) throw conflict("El área tiene mesas; elimínalas o muévelas primero");

  await prisma.area.delete({ where: { id: areaId } });
  res.status(204).end();
});

// ---------- Horarios ----------
const hora = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "Formato HH:MM");
const aMin = (h: string) => {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
};
const aHora = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const horariosSchema = z
  .array(z.object({ diaSemana: z.number().int().min(0).max(6), apertura: hora, cierre: hora }))
  .max(7)
  .superRefine((arr, ctx) => {
    const vistos = new Set<number>();
    arr.forEach((h, i) => {
      if (vistos.has(h.diaSemana)) ctx.addIssue({ code: "custom", message: "Día repetido", path: [i] });
      vistos.add(h.diaSemana);
      if (aMin(h.cierre) <= aMin(h.apertura))
        ctx.addIssue({ code: "custom", message: "El cierre debe ser posterior a la apertura", path: [i] });
    });
  });

const formatear = (hs: { diaSemana: number; aperturaMin: number; cierreMin: number }[]) =>
  hs.map((h) => ({ diaSemana: h.diaSemana, apertura: aHora(h.aperturaMin), cierre: aHora(h.cierreMin) }));

// Dato público para que el cliente vea cuándo abre el restaurante
structureRouter.get("/restaurants/:id/hours", requireAuth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const r = await prisma.restaurante.findUnique({ where: { id } });
  if (!r) throw notFound("Restaurante no encontrado");
  const hs = await prisma.horarioRestaurante.findMany({ where: { restauranteId: id }, orderBy: { diaSemana: "asc" } });
  res.json({ zonaHoraria: r.zonaHoraria, horarios: formatear(hs) });
});

// Reemplaza el horario completo (los días no enviados quedan cerrados)
structureRouter.put("/restaurants/:id/hours", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "admin");
  const horarios = horariosSchema.parse(req.body?.horarios);

  await prisma.$transaction([
    prisma.horarioRestaurante.deleteMany({ where: { restauranteId: id } }),
    prisma.horarioRestaurante.createMany({
      data: horarios.map((h) => ({
        restauranteId: id,
        diaSemana: h.diaSemana,
        aperturaMin: aMin(h.apertura),
        cierreMin: aMin(h.cierre),
      })),
    }),
  ]);
  await registrarAuditoria({
    actorId: req.user!.id, restauranteId: id, accion: "HOURS_UPDATED", entidad: "horario_restaurante", detalle: horarios,
  });
  res.json({ horarios });
});

