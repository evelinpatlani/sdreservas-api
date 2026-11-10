import { prisma } from "./prisma.js";

export async function registrarAuditoria(d: {
  actorId: string;
  restauranteId?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  detalle?: unknown;
}) {
  await prisma.auditoriaOperacion.create({
    data: {
      actorId: d.actorId,
      restauranteId: d.restauranteId ?? null,
      accion: d.accion,
      entidad: d.entidad,
      entidadId: d.entidadId ?? null,
      detalle: (d.detalle ?? undefined) as any,
    },
  });
}
