import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { notFound, unprocessable } from "../../lib/errors.js";

export const methodsRouter = Router();

// Fase 5: solo las gratuitas. Las pagadas se habilitan en la fase de pagos.
export const MODALIDADES_HABILITABLES = ["AUTO_FREE", "ZONE_FREE", "TABLE_FREE"];

// Catálogo completo de la plataforma
methodsRouter.get("/reservation-methods", requireAuth, async (_req, res) => {
  const catalogo = await prisma.modalidadReserva.findMany({ orderBy: { codigo: "asc" } });
  res.json({
    modalidades: catalogo.map((m) => ({
      codigo: m.codigo,
      nombre: m.nombre,
      esPagada: m.esPagada,
      habilitable: MODALIDADES_HABILITABLES.includes(m.codigo),
    })),
  });
});

// Modalidades de un restaurante. El cliente solo ve las activas.
methodsRouter.get("/restaurants/:id/reservation-methods", requireAuth, async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const u = req.user!;

  if (u.rol === "CLIENTE") {
    const r = await prisma.restaurante.findFirst({ where: { id, activo: true } });
    if (!r) throw notFound("Restaurante no encontrado");
  } else {
    await restauranteAutorizado(u, id, "personal");
  }

  const [catalogo, config] = await Promise.all([
    prisma.modalidadReserva.findMany({ orderBy: { codigo: "asc" } }),
    prisma.restauranteModalidad.findMany({ where: { restauranteId: id } }),
  ]);
  const porModalidad = new Map(config.map((c) => [c.modalidadId, c]));

  let lista = catalogo.map((m) => ({
    codigo: m.codigo,
    nombre: m.nombre,
    esPagada: m.esPagada,
    activa: porModalidad.get(m.id)?.activa ?? false,
    habilitable: MODALIDADES_HABILITABLES.includes(m.codigo),
  }));
  if (u.rol === "CLIENTE") lista = lista.filter((m) => m.activa);

  res.json({ modalidades: lista });
});

const putSchema = z.object({
  modalidades: z
    .array(z.object({ codigo: z.string().min(1).max(40), activa: z.boolean() }))
    .min(1)
    .max(20),
});

// Activar o desactivar. Desactivar no toca reservas ya confirmadas.
methodsRouter.put(
  "/restaurants/:id/reservation-methods",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await restauranteAutorizado(req.user!, id, "admin");
    const { modalidades } = putSchema.parse(req.body);

    const codigos = modalidades.map((m) => m.codigo);
    if (new Set(codigos).size !== codigos.length) throw unprocessable("Hay códigos repetidos");

    const catalogo = await prisma.modalidadReserva.findMany({ where: { codigo: { in: codigos } } });
    const porCodigo = new Map(catalogo.map((m) => [m.codigo, m]));

    for (const m of modalidades) {
      if (!porCodigo.has(m.codigo)) throw unprocessable(`Modalidad desconocida: ${m.codigo}`);
      if (m.activa && !MODALIDADES_HABILITABLES.includes(m.codigo)) {
        throw unprocessable(`La modalidad ${m.codigo} aún no está disponible`);
      }
    }

    await prisma.$transaction(
      modalidades.map((m) => {
        const modalidadId = porCodigo.get(m.codigo)!.id;
        return prisma.restauranteModalidad.upsert({
          where: { restauranteId_modalidadId: { restauranteId: id, modalidadId } },
          update: { activa: m.activa },
          create: { restauranteId: id, modalidadId, activa: m.activa },
        });
      }),
    );

    await registrarAuditoria({
      actorId: req.user!.id,
      restauranteId: id,
      accion: "RESERVATION_METHODS_UPDATED",
      entidad: "restaurante_modalidad",
      detalle: modalidades,
    });
    res.json({ modalidades });
  },
);
