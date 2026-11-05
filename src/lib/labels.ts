export type BlockReason =
  | "lunch"
  | "sick"
  | "vacation"
  | "day_off"
  | "followup"
  | "training"
  | "other";

export const REASON_LABELS: Record<BlockReason, string> = {
  lunch: "Обед",
  sick: "Больничный",
  vacation: "Отпуск",
  day_off: "Выходной",
  followup: "Дожим клиентов",
  training: "Тренировка ОП",
  other: "Другое",
};

export const REASON_SHORT: Record<BlockReason, string> = {
  lunch: "Обед",
  sick: "Бол.",
  vacation: "Отп.",
  day_off: "Вых.",
  followup: "Дожим",
  training: "Трен.",
  other: "Др.",
};

export const REASONS = Object.keys(REASON_LABELS) as BlockReason[];

export const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]; // ISO 1..7

export function minutesLabel(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
