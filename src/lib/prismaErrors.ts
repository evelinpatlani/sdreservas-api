import { Prisma } from "@prisma/client";

export const esViolacionUnica = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
