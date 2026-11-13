import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/schedule";
import { STATUS_STYLES, formatSlot, type BookingFormat, type BookingStatus } from "@/lib/labels";
import { dayStartIso, isDate, localDate, shiftDate, todayLocal, weekStart } from "@/lib/dates";

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
  hunter: { name: string } | null;
  closer: { name: string } | null;
};

// Колонки статистики
const COLS: { key: string; label: string; match: (r: Row, now: Date) => boolean; style?: string }[] = [
  { key: "done", label: "Проведена", match: (r) => r.status === "done", style: STATUS_STYLES.done },
  { key: "no_show", label: "Не проведена", match: (r) => r.status === "no_show", style: STATUS_STYLES.no_show },
  { key: "rescheduled", label: "Перенос", match: (r) => r.status === "rescheduled", style: STATUS_STYLES.rescheduled },
  { key: "not_counted", label: "Эксп. не засчитал", match: (r) => r.status === "not_counted", style: STATUS_STYLES.not_counted },
  { key: "cancelled", label: "Отменена", match: (r) => r.status === "cancelled", style: STATUS_STYLES.cancelled },
  {
    key: "pending",
    label: "Ждут итога",
    match: (r, now) => (r.status === "scheduled" || r.status === "confirmed") && new Date(r.starts_at) <= now,
  },
  {
    key: "upcoming",
    label: "Впереди",
    match: (r, now) => (r.status === "scheduled" || r.status === "confirmed") && new Date(r.starts_at) > now,
  },
];

type Agg = { total: number; online: number; offline: number; c: Record<string, number> };

function aggregate(rows: Row[], now: Date): Agg {
  const a: Agg = { total: rows.length, online: 0, offline: 0, c: {} };
  for (const col of COLS) a.c[col.key] = 0;
  for (const r of rows) {
    if (r.format === "online") a.online++;
    else a.offline++;
    for (const col of COLS) if (col.match(r, now)) a.c[col.key]++;
  }
  return a;
}

