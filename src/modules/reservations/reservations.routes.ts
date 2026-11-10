import { Router } from "express";
import { z } from "zod";
import type { EstadoReserva } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { AppError, forbidden, notFound, unprocessable } from "../../lib/errors.js";
import { esSolape } from "../../lib/prismaErrors.js";
import { calcularVentana, mesasLibres } from "./availability.js";
import { LIMITES, nivelReputacion } from "./reputation.js";

export const reservationsRouter = Router();

const ESTADOS_ACTIVOS: EstadoReserva[] = ["PENDING_PAYMENT", "UPCOMING", "CHECKED_IN"];

const crearSchema = z
  .object({
    restauranteId: z.uuid(),
    modalidad: z.enum(["AUTO_FREE", "ZONE_FREE", "TABLE_FREE"]),
    fecha: z.string(),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM"),
    duracion: z.number().int(),
    personas: z.number().int().min(1).max(100),
    areaId: z.uuid().optional(),
    mesaId: z.uuid().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.modalidad === "ZONE_FREE" && !d.areaId) {
      ctx.addIssue({ code: "custom", message: "areaId es obligatorio con ZONE_FREE", path: ["areaId"] });
    }
    if (d.modalidad === "TABLE_FREE" && !d.mesaId) {
      ctx.addIssue({ code: "custom", message: "mesaId es obligatorio con TABLE_FREE", path: ["mesaId"] });
    }
  });

const incluir = {
  restaurante: { select: { id: true, nombre: true } },
  mesas: {
    include: {
      mesa: { select: { etiqueta: true, capacidad: true, area: { select: { nombre: true } } } },
    },
  },
} as const;

reservationsRouter.post("/reservations", requireAuth, requireRole("CLIENTE"), async (req, res) => {
  const data = crearSchema.parse(req.body);
  const clienteId = req.user!.id;

  let reserva;
  try {
    reserva = await prisma.$transaction(
      async (tx) => {
        // Bloqueos siempre en este orden: restaurante y luego cliente
        await tx.$queryRaw`SELECT "id" FROM "restaurante" WHERE "id" = ${data.restauranteId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "usuario" WHERE "id" = ${clienteId}::uuid FOR UPDATE`;

        const restaurante = await tx.restaurante.findFirst({
          where: { id: data.restauranteId, activo: true },
        });
        if (!restaurante) throw notFound("Restaurante no encontrado");

        const cliente = await tx.usuario.findUnique({ where: { id: clienteId } });
        if (!cliente) throw notFound("Cliente no encontrado");

        // Fecha, hora y duración contra el horario del restaurante
        const v = await calcularVentana(restaurante, data.fecha, data.hora, data.duracion, { pasoDe30: true }, tx);
        if (!v.ok) throw unprocessable(v.motivo);

        // La modalidad debe estar activa en este restaurante
        const config = await tx.restauranteModalidad.findFirst({
          where: { restauranteId: restaurante.id, activa: true, modalidad: { codigo: data.modalidad } },
        });
        if (!config) throw unprocessable("Esa modalidad no está activa en este restaurante");

        // Reputación y cupos
        const reputacion = Number(cliente.reputacion);
        const nivel = nivelReputacion(reputacion);
        const limites = LIMITES[nivel];
        if (!limites.gratuitas) {
          throw new AppError(
            403,
            "REPUTATION_RESTRICTED",
            "Con tu reputación actual solo puedes reservar con modalidades de pago",
          );
        }

        const totalPlataforma = await tx.reserva.count({
          where: { clienteId, estado: { in: ESTADOS_ACTIVOS } },
        });
        if (totalPlataforma >= limites.plataforma) {
          throw new AppError(
            409,
            "LIMIT_PLATFORM",
            `Alcanzaste el máximo de ${limites.plataforma} reservas activas en la plataforma`,
          );
        }
        const totalRestaurante = await tx.reserva.count({
          where: { clienteId, restauranteId: restaurante.id, estado: { in: ESTADOS_ACTIVOS } },
        });
        if (totalRestaurante >= limites.restaurante) {
          throw new AppError(
            409,
            "LIMIT_RESTAURANT",
            `Alcanzaste el máximo de ${limites.restaurante} reservas activas en este restaurante`,
          );
        }

        // Elección de mesa según la modalidad
        const libres = await mesasLibres(tx, restaurante.id, v.inicio, v.fin, data.personas);
        let mesa;
        if (data.modalidad === "AUTO_FREE") {
          mesa = libres[0];
        } else if (data.modalidad === "ZONE_FREE") {
          const area = await tx.area.findFirst({
            where: { id: data.areaId!, piso: { restauranteId: restaurante.id } },
          });
          if (!area) throw unprocessable("El área no pertenece a este restaurante");
          mesa = libres.find((m) => m.area.id === area.id);
        } else {
          mesa = libres.find((m) => m.id === data.mesaId);
        }
        if (!mesa) {
          throw new AppError(
            409,
            "NO_TABLE_AVAILABLE",
            "No hay mesa disponible para ese horario y número de personas",
          );
        }

        return tx.reserva.create({
          data: {
            restauranteId: restaurante.id,
            clienteId,
            personas: data.personas,
            origen: "ONLINE",
            modalidadId: config.modalidadId,
            inicio: v.inicio,
            fin: v.fin,
            duracionMin: data.duracion,
            estado: "UPCOMING",
            importeAplicado: 0,
            condiciones: {
              modalidad: data.modalidad,
              esPagada: false,
              importe: 0,
              reputacionAlReservar: reputacion,
            },
            creadaPorId: clienteId,
            mesas: { create: { mesaId: mesa.id, inicio: v.inicio, fin: v.fin, activa: true } },
          },
          include: incluir,
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  } catch (e) {
    if (esSolape(e)) {
      throw new AppError(409, "TABLE_TAKEN", "Esa mesa acaba de ser reservada por otra persona; intenta de nuevo");
    }
    throw e;
  }

  await registrarAuditoria({
    actorId: clienteId,
    restauranteId: reserva.restauranteId,
    accion: "RESERVATION_CREATED",
    entidad: "reserva",
    entidadId: reserva.id,
    detalle: { modalidad: data.modalidad, mesaId: reserva.mesas[0]?.mesaId },
  });
  res.status(201).json({ reserva });
});

// Antes de /reservations/:id para que "mine" no se tome como un id
reservationsRouter.get("/reservations/mine", requireAuth, requireRole("CLIENTE"), async (req, res) => {
  const estado = z
    .enum(["PENDING_PAYMENT", "UPCOMING", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"])
    .optional()
    .parse(req.query.estado);

  const reservas = await prisma.reserva.findMany({
    where: { clienteId: req.user!.id, ...(estado ? { estado } : {}) },
    orderBy: { inicio: "desc" },
    include: incluir,
  });
  res.json({ reservas });
});

reservationsRouter.get("/reservations/:id", requireAuth, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const r = await prisma.reserva.findUnique({ where: { id }, include: incluir });
  if (!r) throw notFound("Reserva no encontrada");

  const u = req.user!;
  if (u.rol === "CLIENTE") {
    // 404 y no 403, para no revelar que la reserva existe
    if (r.clienteId !== u.id) throw notFound("Reserva no encontrada");
  } else if (u.rol === "MESERO") {
    throw forbidden();
  } else {
    await restauranteAutorizado(u, r.restauranteId, "personal");
  }
  res.json({ reserva: r });
});	

