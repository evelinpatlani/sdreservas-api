// Diferencia (ms) entre la hora local de la zona y UTC en un instante dado
function offsetMs(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(utcMs / 1000) * 1000;
}

// Convierte "fecha local + minutos desde medianoche" en un instante UTC
export function localToUtc(fecha: string, minutos: number, tz: string): Date {
  const [y, m, d] = fecha.split("-").map(Number);
  const ingenuo = Date.UTC(y, m - 1, d, 0, minutos);
  let utc = ingenuo - offsetMs(ingenuo, tz);
  utc = ingenuo - offsetMs(utc, tz);
  return new Date(utc);
}

export function fechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 0 = domingo ... 6 = sábado (el día del calendario local)
export function diaSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function horaAMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}
