import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/schedule";
import {
  FORMAT_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  formatSlot,
  type BookingFormat,
  type BookingStatus,
} from "@/lib/labels";

type Row = {
  id: string;
  starts_at: string;
  client_name: string;
  format: BookingFormat;
  status: BookingStatus;
  hunter_id: string;
  closer_id: string;
  hunter: { name: string } | null;
  closer: { name: string } | null;
};

export default async function MeetingsPage(props: PageProps<"/meetings">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const tab = sp.tab === "past" ? "past" : "upcoming";
  const seeAll = me.roles.includes("rop") || me.roles.includes("admin");

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  let q = supabase
    .from("bookings")
    .select(
      "id,starts_at,client_name,format,status,hunter_id,closer_id,hunter:users!bookings_hunter_id_fkey(name),closer:users!bookings_closer_id_fkey(name)",
    )
    .limit(300);
  q = tab === "upcoming" ? q.gt("ends_at", nowIso).order("starts_at") : q.lte("ends_at", nowIso).order("starts_at", { ascending: false });
  const [{ data }, settings] = await Promise.all([q, getSettings()]);
  const rows = (data ?? []) as unknown as Row[];
  const tz = settings.timezone;

  // группировка по дням
  const groups: { day: string; items: Row[] }[] = [];
  for (const r of rows) {
    const day = formatSlot(r.starts_at, tz, false);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <AppShell user={me}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold">{seeAll ? "Все встречи" : "Мои встречи"}</h1>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          <Link href="/meetings" className={`rounded-md px-3 py-1 ${tab === "upcoming" ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}>
            Предстоящие
          </Link>
          <Link href="/meetings?tab=past" className={`rounded-md px-3 py-1 ${tab === "past" ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}>
            Прошедшие
          </Link>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card text-sm text-gray-500">
          {tab === "upcoming" ? "Предстоящих встреч нет." : "Прошедших встреч нет."}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="text-xs font-medium text-gray-500 mb-1.5 px-1">{g.day}</div>
              <div className="card p-0 divide-y divide-gray-100">
                {g.items.map((r) => (
                  <Link key={r.id} href={`/bookings/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="w-12 shrink-0 text-sm font-semibold tabular-nums">
                      {formatSlot(r.starts_at, tz).split(", ").pop()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{r.client_name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {FORMAT_LABELS[r.format]} · клоузер {r.closer?.name ?? "—"} · хантер {r.hunter?.name ?? "—"}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
