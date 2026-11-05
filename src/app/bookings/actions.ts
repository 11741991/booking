"use server";
import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { fetchAmoLead, parseAmoLink, type AmoData } from "@/lib/amo";

const ERRORS: Record<string, string> = {
  NO_FREE_CLOSER: "На это время свободных клоузеров уже нет. Выберите другое время.",
  SLOT_PAST: "Это время уже прошло.",
  SLOT_INVALID: "Такого слота нет в сетке. Обновите страницу.",
  NO_RIGHTS: "Нет прав на это действие.",
  TOO_LATE: "Встреча уже началась или закрыта — изменить нельзя.",
  NEED_LINK: "Для онлайн-встречи нужна ссылка на встречу.",
  NEED_CRM: "Нужна ссылка на сделку в CRM.",
};

function human(msg: string) {
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  return code ? ERRORS[code] : msg;
}

export type LookupResult =
  | { ok: true; data: AmoData }
  | { ok: false; message: string | null };

/** Подтянуть данные сделки из amoCRM по ссылке */
export async function lookupAmoAction(url: string): Promise<LookupResult> {
  await requireUser();
  if (!url.trim()) return { ok: false, message: null };
  const r = await fetchAmoLead(url);
  if (r.ok) return { ok: true, data: r.data };
  if (r.reason === "not_configured") return { ok: false, message: null };
  if (r.reason === "bad_link")
    return parseAmoLink(url) ? { ok: false, message: "Ссылка из другого amoCRM-аккаунта" } : { ok: false, message: null };
  if (r.reason === "not_found") return { ok: false, message: "Сделка в amoCRM не найдена" };
  return { ok: false, message: "amoCRM не ответил — данные можно ввести вручную" };
}

export type CreateResult =
  | { ok: true; id: string; closerName: string; startsAt: string }
  | { ok: false; error: string; refresh?: boolean };

export async function createBookingAction(input: {
  start: string;
  format: "online" | "offline";
  meetingUrl: string;
  clientName: string;
  clientPhone: string;
  crmUrl: string;
  comment: string;
}): Promise<CreateResult> {
  await requireRole("hunter", "rop", "admin");

  const clientName = input.clientName.trim();
  const phone = normalizePhone(input.clientPhone);
  const crmUrl = input.crmUrl.trim();
  if (!clientName) return { ok: false, error: "Укажите имя клиента" };
  if (!phone) return { ok: false, error: "Телефон в формате +7 7XX XXX XX XX" };
  if (!/^https?:\/\/\S+$/i.test(crmUrl)) return { ok: false, error: "Ссылка на сделку должна начинаться с https://" };
  if (input.format !== "online" && input.format !== "offline") return { ok: false, error: "Выберите формат" };
  if (input.format === "online" && !/^https?:\/\/\S+$/i.test(input.meetingUrl.trim()))
    return { ok: false, error: "Вставьте ссылку на онлайн-встречу (https://…)" };

  // amoCRM: снимок сделки (если интеграция подключена)
  const amo = await fetchAmoLead(crmUrl);
  const amoLeadId = amo.leadId;
  const amoData = amo.ok ? amo.data : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_booking", {
    p_start: input.start,
    p_format: input.format,
    p_meeting_url: input.meetingUrl,
    p_client_name: clientName,
    p_client_phone: phone,
    p_crm_url: crmUrl,
    p_comment: input.comment,
    p_amo_lead_id: amoLeadId,
    p_amo_data: amoData,
  });
  if (error) {
    revalidatePath("/slots");
    return { ok: false, error: human(error.message), refresh: /NO_FREE_CLOSER|SLOT_PAST/.test(error.message) };
  }
  const booking = (Array.isArray(data) ? data[0] : data) as { id: string; closer_id: string; starts_at: string };
  const { data: closer } = await supabase.from("users").select("name").eq("id", booking.closer_id).single();

  revalidatePath("/slots");
  revalidatePath("/schedule");
  revalidatePath("/meetings");
  return { ok: true, id: booking.id, closerName: closer?.name ?? "", startsAt: booking.starts_at };
}

export async function updateMyBookingAction(input: {
  id: string;
  meetingUrl: string;
  crmUrl: string;
  comment: string;
}): Promise<{ ok?: true; error?: string }> {
  await requireRole("hunter", "rop", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_booking", {
    p_id: input.id,
    p_meeting_url: input.meetingUrl,
    p_crm_url: input.crmUrl,
    p_comment: input.comment,
  });
  if (error) return { error: human(error.message) };

  const amo = await fetchAmoLead(input.crmUrl);
  if (amo.ok) await supabase.rpc("set_booking_amo", { p_id: input.id, p_lead_id: amo.leadId, p_data: amo.data });

  revalidatePath(`/bookings/${input.id}`);
  revalidatePath("/meetings");
  return { ok: true };
}

export async function refreshAmoAction(id: string, crmUrl: string): Promise<{ ok?: true; error?: string }> {
  await requireUser();
  const amo = await fetchAmoLead(crmUrl);
  if (!amo.ok) {
    return {
      error:
        amo.reason === "not_configured"
          ? "Интеграция с amoCRM ещё не подключена"
          : amo.reason === "not_found"
            ? "Сделка в amoCRM не найдена"
            : amo.reason === "bad_link"
              ? "Это не ссылка на сделку amoCRM"
              : "amoCRM не ответил, попробуйте позже",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_booking_amo", { p_id: id, p_lead_id: amo.leadId, p_data: amo.data });
  if (error) return { error: error.message };
  revalidatePath(`/bookings/${id}`);
  return { ok: true };
}
