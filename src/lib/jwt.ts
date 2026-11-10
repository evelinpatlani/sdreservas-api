import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type TokenPayload = { sub: string; rol: string };

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || !decoded.sub) throw new Error("Token inválido");
  return { sub: String(decoded.sub), rol: String((decoded as any).rol) };
}
