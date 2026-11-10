import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { AppError, conflict, forbidden, notFound, unprocessable } from "../../lib/errors.js";
import {
  PENALIZACION_NO_SHOW,
  RACHA_PAGADAS_BAJA,
  REPUTACION_MAX,
  aDecimal,
  centavos,
  nivelReputacion,
  puntosRecuperacion,
} from "./reputation.js";

export const lifecycleRouter = Router();

const TOLERANCIA_MS = 15 * 60_000;
const VENTANA_CANCELACION_MS = 2 * 60 * 60_000;
const uuid = z.uuid();

const incluir = {
  restaurante: { select: { id: true, nombre: true } },
  mesas: {
    include: {
      mesa: { select: { etiqueta: true, capacidad: true, estado: true, area: { select: { nombre: true } } } },
    },
  },
} as const;

async function cargar(id: string) {
  const r = await prisma.reserva.findUnique({ where: { id }, include: { mesas: true } });
  if (!r) throw notFound("Reserva no encontrada");
  return r;
}

const esPagada = (r: { condiciones: Prisma.JsonValue; importeAplicado: unknown }) =>
  (r.condiciones as { esPagada?: boolean } | null)?.esPagada === true || Number(r.importeAplicado) > 0;

type ReservaCliente = { id: string; clienteId: string; condiciones: Prisma.JsonValue };

// Penalización por no-show: exactamente una vez por reserva (restricción única en la BD)
async function aplicarNoShow(tx: Prisma.TransactionClient, r: ReservaCliente) {
  await tx.$queryRaw`SELECT "id" FROM "usuario" WHERE "id" = ${r.clienteId}::uuid FOR UPDATE`;
  const c = await tx.usuario.findUniqueOrThrow({ where: { id: r.clienteId } });
  const antes = centavos(c.reputacion);
  const despues = Math.max(0, antes - PENALIZACION_NO_SHOW);

  await tx.movimientoReputacion.create({
    data: {
      usuarioId: c.id,
      reservaId: r.id,
      tipo: "NO_SHOW",
      delta: aDecimal(despues - antes),
      reputacionAntes: aDecimal(antes),
      reputacionDespues: aDecimal(despues),
    },
  });
  // El no-show rompe la racha
  await tx.usuario.update({
    where: { id: c.id },
    data: { reputacion: aDecimal(despues), rachaPagadas: 0 },
  });
  return { antes: antes / 100, despues: despues / 100, delta: (despues - antes) / 100 };
}

// Recuperación al completar una reserva online
async function aplicarCompletada(tx: Prisma.TransactionClient, r: ReservaCliente & { pagada: boolean }) {
  await tx.$queryRaw`SELECT "id" FROM "usuario" WHERE "id" = ${r.clienteId}::uuid FOR UPDATE`;
  const c = await tx.usuario.findUniqueOrThrow({ where: { id: r.clienteId } });
  const antes = centavos(c.reputacion);
  const nivelAntes = nivelReputacion(antes / 100);

  let racha = c.rachaPagadas;
  let aplica = true;
  if (nivelAntes === "BAJA") {
    // En reputación baja solo cuentan las reservas pagadas, y hacen falta 5 seguidas
    if (r.pagada) racha += 1;
    aplica = r.pagada && racha >= RACHA_PAGADAS_BAJA;
  }

  let delta = 0;
  let n: number | null = null;
  if (aplica) {
    const ultimoNoShow = await tx.movimientoReputacion.findFirst({
      where: { usuarioId: c.id, tipo: "NO_SHOW" },
      orderBy: { createdAt: "desc" },
    });
    const previas = await tx.movimientoReputacion.count({
      where: {
        usuarioId: c.id,
        tipo: "RECOVERY",
        ...(ultimoNoShow ? { createdAt: { gt: ultimoNoShow.createdAt } } : {}),
      },
    });
    n = previas + 1;
    const despues = Math.min(REPUTACION_MAX, antes + puntosRecuperacion(n));
    delta = despues - antes;
    await tx.movimientoReputacion.create({
      data: {
        usuarioId: c.id,
        reservaId: r.id,
        tipo: "RECOVERY",
        delta: aDecimal(delta),
        reputacionAntes: aDecimal(antes),
        reputacionDespues: aDecimal(despues),
      },
    });
  }

  const nueva = antes + delta;
  if (nivelReputacion(nueva / 100) !== "BAJA") racha = 0;
  await tx.usuario.update({
    where: { id: c.id },
    data: { reputacion: aDecimal(nueva), rachaPagadas: racha },
  });
  return {
    antes: antes / 100,
    despues: nueva / 100,
    delta: delta / 100,
    n,
    rachaPagadas: racha,
    recuperacionAplicada: aplica,
  };
}

