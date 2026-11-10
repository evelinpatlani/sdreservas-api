import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const modalidades = [
  { codigo: "AUTO_FREE", nombre: "Asignación automática de mesa", esPagada: false },
  { codigo: "ZONE_FREE", nombre: "Elección de zona", esPagada: false },
  { codigo: "TABLE_FREE", nombre: "Elección gratuita de mesa", esPagada: false },
  { codigo: "AUTO_FIXED", nombre: "Asignación automática con tarifa fija", esPagada: true },
  { codigo: "TABLE_FIXED", nombre: "Selección de mesa con tarifa fija", esPagada: true },
  { codigo: "PER_PERSON", nombre: "Tarifa por persona", esPagada: true },
  { codigo: "ZONE_TABLE_RATE", nombre: "Tarifa por zona o mesa", esPagada: true },
  {
    codigo: "DEPOSIT",
    nombre: "Selección de mesa con depósito anticipado",
    esPagada: true,
    descripcion: "Se descuenta del consumo",
  },
  {
    codigo: "REFUNDABLE_GUARANTEE",
    nombre: "Reservación con garantía reembolsable",
    esPagada: true,
    descripcion: "Devolución según condiciones",
  },
  {
    codigo: "MEMBER_ONLY",
    nombre: "Selección exclusiva para miembros",
    esPagada: false,
    descripcion: "Condicionada a membresía (pendiente de definir)",
  },
];

async function main() {
  for (const m of modalidades) {
    await prisma.modalidadReserva.upsert({
      where: { codigo: m.codigo },
      update: { nombre: m.nombre, esPagada: m.esPagada, descripcion: m.descripcion ?? null },
      create: m,
    });
  }
  console.log(`Catálogo sembrado: ${modalidades.length} modalidades`);
}

main().finally(() => prisma.$disconnect());
