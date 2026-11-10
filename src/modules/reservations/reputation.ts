export type NivelReputacion = "ALTA" | "MEDIA" | "BAJA";

export const LIMITES: Record<
  NivelReputacion,
  { plataforma: number; restaurante: number; gratuitas: boolean }
> = {
  ALTA: { plataforma: 6, restaurante: 2, gratuitas: true },
  MEDIA: { plataforma: 4, restaurante: 2, gratuitas: false },
  BAJA: { plataforma: 2, restaurante: 1, gratuitas: false },
};

// Alta: >3.50 a 5.00 · Media: 1.50 a 3.50 · Baja: <1.50
export function nivelReputacion(valor: number): NivelReputacion {
  if (valor > 3.5) return "ALTA";
  if (valor >= 1.5) return "MEDIA";
  return "BAJA";
}

// Todo en centésimas (enteros) para evitar errores de redondeo con decimales
export const REPUTACION_MAX = 500;
export const PENALIZACION_NO_SHOW = 30; // -0.30
export const RACHA_PAGADAS_BAJA = 5; // reservas pagadas seguidas en reputación baja

export const centavos = (v: unknown) => Math.round(Number(v) * 100);
export const aDecimal = (c: number) => (c / 100).toFixed(2);

// P(n) = min(0.20, 0.10 + 0.02 (n - 1)), en centésimas
export const puntosRecuperacion = (n: number) => Math.min(20, 10 + 2 * (n - 1));