// ---------- Llegada ----------
lifecycleRouter.post(
  "/reservations/:id/check-in",
  requireAuth,
  requireRole("ADMIN", "RECEPCIONISTA"),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    const r = await cargar(id);
    await restauranteAutorizado(req.user!, r.restauranteId, "personal");

    const ahora = new Date();
    if (r.estado !== "UPCOMING") throw conflict(`La reserva está en estado ${r.estado}`);
    if (ahora < r.inicio) throw unprocessable("Aún no es la hora de la reserva");
    if (ahora >= r.fin) {
      throw unprocessable("La reserva ya terminó; cancélala o márcala como no-show");
    }

    const mesaIds = r.mesas.map((m) => m.mesaId);
    const ocupadas = await prisma.reservaMesa.findMany({
      where: { mesaId: { in: mesaIds }, reservaId: { not: id }, reserva: { estado: "CHECKED_IN" } },
      include: { mesa: { select: { etiqueta: true } } },
    });
    if (ocupadas.length > 0) {
      const etiquetas = [...new Set(ocupadas.map((o) => o.mesa.etiqueta))].join(", ");
      throw new AppError(409, "TABLE_OCCUPIED", `Mesa(s) aún ocupadas por otra reserva: ${etiquetas}`);
    }

    const reserva = await prisma.$transaction(async (tx) => {
      const u = await tx.reserva.updateMany({ where: { id, estado: "UPCOMING" }, data: { estado: "CHECKED_IN" } });
      if (u.count === 0) throw conflict("La reserva cambió de estado; vuelve a consultarla");
      await tx.mesa.updateMany({
        where: { id: { in: mesaIds }, estado: { not: "OUT_OF_SERVICE" } },
        data: { estado: "OCCUPIED" },
      });
      return tx.reserva.findUniqueOrThrow({ where: { id }, include: incluir });
    });

    const llegadaTardia = ahora.getTime() > r.inicio.getTime() + TOLERANCIA_MS;
    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: r.restauranteId, accion: "RESERVATION_CHECKED_IN",
      entidad: "reserva", entidadId: id, detalle: { llegadaTardia },
    });
    res.json({ reserva, llegadaTardia });
  },
);

// ---------- Finalización ----------
lifecycleRouter.post(
  "/reservations/:id/complete",
  requireAuth,
  requireRole("ADMIN", "RECEPCIONISTA"),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    const r = await cargar(id);
    await restauranteAutorizado(req.user!, r.restauranteId, "personal");
    if (r.estado !== "CHECKED_IN") throw conflict(`Solo se puede finalizar una reserva con llegada registrada (estado actual: ${r.estado})`);

    const mesaIds = r.mesas.map((m) => m.mesaId);
    const pagada = esPagada(r);

    const resultado = await prisma.$transaction(async (tx) => {
      const u = await tx.reserva.updateMany({ where: { id, estado: "CHECKED_IN" }, data: { estado: "COMPLETED" } });
      if (u.count === 0) throw conflict("La reserva cambió de estado; vuelve a consultarla");

      // Libera todas las mesas de inmediato (sin estado de limpieza)
      await tx.mesa.updateMany({
        where: { id: { in: mesaIds }, estado: { not: "OUT_OF_SERVICE" } },
        data: { estado: "AVAILABLE" },
      });

      // Las presenciales sin cuenta no tocan reputación
      const reputacion =
        r.clienteId && r.origen === "ONLINE"
          ? await aplicarCompletada(tx, { id, clienteId: r.clienteId, condiciones: r.condiciones, pagada })
          : null;

      const reserva = await tx.reserva.findUniqueOrThrow({ where: { id }, include: incluir });
      return { reserva, reputacion };
    });

    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: r.restauranteId, accion: "RESERVATION_COMPLETED",
      entidad: "reserva", entidadId: id, detalle: resultado.reputacion ?? undefined,
    });
    res.json(resultado);
  },
);

