/** Приводит телефон к виду +7XXXXXXXXXX (или +<код><номер>). null — если формат неверный */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (/^8\d{10}$/.test(d)) d = "+7" + d.slice(1);
  if (/^7\d{10}$/.test(d)) d = "+" + d;
  if (/^\d{10}$/.test(d)) d = "+7" + d;
  return /^\+\d{10,15}$/.test(d) ? d : null;
}
