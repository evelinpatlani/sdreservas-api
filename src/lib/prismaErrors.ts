import { Prisma } from "@prisma/client";

export const esViolacionUnica = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// Violación de la restricción anti-solapamiento (código 23P01 de PostgreSQL)
export const esSolape = (e: unknown) => {
  const x = e as { message?: string; meta?: unknown };
  const texto = `${x?.message ?? ""} ${JSON.stringify(x?.meta ?? {})}`;
  return texto.includes("reserva_mesa_sin_solape") || texto.includes("23P01");
};
