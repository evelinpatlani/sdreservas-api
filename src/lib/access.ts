import { prisma } from "./prisma.js";
import type { AuthUser } from "../middlewares/auth.js";
import { forbidden, notFound } from "./errors.js";

// modo "admin": solo el administrador dueño.
// modo "personal": el dueño o un empleado asignado a ese restaurante.
export async function restauranteAutorizado(
  user: AuthUser,
  restauranteId: string,
  modo: "admin" | "personal",
) {
  const r = await prisma.restaurante.findUnique({ where: { id: restauranteId } });
  if (!r) throw notFound("Restaurante no encontrado");

  if (user.rol === "ADMIN" && r.adminId === user.id) return r;

  if (modo === "personal" && (user.rol === "RECEPCIONISTA" || user.rol === "MESERO")) {
    const asignado = await prisma.restauranteEmpleado.findUnique({
      where: { restauranteId_usuarioId: { restauranteId, usuarioId: user.id } },
    });
    if (asignado) return r;
  }
  throw forbidden();
}
