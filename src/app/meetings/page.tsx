import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/schedule";
import {
  FORMAT_LABELS,
  RESULT_STATUSES,
  STATUSES,
  STATUS_LABELS,
  formatSlot,
  type BookingFormat,
  type BookingStatus,
} from "@/lib/labels";
import { dayStartIso, isDate, shiftDate } from "@/lib/dates";
import { StatusSelect } from "./status-select";
import { RestoreButton } from "@/app/bookings/[id]/card-actions";

type Row = {
  id: string;
  starts_at: string;
  client_name: string;
  format: BookingFormat;
  status: BookingStatus;
  hunter_id: string;
  closer_id: string;
  student_grade: string | null;
  qual: string | null;
  qual_after: string | null;
  note_after: string | null;
  hunter: { name: string } | null;
  closer: { name: string } | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export default async function MeetingsPage(props: PageProps<"/meetings">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const isRop = me.roles.includes("rop") || me.roles.includes("admin");
  const tab = sp.tab === "past" ? "past" : sp.tab === "trash" && isRop ? "trash" : "upcoming";

  const f = {
    from: isDate(sp.from) ? sp.from : "",
    to: isDate(sp.to) ? sp.to : "",
    hunter: str(sp.hunter),
    closer: str(sp.closer),
    status: STATUSES.includes(str(sp.status) as BookingStatus) ? str(sp.status) : str(sp.status) === "pending" ? "pending" : "",
    format: str(sp.format) === "online" || str(sp.format) === "offline" ? str(sp.format) : "",
  };

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  let q = supabase
    .from("bookings")
    .select(
      "id,starts_at,client_name,format,status,hunter_id,closer_id,student_grade,qual,qual_after,note_after,hunter:users!bookings_hunter_id_fkey(name),closer:users!bookings_closer_id_fkey(name)",
    )
    .limit(500);
  if (tab === "trash") q = q.not("deleted_at", "is", null).order("starts_at", { ascending: false });
  else if (tab === "upcoming") q = q.is("deleted_at", null).gt("ends_at", nowIso).order("starts_at");
  else q = q.is("deleted_at", null).lte("starts_at", nowIso).order("starts_at", { ascending: false });
  if (f.from) q = q.gte("starts_at", dayStartIso(f.from));
  if (f.to) q = q.lt("starts_at", dayStartIso(shiftDate(f.to, 1)));
  if (f.hunter) q = q.eq("hunter_id", f.hunter);
  if (f.closer) q = q.eq("closer_id", f.closer);
  if (f.format) q = q.eq("format", f.format);
  if (f.status === "pending") q = q.in("status", ["scheduled", "confirmed"]);
  else if (f.status) q = q.eq("status", f.status);

  const [{ data }, settings, { data: people }] = await Promise.all([
    q,
    getSettings(),
    supabase.from("users").select("id,name,roles").order("name"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const tz = settings.timezone;
  const hunters = (people ?? []).filter((u) => (u.roles as string[]).includes("hunter"));
  const closers = (people ?? []).filter((u) => (u.roles as string[]).includes("closer"));

  const groups: { day: string; items: Row[] }[] = [];
  for (const r of rows) {
    const day = formatSlot(r.starts_at, tz, false);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(r);
    else groups.push({ day, items: [r] });
  }

  const pendingCount =
    tab === "past" ? rows.filter((r) => r.status === "scheduled" || r.status === "confirmed").length : 0;

  function optionsFor(r: Row): BookingStatus[] {
    if (r.status === "rescheduled") return [];
    const started = new Date(r.starts_at) <= new Date();
    if (isRop) return STATUSES.filter((s) => s !== "rescheduled");
    if (r.closer_id === me.id && started) return [r.status, ...RESULT_STATUSES];
    if (r.hunter_id === me.id && !started && (r.status === "scheduled" || r.status === "confirmed"))
      return ["scheduled", "confirmed"];
    return [];
  }

  const tabHref = (t: string) => {
    const p = new URLSearchParams(Object.entries({ ...f, tab: t }).filter(([, v]) => v) as [string, string][]);
    if (t === "upcoming") p.delete("tab");
    return `/meetings${p.toString() ? "?" + p : ""}`;
  };

  return (
    <AppShell user={me}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold">{isRop ? "Все встречи" : "Мои встречи"}</h1>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          <Link href={tabHref("upcoming")} className={`rounded-md px-3 py-1 ${tab === "upcoming" ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}>
            Предстоящие
          </Link>
          <Link href={tabHref("past")} className={`rounded-md px-3 py-1 ${tab === "past" ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}>
            Прошедшие
          </Link>
          {isRop && (
            <Link href="/meetings?tab=trash" className={`rounded-md px-3 py-1 ${tab === "trash" ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}>
              Корзина
            </Link>
          )}
        </div>
      </div>

      <form className="card p-3 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2 text-sm" method="get">
        {tab !== "upcoming" && <input type="hidden" name="tab" value={tab} />}
        <label className="block">
          <span className="text-xs text-gray-500">С</span>
          <input type="date" name="from" defaultValue={f.from} className="input mt-0.5" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">По</span>
          <input type="date" name="to" defaultValue={f.to} className="input mt-0.5" />
        </label>
        {isRop && (
          <label className="block">
            <span className="text-xs text-gray-500">Хантер</span>
            <select name="hunter" defaultValue={f.hunter} className="input mt-0.5">
              <option value="">Все</option>
              {hunters.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isRop && (
          <label className="block">
            <span className="text-xs text-gray-500">Клоузер</span>
            <select name="closer" defaultValue={f.closer} className="input mt-0.5">
              <option value="">Все</option>
              {closers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs text-gray-500">Статус</span>
          <select name="status" defaultValue={f.status} className="input mt-0.5">
            <option value="">Все</option>
            {tab === "past" && <option value="pending">Ждут итога</option>}
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Формат</span>
          <select name="format" defaultValue={f.format} className="input mt-0.5">
            <option value="">Все</option>
            <option value="online">Онлайн</option>
            <option value="offline">Оффлайн</option>
          </select>
        </label>
        <div className="col-span-2 md:col-span-6 flex gap-2">
          <button className="btn-primary px-4 py-1.5">Применить</button>
          <Link href={tab === "upcoming" ? "/meetings" : `/meetings?tab=${tab}`} className="btn-secondary px-4 py-1.5">
            Сбросить
          </Link>
          <span className="ml-auto self-center text-xs text-gray-500">Найдено: {rows.length}</span>
        </div>
      </form>

      {tab === "past" && pendingCount > 0 && f.status !== "pending" && (
        <Link
          href={`/meetings?tab=past&status=pending`}
          className="block mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900"
        >
          {pendingCount} прошедших встреч ждут итога (проведена / не проведена / перенос / эксперт не засчитал) →
        </Link>
      )}

      {groups.length === 0 ? (
        <div className="card text-sm text-gray-500">{tab === "trash" ? "Корзина пуста." : "Встреч не найдено."}</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="text-xs font-medium text-gray-500 mb-1.5 px-1">{g.day}</div>
              <div className="card p-0 divide-y divide-gray-100">
                {g.items.map((r) => {
                  const pending = tab === "past" && (r.status === "scheduled" || r.status === "confirmed");
                  return (
                    <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${pending ? "bg-amber-50/50" : ""}`}>
                      <Link href={`/bookings/${r.id}`} className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80">
                        <div className="w-12 shrink-0 text-sm font-semibold tabular-nums">
                          {formatSlot(r.starts_at, tz).split(", ").pop()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">
                            {r.client_name}
                            {r.student_grade && (
                              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-700">
                                {r.student_grade}
                              </span>
                            )}
                            {r.qual && (
                              <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">
                                {r.qual}
                                {r.qual_after && r.qual_after !== r.qual ? `→${r.qual_after}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {FORMAT_LABELS[r.format]} · клоузер {r.closer?.name ?? "—"} · хантер {r.hunter?.name ?? "—"}
                          </div>
                        </div>
                      </Link>
                      {tab === "trash" ? (
                        <RestoreButton id={r.id} small />
                      ) : (
                        <StatusSelect id={r.id} status={r.status} options={optionsFor(r)} qualAfter={r.qual_after} noteAfter={r.note_after} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
