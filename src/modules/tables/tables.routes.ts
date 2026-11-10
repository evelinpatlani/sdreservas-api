import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";
import { esViolacionUnica } from "../../lib/prismaErrors.js";

export const tablesRouter = Router();

const uuid = z.uuid();

const crearSchema = z.object({
  areaId: uuid,
  etiqueta: z.string().trim().min(1).max(40),
  capacidad: z.number().int().min(1).max(100),
  forma: z.string().trim().min(1).max(30).optional(),
});

const editarSchema = z
  .object({
    areaId: uuid,
    etiqueta: z.string().trim().min(1).max(40),
    capacidad: z.number().int().min(1).max(100),
    forma: z.string().trim().min(1).max(30),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, "Envía al menos un campo");

const estadoSchema = z.object({
  estado: z.enum(["AVAILABLE", "RESERVED", "OCCUPIED", "OUT_OF_SERVICE"]),
  motivo: z.string().trim().max(300).optional(),
});

async function reservasFuturasActivas(mesaId: string) {
  return prisma.reservaMesa.count({
    where: { mesaId, activa: true, fin: { gt: new Date() } },
  });
}

// Crear mesa respetando el límite, incluso con peticiones concurrentes
tablesRouter.post("/restaurants/:id/tables", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "admin");
  const data = crearSchema.parse(req.body);

  const area = await prisma.area.findFirst({
    where: { id: data.areaId, piso: { restauranteId: id } },
  });
  if (!area) throw unprocessable("El área no pertenece a este restaurante");

  try {
    const mesa = await prisma.$transaction(async (tx) => {
      // Bloquea la fila del restaurante: las demás creaciones esperan aquí
      const filas = await tx.$queryRaw<{ limiteMesas: number }[]>`
        SELECT "limiteMesas" FROM "restaurante" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const limite = filas[0]?.limiteMesas ?? 0;
      const total = await tx.mesa.count({ where: { restauranteId: id } });
      if (total >= limite) {
        throw conflict(`Se alcanzó el límite máximo de mesas (${limite})`);
      }
      return tx.mesa.create({ data: { ...data, restauranteId: id } });
    });

    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: id, accion: "TABLE_CREATED", entidad: "mesa", entidadId: mesa.id,
    });
    res.status(201).json({ mesa });
  } catch (e) {
    if (esViolacionUnica(e)) throw conflict("Ya existe una mesa con esa etiqueta");
    throw e;
  }
});

tablesRouter.get("/restaurants/:id/tables", requireAuth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  await restauranteAutorizado(req.user!, id, "personal");
  const mesas = await prisma.mesa.findMany({
    where: { restauranteId: id },
    include: { area: { select: { nombre: true, piso: { select: { nombre: true } } } } },
    orderBy: { etiqueta: "asc" },
  });
  res.json({ mesas });
});

tablesRouter.patch("/tables/:tableId", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const tableId = uuid.parse(req.params.tableId);
  const mesa = await prisma.mesa.findUnique({ where: { id: tableId } });
  if (!mesa) throw notFound("Mesa no encontrada");
  await restauranteAutorizado(req.user!, mesa.restauranteId, "admin");
  const data = editarSchema.parse(req.body);

  // V1: no se cambia capacidad ni área si hay reservas futuras (decisión pendiente en el documento)
  if ((data.capacidad !== undefined || data.areaId !== undefined) && (await reservasFuturasActivas(tableId)) > 0) {
    throw conflict("La mesa tiene reservas futuras; no se puede cambiar su capacidad o área");
  }
  if (data.areaId) {
    const area = await prisma.area.findFirst({
      where: { id: data.areaId, piso: { restauranteId: mesa.restauranteId } },
    });
    if (!area) throw unprocessable("El área no pertenece a este restaurante");
  }

  try {
    const actualizada = await prisma.mesa.update({ where: { id: tableId }, data });
    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: mesa.restauranteId, accion: "TABLE_UPDATED",
      entidad: "mesa", entidadId: tableId, detalle: data,
    });
    res.json({ mesa: actualizada });
  } catch (e) {
    if (esViolacionUnica(e)) throw conflict("Ya existe una mesa con esa etiqueta");
    throw e;
  }
});

// Cambio de estado: solo ADMIN y RECEPCIONISTA (mesero pendiente de reconfirmar)
tablesRouter.patch(
  "/tables/:tableId/status",
  requireAuth,
  requireRole("ADMIN", "RECEPCIONISTA"),
  async (req, res) => {
    const tableId = uuid.parse(req.params.tableId);
    const mesa = await prisma.mesa.findUnique({ where: { id: tableId } });
    if (!mesa) throw notFound("Mesa no encontrada");
    await restauranteAutorizado(req.user!, mesa.restauranteId, "personal");
    const { estado, motivo } = estadoSchema.parse(req.body);

    if (estado === "OUT_OF_SERVICE") {
      const futuras = await reservasFuturasActivas(tableId);
      if (futuras > 0) {
        await registrarAuditoria({
          actorId: req.user!.id, restauranteId: mesa.restauranteId, accion: "TABLE_STATUS_REJECTED",
          entidad: "mesa", entidadId: tableId,
          detalle: { intento: estado, motivoRechazo: "Reservas futuras sin resolver", reservasFuturas: futuras },
        });
        throw conflict(`La mesa tiene ${futuras} reserva(s) futura(s); resuélvelas antes de ponerla fuera de servicio`);
      }
    }

    const actualizada = await prisma.mesa.update({ where: { id: tableId }, data: { estado } });
    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: mesa.restauranteId, accion: "TABLE_STATUS_CHANGED",
      entidad: "mesa", entidadId: tableId, detalle: { de: mesa.estado, a: estado, motivo },
    });
    res.json({ mesa: actualizada });
  },
);

tablesRouter.delete("/tables/:tableId", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const tableId = uuid.parse(req.params.tableId);
  const mesa = await prisma.mesa.findUnique({ where: { id: tableId } });
  if (!mesa) throw notFound("Mesa no encontrada");
  await restauranteAutorizado(req.user!, mesa.restauranteId, "admin");

  const historial = await prisma.reservaMesa.count({ where: { mesaId: tableId } });
  if (historial > 0) throw conflict("La mesa tiene reservas en su historial; no se puede eliminar");

  await prisma.mesa.delete({ where: { id: tableId } });
  await registrarAuditoria({
    actorId: req.user!.id, restauranteId: mesa.restauranteId, accion: "TABLE_DELETED", entidad: "mesa", entidadId: tableId,
  });
  res.status(204).end();
});
