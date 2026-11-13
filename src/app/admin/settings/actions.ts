"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveSettings(_: unknown, fd: FormData) {
  await requireRole("admin");
  const start = Number(fd.get("work_start_hour"));
  const end = Number(fd.get("work_end_hour"));
  const slot = Number(fd.get("slot_minutes"));
  const meeting = Number(fd.get("meeting_minutes"));
  const horizon = Number(fd.get("booking_horizon_days"));
  const address = String(fd.get("office_address") ?? "").trim();

  if (!(start >= 0 && start < 24 && end > start && end <= 24)) return { error: "Неверное рабочее окно" };
  if (![15, 30, 60].includes(slot)) return { error: "Шаг сетки: 15, 30 или 60 минут" };
  if (![30, 60, 90, 120].includes(meeting) || meeting % slot !== 0)
    return { error: "Длительность встречи должна делиться на шаг сетки" };
  if (!(horizon >= 1 && horizon <= 30)) return { error: "Горизонт: от 1 до 30 дней" };
  if (!address) return { error: "Укажите адрес офиса" };

  const supabase = await createClient();
  const rows = [
    { key: "work_start_hour", value: start },
    { key: "work_end_hour", value: end },
    { key: "slot_minutes", value: slot },
    { key: "meeting_minutes", value: meeting },
    { key: "booking_horizon_days", value: horizon },
    { key: "office_address", value: address },
  ];
  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}
