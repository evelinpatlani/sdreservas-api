import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { LIMITES, nivelReputacion } from "./reputation.js";

export const meRouter = Router();

meRouter.get("/me/reputation", requireAuth, requireRole("CLIENTE"), async (req, res) => {
  const c = await prisma.usuario.findUniqueOrThrow({ where: { id: req.user!.id } });
  const valor = Number(c.reputacion);
  const nivel = nivelReputacion(valor);

  const activas = await prisma.reserva.groupBy({
    by: ["restauranteId"],
    where: { clienteId: c.id, estado: { in: ["PENDING_PAYMENT", "UPCOMING", "CHECKED_IN"] } },
    _count: { _all: true },
  });

  res.json({
    reputacion: valor,
    nivel,
    limites: LIMITES[nivel],
    activas: {
      plataforma: activas.reduce((s, a) => s + a._count._all, 0),
      porRestaurante: activas.map((a) => ({ restauranteId: a.restauranteId, total: a._count._all })),
    },
    rachaPagadas: c.rachaPagadas,
  });
});

meRouter.get("/me/reputation/history", requireAuth, requireRole("CLIENTE"), async (req, res) => {
  const movimientos = await prisma.movimientoReputacion.findMany({
    where: { usuarioId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, tipo: true, delta: true, reputacionAntes: true,
      reputacionDespues: true, reservaId: true, createdAt: true,
    },
  });
  res.json({ movimientos });
});
