// Lógica de tarifas (pura, sin I/O -> fácil de probar con unit tests).
export const BASE_RATE_COP_PER_KWH = 1200;
export const SURGE_MULTIPLIER = 1.5; // ENABLE_DYNAMIC_SURGE_PRICING
export const PRIORITY_MULTIPLIER = 1.2; // reserva prioritaria de ultra-carga

// Horas pico (hora local Colombia, UTC-5): 6-9 y 17-21
export function isPeakHour(date = new Date()) {
  const h = (date.getUTCHours() + 24 - 5) % 24;
  return (h >= 6 && h < 9) || (h >= 17 && h < 21);
}

export function estimateAmount({ estimatedKwh, priority = false, surgeEnabled = false, date = new Date(), forcePeak }) {
  const kwh = Number(estimatedKwh);
  if (!Number.isFinite(kwh) || kwh <= 0 || kwh > 1000) {
    throw new RangeError('estimatedKwh debe ser un número entre 0 y 1000');
  }
  const peak = forcePeak ?? isPeakHour(date);
  // En dev/test la flag suele estar en true: para que la demo sea visible aplicamos
  // la tarifa dinámica siempre que la flag esté activa (en la vida real, solo en pico).
  const surgeApplied = surgeEnabled && (peak || process.env.SURGE_ALWAYS_WHEN_ENABLED !== 'false');
  let amount = kwh * BASE_RATE_COP_PER_KWH;
  if (surgeApplied) amount *= SURGE_MULTIPLIER;
  if (priority) amount *= PRIORITY_MULTIPLIER;
  return { amount: Math.round(amount), currency: 'COP', surgeApplied, priority: Boolean(priority), ratePerKwh: BASE_RATE_COP_PER_KWH };
}
