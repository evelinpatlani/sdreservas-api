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
