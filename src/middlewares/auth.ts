import type { NextFunction, Request, Response } from "express";
import type { Rol } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export type AuthUser = { id: string; rol: Rol; email: string; nombre: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();

    let payload;
    try {
      payload = verifyToken(header.slice(7));
    } catch {
      throw unauthorized("Token inválido o expirado");
    }

    const user = await prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!user || !user.activo) throw unauthorized("Cuenta inexistente o desactivada");

    req.user = { id: user.id, rol: user.rol, email: user.email, nombre: user.nombre };
    next();
  } catch (e) {
    next(e);
  }
}

export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.rol)) return next(forbidden());
    next();
  };
}

