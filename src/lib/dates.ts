// Казахстан живёт по единому GMT+5 без перехода на летнее время
export const TZ_OFFSET = "+05:00";

/** Начало локального дня (YYYY-MM-DD) в ISO */
export function dayStartIso(date: string) {
  return new Date(`${date}T00:00:00${TZ_OFFSET}`).toISOString();
}

export function todayLocal() {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Понедельник недели, в которую входит дата */
export function weekStart(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return shiftDate(date, -wd);
}

export function localDate(iso: string) {
  return new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