// ---------- No-show ----------
lifecycleRouter.post(
  "/reservations/:id/noshow",
  requireAuth,
  requireRole("ADMIN", "RECEPCIONISTA"),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    const r = await cargar(id);
    await restauranteAutorizado(req.user!, r.restauranteId, "personal");
    if (r.estado !== "UPCOMING") throw conflict(`Solo se puede marcar no-show una reserva pendiente (estado actual: ${r.estado})`);

    const limite = new Date(r.inicio.getTime() + TOLERANCIA_MS);
    if (new Date() < limite) {
      throw unprocessable(`Debes esperar la tolerancia de 15 minutos (hasta ${limite.toISOString()})`);
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const u = await tx.reserva.updateMany({ where: { id, estado: "UPCOMING" }, data: { estado: "NO_SHOW" } });
      if (u.count === 0) throw conflict("La reserva cambió de estado; vuelve a consultarla");

      const reputacion =
        r.clienteId && r.origen === "ONLINE"
          ? await aplicarNoShow(tx, { id, clienteId: r.clienteId, condiciones: r.condiciones })
          : null;

      const reserva = await tx.reserva.findUniqueOrThrow({ where: { id }, include: incluir });
      return { reserva, reputacion };
    });

    await registrarAuditoria({
      actorId: req.user!.id, restauranteId: r.restauranteId, accion: "RESERVATION_NO_SHOW",
      entidad: "reserva", entidadId: id, detalle: resultado.reputacion ?? undefined,
    });
    res.json(resultado);
  },
);

// ---------- Cancelación ----------
const cancelSchema = z.object({ motivo: z.string().trim().min(3).max(300).optional() });

lifecycleRouter.post("/reservations/:id/cancel", requireAuth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const u = req.user!;
  const r = await cargar(id);
  const { motivo } = cancelSchema.parse(req.body ?? {});

  let politica: string;
  if (u.rol === "CLIENTE") {
    // 404 y no 403, para no revelar que la reserva existe
    if (r.clienteId !== u.id) throw notFound("Reserva no encontrada");
    if (esPagada(r)) {
      throw new AppError(409, "PAID_CANCELLATION_UNAVAILABLE", "La cancelación de reservas pagadas aún no está disponible");
    }
    if (r.inicio.getTime() - Date.now() < VENTANA_CANCELACION_MS) {
      throw new AppError(409, "CANCELLATION_WINDOW_CLOSED", "Solo puedes cancelar con al menos 2 horas de anticipación");
    }
    politica = "FREE_CLIENT_2H";
  } else if (u.rol === "MESERO") {
    throw forbidden();
  } else {
    await restauranteAutorizado(u, r.restauranteId, "personal");
    if (!motivo) throw unprocessable("El motivo es obligatorio al cancelar desde el restaurante");
    politica = "STAFF_CANCEL";
  }

  if (r.estado !== "UPCOMING" && r.estado !== "PENDING_PAYMENT") {
    throw conflict(`No se puede cancelar una reserva en estado ${r.estado}`);
  }

  const reserva = await prisma.$transaction(async (tx) => {
    const x = await tx.reserva.updateMany({
      where: { id, estado: { in: ["UPCOMING", "PENDING_PAYMENT"] } },
      data: {
        estado: "CANCELLED",
        canceladaPorId: u.id,
        canceladaEn: new Date(),
        motivoCancelacion: motivo ?? null,
        politicaAplicada: politica,
      },
    });
    if (x.count === 0) throw conflict("La reserva cambió de estado; vuelve a consultarla");
    return tx.reserva.findUniqueOrThrow({ where: { id }, include: incluir });
  });

  await registrarAuditoria({
    actorId: u.id, restauranteId: r.restauranteId, accion: "RESERVATION_CANCELLED",
    entidad: "reserva", entidadId: id, detalle: { politica, motivo },
  });
  res.json({ reserva });
});