/** % проведённых от назначенных (без переносов и отмен) */
function rate(a: Agg) {
  const base = a.total - a.c.rescheduled - a.c.cancelled;
  return base > 0 ? Math.round((a.c.done / base) * 100) : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export default async function StatsPage(props: PageProps<"/stats">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const isRop = me.roles.includes("rop") || me.roles.includes("admin");
  const today = todayLocal();

  const period = ["today", "week", "month", "custom"].includes(str(sp.period)) ? str(sp.period) : "week";
  let from = today;
  let to = today;
  if (period === "week") {
    from = weekStart(today);
    to = shiftDate(from, 6);
  } else if (period === "month") {
    from = today.slice(0, 8) + "01";
    const [y, m] = today.split("-").map(Number);
    to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  } else if (period === "custom") {
    from = isDate(sp.from) ? sp.from : weekStart(today);
    to = isDate(sp.to) ? sp.to : shiftDate(from, 6);
  }
  const hunter = isRop ? str(sp.hunter) : "";
  const closer = isRop ? str(sp.closer) : "";
  const statusFilter = COLS.some((c) => c.key === str(sp.status)) ? str(sp.status) : "";

  const supabase = await createClient();
  let q = supabase
    .from("bookings")
    .select(
      "id,starts_at,client_name,format,status,hunter_id,closer_id,student_grade,qual,hunter:users!bookings_hunter_id_fkey(name),closer:users!bookings_closer_id_fkey(name)",
    )
    .gte("starts_at", dayStartIso(from))
    .lt("starts_at", dayStartIso(shiftDate(to, 1)))
    .order("starts_at")
    .limit(5000);
  if (hunter) q = q.eq("hunter_id", hunter);
  if (closer) q = q.eq("closer_id", closer);

  const [{ data }, settings, { data: people }] = await Promise.all([
    q,
    getSettings(),
    supabase.from("users").select("id,name,roles").order("name"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const now = new Date();
  const tz = settings.timezone;
  const total = aggregate(rows, now);

  // по дням (все дни периода, даже пустые — если период не длиннее 62 дней)
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 62; d = shiftDate(d, 1)) days.push(d);
  const byDay = days.map((d) => ({ key: d, label: formatSlot(dayStartIso(d), tz, false), agg: aggregate(rows.filter((r) => localDate(r.starts_at) === d), now) }));

  const group = (field: "hunter_id" | "closer_id", nameField: "hunter" | "closer") => {
    const m = new Map<string, { name: string; rows: Row[] }>();
    for (const r of rows) {
      const k = r[field];
      if (!m.has(k)) m.set(k, { name: r[nameField]?.name ?? "—", rows: [] });
      m.get(k)!.rows.push(r);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ key: k, label: v.name, agg: aggregate(v.rows, now) }))
      .sort((a, b) => b.agg.total - a.agg.total);
  };
  const byHunter = group("hunter_id", "hunter");
  const byCloser = group("closer_id", "closer");

  const listed = statusFilter ? rows.filter((r) => COLS.find((c) => c.key === statusFilter)!.match(r, now)) : [];

  const hunters = (people ?? []).filter((u) => (u.roles as string[]).includes("hunter"));
  const closers = (people ?? []).filter((u) => (u.roles as string[]).includes("closer"));

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams(
      Object.entries({ period, from: period === "custom" ? from : "", to: period === "custom" ? to : "", hunter, closer, status: statusFilter, ...patch }).filter(
        ([, v]) => v,
      ) as [string, string][],
    );
    return `/stats?${p}`;
  };

  return (
    <AppShell user={me}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold">Статистика{isRop ? "" : " — мои встречи"}</h1>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {[
            ["today", "Сегодня"],
            ["week", "Неделя"],
            ["month", "Месяц"],
          ].map(([k, l]) => (
            <Link key={k} href={link({ period: k, from: "", to: "" })} className={`rounded-md px-3 py-1 ${period === k ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}>
              {l}
            </Link>
          ))}
        </div>
      </div>

      <form method="get" className="card p-3 mb-4 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        <input type="hidden" name="period" value="custom" />
        <label className="block">
          <span className="text-xs text-gray-500">С</span>
          <input type="date" name="from" defaultValue={from} className="input mt-0.5" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">По</span>
          <input type="date" name="to" defaultValue={to} className="input mt-0.5" />
        </label>
        {isRop && (
          <label className="block">
            <span className="text-xs text-gray-500">Хантер</span>
            <select name="hunter" defaultValue={hunter} className="input mt-0.5">
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
            <select name="closer" defaultValue={closer} className="input mt-0.5">
              <option value="">Все</option>
              {closers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-end">
          <button className="btn-primary w-full py-2">Показать</button>
        </div>
      </form>

      {/* KPI */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-4">
        <Kpi label="Назначено" value={total.total} sub={`онлайн ${total.online} · оффлайн ${total.offline}`} />
        <Kpi label="% проведённых" value={rate(total) === null ? "—" : `${rate(total)}%`} sub="без переносов и отмен" strong />
        {COLS.map((c) => (
          <Link key={c.key} href={link({ status: statusFilter === c.key ? "" : c.key })}>
            <Kpi label={c.label} value={total.c[c.key]} active={statusFilter === c.key} />
          </Link>
        ))}
      </div>

      {statusFilter && (
        <div className="card mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">
              {COLS.find((c) => c.key === statusFilter)!.label}: {listed.length}
            </h2>
            <Link href={link({ status: "" })} className="text-xs text-gray-500 underline">
              скрыть
            </Link>
          </div>
          <ul className="divide-y divide-gray-100 text-sm">
            {listed.map((r) => (
              <li key={r.id}>
                <Link href={`/bookings/${r.id}`} className="flex flex-wrap gap-x-3 py-2 hover:bg-gray-50">
                  <span className="tabular-nums text-gray-500 w-36">{formatSlot(r.starts_at, tz)}</span>
                  <span className="font-medium">{r.client_name}</span>
                  {r.student_grade && <span className="text-gray-500">{r.student_grade}</span>}
                  {r.qual && <span className="text-violet-700 font-semibold">{r.qual}</span>}
                  <span className="text-gray-500">
                    хантер {r.hunter?.name} · клоузер {r.closer?.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <StatsTable title="По дням" first="День" rows={byDay} highlight={statusFilter} />
      {isRop && <StatsTable title="По хантерам" first="Хантер" rows={byHunter} highlight={statusFilter} />}
      {isRop && <StatsTable title="По клоузерам" first="Клоузер" rows={byCloser} highlight={statusFilter} />}

      <p className="text-xs text-gray-500 mt-2">
        «% проведённых» = проведённые ÷ (назначенные − переносы − отмены). Перенесённая встреча считается в день старого
        времени как «Перенос», а новая — в свой день.
      </p>
    </AppShell>
  );
}

function Kpi({ label, value, sub, strong, active }: { label: string; value: number | string; sub?: string; strong?: boolean; active?: boolean }) {
  return (
    <div className={`card p-3 h-full ${active ? "ring-2 ring-gray-900" : ""}`}>
      <div className="text-xs text-gray-500 leading-tight">{label}</div>
      <div className={`text-2xl tabular-nums mt-1 ${strong ? "font-bold" : "font-semibold"}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 leading-tight mt-0.5">{sub}</div>}
    </div>
  );
}

function StatsTable({
  title,
  first,
  rows,
  highlight,
}: {
  title: string;
  first: string;
  rows: { key: string; label: string; agg: Agg }[];
  highlight: string;
}) {
  const nonEmpty = rows.filter((r) => r.agg.total > 0);
  return (
    <div className="card p-0 mb-4 overflow-hidden">
      <h2 className="font-medium px-4 pt-3 pb-2">{title}</h2>
      {nonEmpty.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-gray-500">Встреч за период нет.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-gray-500 border-y border-gray-100 bg-gray-50">
                <th className="text-left font-medium px-4 py-2 sticky left-0 bg-gray-50">{first}</th>
                <th className="font-medium px-2">Назнач.</th>
                <th className="font-medium px-2">%</th>
                {COLS.map((c) => (
                  <th key={c.key} className={`font-medium px-2 whitespace-nowrap ${highlight === c.key ? "text-gray-900" : ""}`}>
                    {c.label}
                  </th>
                ))}
                <th className="font-medium px-2">Онл/Офф</th>
              </tr>
            </thead>
            <tbody>
              {nonEmpty.map((r) => (
                <tr key={r.key} className="border-b border-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap sticky left-0 bg-white">{r.label}</td>
                  <td className="text-center px-2 font-semibold">{r.agg.total}</td>
                  <td className="text-center px-2">{rate(r.agg) === null ? "—" : `${rate(r.agg)}%`}</td>
                  {COLS.map((c) => (
                    <td key={c.key} className={`text-center px-2 ${highlight === c.key ? "bg-gray-100 font-semibold" : ""} ${r.agg.c[c.key] ? "" : "text-gray-300"}`}>
                      {r.agg.c[c.key]}
                    </td>
                  ))}
                  <td className="text-center px-2 text-gray-500">
                    {r.agg.online}/{r.agg.offline}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
