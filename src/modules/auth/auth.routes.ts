import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { signToken } from "../../lib/jwt.js";
import { conflict, unauthorized } from "../../lib/errors.js";
import { requireAuth } from "../../middlewares/auth.js";

export const authRouter = Router();

const registerSchema = z.object({
  nombre: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const publico = (u: { id: string; email: string; nombre: string; rol: string }) => ({
  id: u.id,
  email: u.email,
  nombre: u.nombre,
  rol: u.rol,
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id });

    try {
      const user = await prisma.usuario.create({
        data: { nombre: data.nombre, email: data.email, passwordHash, rol: "CLIENTE" },
      });
      res.status(201).json({ token: signToken({ sub: user.id, rol: user.rol }), user: publico(user) });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw conflict("Ya existe una cuenta con ese correo");
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

// Hash falso para que el tiempo de respuesta sea similar si el correo no existe
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE";

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.usuario.findUnique({ where: { email } });

    let ok = false;
    try {
      ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
    } catch {
      ok = false;
    }

    if (!user || !ok || !user.activo) throw unauthorized("Correo o contraseña incorrectos");

    res.json({ token: signToken({ sub: user.id, rol: user.rol }), user: publico(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
