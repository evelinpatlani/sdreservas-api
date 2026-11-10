import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { AppError, notFound, unprocessable } from "../../lib/errors.js";
import { esSolape } from "../../lib/prismaErrors.js";
import { ahoraLocal, diaSemana, fechaValida, localToUtc } from "../../lib/time.js";
import { DURACIONES } from "./availability.js";

export const staffRouter = Router();

const presencialSchema = z
  .object({
    nombre: z.string().trim().min(2).max(100),
    personas: z.number().int().min(1).max(200),
    mesaIds: z.array(z.uuid()).min(1).max(15),
    duracion: z.number().int().default(90),
  })
  .superRefine((d, ctx) => {
    if (new Set(d.mesaIds).size !== d.mesaIds.length) {
      ctx.addIssue({ code: "custom", message: "Hay mesas repetidas", path: ["mesaIds"] });
    }
    if (!DURACIONES.includes(d.duracion)) {
      ctx.addIssue({
        code: "custom",
        message: `Duración no permitida. Usa: ${DURACIONES.join(", ")}`,
        path: ["duracion"],
      });
    }
  });

const incluir = {
  restaurante: { select: { id: true, nombre: true } },
  cliente: { select: { id: true, nombre: true, email: true } },
  mesas: {
    include: {
      mesa: { select: { etiqueta: true, capacidad: true, area: { select: { nombre: true } } } },
    },
  },
} as const;

// Reserva presencial sin cuenta: inicia ahora, una o varias mesas
staffRouter.post(
  "/restaurants/:id/reservations",
  requireAuth,
  requireRole("ADMIN", "RECEPCIONISTA"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await restauranteAutorizado(req.user!, id, "personal");
    const data = presencialSchema.parse(req.body);
    const actorId = req.user!.id;

    let reserva;
    try {
      reserva = await prisma.$transaction(
        async (tx) => {
          // Serializa las creaciones de este restaurante
          await tx.$queryRaw`SELECT "id" FROM "restaurante" WHERE "id" = ${id}::uuid FOR UPDATE`;

          const restaurante = await tx.restaurante.findUnique({ where: { id } });
          if (!restaurante) throw notFound("Restaurante no encontrado");
          if (!restaurante.activo) throw unprocessable("El restaurante está inactivo");

          const inicio = new Date();
          const fin = new Date(inicio.getTime() + data.duracion * 60_000);

          // Hoy debe estar abierto y la reserva no puede terminar después del cierre
          const ahora = ahoraLocal(restaurante.zonaHoraria, inicio);
          const horario = await tx.horarioRestaurante.findUnique({
            where: {
              restauranteId_diaSemana: { restauranteId: id, diaSemana: diaSemana(ahora.fecha) },
            },
          });
          if (!horario) throw unprocessable("El restaurante está cerrado hoy");
          if (ahora.minutos < horario.aperturaMin || ahora.minutos + data.duracion > horario.cierreMin) {
            throw unprocessable("La reserva queda fuera del horario del restaurante");
          }

          // Mesas: del mismo restaurante, en servicio y con capacidad suficiente en conjunto
          const mesas = await tx.mesa.findMany({
            where: { id: { in: data.mesaIds }, restauranteId: id },
          });
          if (mesas.length !== data.mesaIds.length) {
            throw unprocessable("Alguna mesa no pertenece a este restaurante");
          }
          const fuera = mesas.filter((m) => m.estado === "OUT_OF_SERVICE");
          if (fuera.length > 0) {
            throw new AppError(
              409,
              "TABLE_OUT_OF_SERVICE",
              `Mesa(s) fuera de servicio: ${fuera.map((m) => m.etiqueta).join(", ")}`,
            );
          }
          const capacidad = mesas.reduce((s, m) => s + m.capacidad, 0);
          if (capacidad < data.personas) {
            throw unprocessable(
              `Capacidad insuficiente: las mesas suman ${capacidad} lugares para ${data.personas} personas`,
            );
          }

          // Conflicto con reservas activas (no se reasigna ni se finaliza nada)
          const ocupadas = await tx.reservaMesa.findMany({
            where: {
              mesaId: { in: data.mesaIds },
              activa: true,
              inicio: { lt: fin },
              fin: { gt: inicio },
            },
            include: { mesa: { select: { etiqueta: true } } },
          });
          if (ocupadas.length > 0) {
            const etiquetas = [...new Set(ocupadas.map((o) => o.mesa.etiqueta))].join(", ");
            throw new AppError(409, "TABLE_TAKEN", `Mesa(s) ocupadas o reservadas en ese horario: ${etiquetas}`);
          }

          return tx.reserva.create({
            data: {
              restauranteId: id,
              clienteId: null,
              nombreInvitado: data.nombre,
              personas: data.personas,
              origen: "PRESENCIAL",
              modalidadId: null,
              inicio,
              fin,
              duracionMin: data.duracion,
              estado: "UPCOMING",
              importeAplicado: 0,
              condiciones: { origen: "PRESENCIAL", esPagada: false, importe: 0 },
              creadaPorId: actorId,
              mesas: {
                create: data.mesaIds.map((mesaId) => ({ mesaId, inicio, fin, activa: true })),
              },
            },
            include: incluir,
          });
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (e) {
      if (esSolape(e)) {
        throw new AppError(409, "TABLE_TAKEN", "Alguna mesa acaba de ser reservada; intenta de nuevo");
      }
      throw e;
    }

    await registrarAuditoria({
      actorId,
      restauranteId: id,
      accion: "WALKIN_RESERVATION_CREATED",
      entidad: "reserva",
      entidadId: reserva.id,
      detalle: { personas: data.personas, mesas: data.mesaIds, duracion: data.duracion },
    });
    res.status(201).json({ reserva });
  },
);

const listaSchema = z.object({
  date: z.string().optional(),
  estado: z
    .enum(["PENDING_PAYMENT", "UPCOMING", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// Reservas del restaurante (admin dueño y recepcionistas asignados)
staffRouter.get(
  "/restaurants/:id/reservations",
  requireAuth,
  requireRole("ADMIN", "RECEPCIONISTA"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const restaurante = await restauranteAutorizado(req.user!, id, "personal");
    const q = listaSchema.parse(req.query);

    let rango = {};
    if (q.date) {
      if (!fechaValida(q.date)) throw unprocessable("Fecha inválida");
      const desde = localToUtc(q.date, 0, restaurante.zonaHoraria);
      const hasta = localToUtc(q.date, 1440, restaurante.zonaHoraria);
      rango = { inicio: { gte: desde, lt: hasta } };
    }

    const reservas = await prisma.reserva.findMany({
      where: { restauranteId: id, ...(q.estado ? { estado: q.estado } : {}), ...rango },
      orderBy: { inicio: "asc" },
      take: q.limit,
      include: incluir,
    });
    res.json({ reservas });
  },
);

