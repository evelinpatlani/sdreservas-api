-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('CLIENTE', 'ADMIN', 'RECEPCIONISTA', 'MESERO');

-- CreateEnum
CREATE TYPE "EstadoMesa" AS ENUM ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "EstadoReserva" AS ENUM ('PENDING_PAYMENT', 'UPCOMING', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "OrigenReserva" AS ENUM ('ONLINE', 'PRESENCIAL');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TipoMovimientoReputacion" AS ENUM ('NO_SHOW', 'RECOVERY', 'AJUSTE');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "reputacion" DECIMAL(3,2) NOT NULL DEFAULT 5.00,
    "rachaPagadas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurante" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoCocina" TEXT NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "limiteMesas" INTEGER NOT NULL,
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restaurante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurante_empleado" (
    "id" UUID NOT NULL,
    "restauranteId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurante_empleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piso" (
    "id" UUID NOT NULL,
    "restauranteId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "piso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area" (
    "id" UUID NOT NULL,
    "pisoId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesa" (
    "id" UUID NOT NULL,
    "restauranteId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL,
    "forma" TEXT NOT NULL DEFAULT 'cuadrada',
    "estado" "EstadoMesa" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horario_restaurante" (
    "id" UUID NOT NULL,
    "restauranteId" UUID NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "aperturaMin" INTEGER NOT NULL,
    "cierreMin" INTEGER NOT NULL,

    CONSTRAINT "horario_restaurante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modalidad_reserva" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "esPagada" BOOLEAN NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "modalidad_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurante_modalidad" (
    "id" UUID NOT NULL,
    "restauranteId" UUID NOT NULL,
    "modalidadId" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "importe" DECIMAL(10,2),

    CONSTRAINT "restaurante_modalidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva" (
    "id" UUID NOT NULL,
    "restauranteId" UUID NOT NULL,
    "clienteId" UUID,
    "nombreInvitado" TEXT,
    "personas" INTEGER NOT NULL,
    "origen" "OrigenReserva" NOT NULL,
    "modalidadId" UUID,
    "inicio" TIMESTAMPTZ(3) NOT NULL,
    "fin" TIMESTAMPTZ(3) NOT NULL,
    "duracionMin" INTEGER NOT NULL,
    "estado" "EstadoReserva" NOT NULL,
    "importeAplicado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "condiciones" JSONB,
    "pagoExpiraEn" TIMESTAMPTZ(3),
    "creadaPorId" UUID NOT NULL,
    "canceladaPorId" UUID,
    "canceladaEn" TIMESTAMPTZ(3),
    "motivoCancelacion" TEXT,
    "politicaAplicada" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva_mesa" (
    "id" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "mesaId" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(3) NOT NULL,
    "fin" TIMESTAMPTZ(3) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reserva_mesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago_reserva" (
    "id" UUID NOT NULL,
    "reservaId" UUID NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'MXN',
    "estado" "EstadoPago" NOT NULL,
    "metodoSimulado" TEXT NOT NULL,
    "referenciaOperacion" TEXT NOT NULL,
    "claveIdempotencia" TEXT,
    "montoReembolsado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pago_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_reputacion" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "reservaId" UUID,
    "tipo" "TipoMovimientoReputacion" NOT NULL,
    "delta" DECIMAL(3,2) NOT NULL,
    "reputacionAntes" DECIMAL(3,2) NOT NULL,
    "reputacionDespues" DECIMAL(3,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_reputacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_operacion" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "restauranteId" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT,
    "detalle" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_operacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "restaurante_adminId_idx" ON "restaurante"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurante_empleado_restauranteId_usuarioId_key" ON "restaurante_empleado"("restauranteId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "piso_restauranteId_nombre_key" ON "piso"("restauranteId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "area_pisoId_nombre_key" ON "area"("pisoId", "nombre");

-- CreateIndex
CREATE INDEX "mesa_restauranteId_idx" ON "mesa"("restauranteId");

-- CreateIndex
CREATE UNIQUE INDEX "mesa_restauranteId_etiqueta_key" ON "mesa"("restauranteId", "etiqueta");

-- CreateIndex
CREATE UNIQUE INDEX "horario_restaurante_restauranteId_diaSemana_key" ON "horario_restaurante"("restauranteId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "modalidad_reserva_codigo_key" ON "modalidad_reserva"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "restaurante_modalidad_restauranteId_modalidadId_key" ON "restaurante_modalidad"("restauranteId", "modalidadId");

-- CreateIndex
CREATE INDEX "reserva_restauranteId_inicio_idx" ON "reserva"("restauranteId", "inicio");

-- CreateIndex
CREATE INDEX "reserva_clienteId_estado_idx" ON "reserva"("clienteId", "estado");

-- CreateIndex
CREATE INDEX "reserva_mesa_mesaId_idx" ON "reserva_mesa"("mesaId");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_mesa_reservaId_mesaId_key" ON "reserva_mesa"("reservaId", "mesaId");

-- CreateIndex
CREATE UNIQUE INDEX "pago_reserva_referenciaOperacion_key" ON "pago_reserva"("referenciaOperacion");

-- CreateIndex
CREATE UNIQUE INDEX "pago_reserva_claveIdempotencia_key" ON "pago_reserva"("claveIdempotencia");

-- CreateIndex
CREATE INDEX "pago_reserva_reservaId_idx" ON "pago_reserva"("reservaId");

-- CreateIndex
CREATE INDEX "movimiento_reputacion_usuarioId_createdAt_idx" ON "movimiento_reputacion"("usuarioId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_reputacion_reservaId_tipo_key" ON "movimiento_reputacion"("reservaId", "tipo");

-- CreateIndex
CREATE INDEX "auditoria_operacion_restauranteId_createdAt_idx" ON "auditoria_operacion"("restauranteId", "createdAt");

-- AddForeignKey
ALTER TABLE "restaurante" ADD CONSTRAINT "restaurante_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurante_empleado" ADD CONSTRAINT "restaurante_empleado_restauranteId_fkey" FOREIGN KEY ("restauranteId") REFERENCES "restaurante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurante_empleado" ADD CONSTRAINT "restaurante_empleado_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piso" ADD CONSTRAINT "piso_restauranteId_fkey" FOREIGN KEY ("restauranteId") REFERENCES "restaurante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "area" ADD CONSTRAINT "area_pisoId_fkey" FOREIGN KEY ("pisoId") REFERENCES "piso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesa" ADD CONSTRAINT "mesa_restauranteId_fkey" FOREIGN KEY ("restauranteId") REFERENCES "restaurante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesa" ADD CONSTRAINT "mesa_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horario_restaurante" ADD CONSTRAINT "horario_restaurante_restauranteId_fkey" FOREIGN KEY ("restauranteId") REFERENCES "restaurante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurante_modalidad" ADD CONSTRAINT "restaurante_modalidad_restauranteId_fkey" FOREIGN KEY ("restauranteId") REFERENCES "restaurante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurante_modalidad" ADD CONSTRAINT "restaurante_modalidad_modalidadId_fkey" FOREIGN KEY ("modalidadId") REFERENCES "modalidad_reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_restauranteId_fkey" FOREIGN KEY ("restauranteId") REFERENCES "restaurante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_canceladaPorId_fkey" FOREIGN KEY ("canceladaPorId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_modalidadId_fkey" FOREIGN KEY ("modalidadId") REFERENCES "modalidad_reserva"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_mesa" ADD CONSTRAINT "reserva_mesa_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reserva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_mesa" ADD CONSTRAINT "reserva_mesa_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "mesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_reserva" ADD CONSTRAINT "pago_reserva_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_reputacion" ADD CONSTRAINT "movimiento_reputacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_reputacion" ADD CONSTRAINT "movimiento_reputacion_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reserva"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_operacion" ADD CONSTRAINT "auditoria_operacion_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_operacion" ADD CONSTRAINT "auditoria_operacion_restauranteId_fkey" FOREIGN KEY ("restauranteId") REFERENCES "restaurante"("id") ON DELETE SET NULL ON UPDATE CASCADE;


CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "usuario"
  ADD CONSTRAINT "usuario_reputacion_rango" CHECK ("reputacion" BETWEEN 0 AND 5);

ALTER TABLE "restaurante"
  ADD CONSTRAINT "restaurante_limite_mesas_positivo" CHECK ("limiteMesas" > 0);

ALTER TABLE "mesa"
  ADD CONSTRAINT "mesa_capacidad_positiva" CHECK ("capacidad" > 0);

ALTER TABLE "horario_restaurante"
  ADD CONSTRAINT "horario_dia_valido" CHECK ("diaSemana" BETWEEN 0 AND 6),
  ADD CONSTRAINT "horario_rango_valido"
    CHECK ("aperturaMin" >= 0 AND "cierreMin" <= 1440 AND "cierreMin" > "aperturaMin");

ALTER TABLE "reserva"
  ADD CONSTRAINT "reserva_duracion_catalogo" CHECK ("duracionMin" IN (30, 60, 90, 120, 180)),
  ADD CONSTRAINT "reserva_fin_despues_inicio" CHECK ("fin" > "inicio"),
  ADD CONSTRAINT "reserva_personas_positivas" CHECK ("personas" > 0),
  ADD CONSTRAINT "reserva_titular" CHECK ("clienteId" IS NOT NULL OR "nombreInvitado" IS NOT NULL);

ALTER TABLE "reserva_mesa"
  ADD CONSTRAINT "reserva_mesa_fin_despues_inicio" CHECK ("fin" > "inicio");

ALTER TABLE "pago_reserva"
  ADD CONSTRAINT "pago_monto_no_negativo" CHECK ("monto" >= 0 AND "montoReembolsado" >= 0);

ALTER TABLE "reserva_mesa"
  ADD CONSTRAINT "reserva_mesa_sin_solape"
  EXCLUDE USING gist (
    "mesaId" WITH =,
    tstzrange("inicio", "fin", '[)') WITH &&
  ) WHERE ("activa");

CREATE OR REPLACE FUNCTION sync_reserva_mesa() RETURNS trigger AS $$
BEGIN
  UPDATE "reserva_mesa"
  SET "activa" = NEW."estado" IN ('PENDING_PAYMENT', 'UPCOMING', 'CHECKED_IN'),
      "inicio" = NEW."inicio",
      "fin"    = NEW."fin"
  WHERE "reservaId" = NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_reserva_mesa
AFTER UPDATE OF "estado", "inicio", "fin" ON "reserva"
FOR EACH ROW EXECUTE FUNCTION sync_reserva_mesa();
