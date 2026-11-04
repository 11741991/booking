import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { SettingsForm } from "./settings-form";

export default async function AdminSettingsPage() {
  const me = await requireRole("admin");
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key,value");
  const s = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;

  return (
    <AppShell user={me}>
      <h1 className="text-lg font-semibold mb-4">Настройки</h1>
      <SettingsForm
        values={{
          work_start_hour: Number(s.work_start_hour ?? 12),
          work_end_hour: Number(s.work_end_hour ?? 21),
          slot_minutes: Number(s.slot_minutes ?? 60),
          booking_horizon_days: Number(s.booking_horizon_days ?? 7),
          office_address: String(s.office_address ?? ""),
          timezone: String(s.timezone ?? "Asia/Almaty"),
        }}
      />
    </AppShell>
  );
}
