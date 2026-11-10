import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { restauranteAutorizado } from "../../lib/access.js";
import { registrarAuditoria } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { esViolacionUnica } from "../../lib/prismaErrors.js";

export const employeesRouter = Router();

const rolEmpleado = z.enum(["RECEPCIONISTA", "MESERO"]);

const crearSchema = z.object({
  nombre: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  rol: rolEmpleado,
});

const editarSchema = z
  .object({ activo: z.boolean(), rol: rolEmpleado })
  .partial()
  .refine((d) => Object.keys(d).length > 0, "Envía al menos un campo");

const publico = (u: { id: string; email: string; nombre: string; rol: string; activo: boolean }) => ({
  id: u.id,
  email: u.email,
  nombre: u.nombre,
  rol: u.rol,
  activo: u.activo,
});

employeesRouter.post(
  "/restaurants/:id/employees",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const r = await restauranteAutorizado(req.user!, id, "admin");
    const data = crearSchema.parse(req.body);
    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id });

    try {
      const u = await prisma.usuario.create({
        data: {
          nombre: data.nombre,
          email: data.email,
          passwordHash,
          rol: data.rol,
          asignaciones: { create: { restauranteId: r.id } },
        },
      });
      await registrarAuditoria({
        actorId: req.user!.id,
        restauranteId: r.id,
        accion: "EMPLOYEE_CREATED",
        entidad: "usuario",
        entidadId: u.id,
        detalle: { rol: data.rol },
      });
      res.status(201).json({ empleado: publico(u) });
    } catch (e) {
      if (esViolacionUnica(e)) throw conflict("Ya existe una cuenta con ese correo");
      throw e;
    }
  },
);

employeesRouter.get(
  "/restaurants/:id/employees",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await restauranteAutorizado(req.user!, id, "admin");
    const filas = await prisma.restauranteEmpleado.findMany({
      where: { restauranteId: id },
      include: { usuario: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ empleados: filas.map((f) => publico(f.usuario)) });
  },
);

employeesRouter.patch("/employees/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const data = editarSchema.parse(req.body);

  // Solo empleados asignados a restaurantes de este administrador
  const asignacion = await prisma.restauranteEmpleado.findFirst({
    where: { usuarioId: id, restaurante: { adminId: req.user!.id } },
  });
  if (!asignacion) throw notFound("Empleado no encontrado");

  const u = await prisma.usuario.update({ where: { id }, data });
  await registrarAuditoria({
    actorId: req.user!.id,
    restauranteId: asignacion.restauranteId,
    accion: "EMPLOYEE_UPDATED",
    entidad: "usuario",
    entidadId: id,
    detalle: data,
  });
  res.json({ empleado: publico(u) });
});
