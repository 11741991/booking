export type BlockReason =
  | "lunch"
  | "sick"
  | "vacation"
  | "day_off"
  | "followup"
  | "own_meeting"
  | "training"
  | "other";

export const REASON_LABELS: Record<BlockReason, string> = {
  lunch: "Обед",
  sick: "Больничный",
  vacation: "Отпуск",
  day_off: "Выходной",
  followup: "Дожим клиентов",
  own_meeting: "Своя встреча",
  training: "Тренировка ОП",
  other: "Другое",
};

export const REASON_SHORT: Record<BlockReason, string> = {
  lunch: "Обед",
  sick: "Бол.",
  vacation: "Отп.",
  day_off: "Вых.",
  followup: "Дожим",
  own_meeting: "Встр.",
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

export type BookingStatus =
  | "scheduled"
  | "confirmed"
  | "done"
  | "no_show"
  | "rescheduled"
  | "not_counted"
  | "cancelled";

export const STATUSES: BookingStatus[] = [
  "scheduled",
  "confirmed",
  "done",
  "no_show",
  "rescheduled",
  "not_counted",
  "cancelled",
];

export const STATUS_LABELS: Record<BookingStatus, string> = {
  scheduled: "Назначена",
  confirmed: "Подтверждена",
  done: "Проведена",
  no_show: "Не проведена",
  rescheduled: "Перенос",
  not_counted: "Эксперт не засчитал",
  cancelled: "Отменена",
};
export const STATUS_STYLES: Record<BookingStatus, string> = {
  scheduled: "bg-sky-50 text-sky-800 border-sky-200",
  confirmed: "bg-indigo-50 text-indigo-800 border-indigo-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  no_show: "bg-rose-50 text-rose-800 border-rose-200",
  rescheduled: "bg-amber-50 text-amber-800 border-amber-200",
  not_counted: "bg-orange-50 text-orange-800 border-orange-200",
  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
};
/** Статусы, которые ставят по итогам прошедшей встречи */
export const RESULT_STATUSES: BookingStatus[] = ["done", "no_show", "not_counted"];

export const GRADES = [
  "9 класс",
  "10 класс",
  "11 класс",
  "12 класс",
  "1 курс колледжа",
  "2 курс колледжа",
  "3 курс колледжа",
  "4 курс колледжа",
  "1 курс университета",
  "2 курс университета",
  "3 курс университета",
  "4 курс университета",
  "Окончил школу",
  "Окончил колледж",
  "Окончил ВУЗ",
];
/** Список классов + текущее значение, если оно из старого списка (чтобы не терялось при правке) */
export const gradeOptions = (current?: string | null) =>
  current && !GRADES.includes(current) ? [current, ...GRADES] : GRADES;
export const QUALS = ["A", "B", "C"] as const;
export type Qual = (typeof QUALS)[number];

export type BookingFormat = "online" | "offline";
export const FORMAT_LABELS: Record<BookingFormat, string> = { online: "Онлайн", offline: "Оффлайн" };

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** «Пт, 6 ноя, 14:00» в заданном часовом поясе */
export function formatSlot(iso: string, tz = "Asia/Almaty", withTime = true) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const wd = WD[new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay()];
  const base = `${wd}, ${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`;
  return withTime ? `${base}, ${p.hour}:${p.minute}` : base;
}

export function formatPhone(p: string) {
  const m = p.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}
