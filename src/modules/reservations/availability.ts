import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { diaSemana, fechaValida, horaAMinutos, localToUtc } from "../../lib/time.js";

export const DURACIONES = [30, 60, 90, 120, 180];

type Db = PrismaClient | Prisma.TransactionClient;

export type Ventana = { ok: true; inicio: Date; fin: Date } | { ok: false; motivo: string };

// Valida fecha, hora y duración contra el horario del restaurante
export async function calcularVentana(
  restaurante: { id: string; zonaHoraria: string },
  fecha: string,
  hora: string,
  duracion: number,
  opciones: { pasoDe30: boolean },
  db: Db = prisma,
): Promise<Ventana> {
  if (!fechaValida(fecha)) return { ok: false, motivo: "Fecha inválida" };
  if (!DURACIONES.includes(duracion)) {
    return { ok: false, motivo: `Duración no permitida. Usa: ${DURACIONES.join(", ")} minutos` };
  }

  const inicioMin = horaAMinutos(hora);
  if (opciones.pasoDe30 && inicioMin % 30 !== 0) {
    return { ok: false, motivo: "La hora de inicio debe ser en intervalos de 30 minutos" };
  }

  const horario = await db.horarioRestaurante.findUnique({
    where: {
      restauranteId_diaSemana: { restauranteId: restaurante.id, diaSemana: diaSemana(fecha) },
    },
  });
  if (!horario) return { ok: false, motivo: "El restaurante está cerrado ese día" };

  if (inicioMin < horario.aperturaMin || inicioMin + duracion > horario.cierreMin) {
    return { ok: false, motivo: "La reserva queda fuera del horario del restaurante" };
  }

  const inicio = localToUtc(fecha, inicioMin, restaurante.zonaHoraria);
  const fin = new Date(inicio.getTime() + duracion * 60_000);
  if (inicio.getTime() <= Date.now()) return { ok: false, motivo: "Esa hora ya pasó" };

  return { ok: true, inicio, fin };
}

// Mesas sin reservas activas que se solapen, ordenadas de menor a mayor capacidad
export function mesasLibres(
  db: Db,
  restauranteId: string,
  inicio: Date,
  fin: Date,
  personas: number,
) {
  return db.mesa.findMany({
    where: {
      restauranteId,
      estado: { not: "OUT_OF_SERVICE" },
      capacidad: { gte: personas },
      reservas: { none: { activa: true, inicio: { lt: fin }, fin: { gt: inicio } } },
    },
    include: {
      area: { select: { id: true, nombre: true, piso: { select: { nombre: true } } } },
    },
    orderBy: [{ capacidad: "asc" }, { etiqueta: "asc" }],
  });
}
