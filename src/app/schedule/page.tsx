import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getGrid, localParts, addDays } from "@/lib/schedule";
import { minutesLabel, WEEKDAYS_SHORT, REASON_LABELS, type BlockReason } from "@/lib/labels";
import { ScheduleView, type CellInfo, type BlockInfo } from "./schedule-view";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function fmtDate(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

type BlockRow = {
  id: string;
  closer_id: string | null;
  kind: "once" | "recurring";
  starts_at: string | null;
  ends_at: string | null;
  weekdays: number[] | null;
  start_time: string | null;
  end_time: string | null;
  valid_from: string | null;
  valid_until: string | null;
  reason: BlockReason;
  comment: string | null;
};

export default async function SchedulePage(props: PageProps<"/schedule">) {
  const me = await requireRole("closer", "admin", "rop");
  const canAll = me.roles.includes("admin") || me.roles.includes("rop");
  const sp = await props.searchParams;
  const grid = await getGrid();
  const tz = grid.settings.timezone;

  // Чьё расписание смотрим
  let target = typeof sp.closer === "string" ? sp.closer : "";
  if (!canAll) target = me.id;
  if (!target) target = me.roles.includes("closer") ? me.id : (grid.closers[0]?.id ?? "all");
  if (target !== "all" && !grid.closers.some((c) => c.id === target)) {
    target = grid.closers[0]?.id ?? "all";
  }

  // Закрытия (активные)
  const supabase = await createClient();
  let q = supabase
    .from("slot_blocks")
    .select("id,closer_id,kind,starts_at,ends_at,weekdays,start_time,end_time,valid_from,valid_until,reason,comment")
    .order("created_at", { ascending: false });
  q = target === "all" ? q.is("closer_id", null) : q.or(`closer_id.eq.${target},closer_id.is.null`);
  const { data: blockRows } = await q;

  const now = new Date();
  const today = localParts(now, tz).date;

  const describe = (b: BlockRow): string => {
    if (b.kind === "once") {
      const s = localParts(new Date(b.starts_at!), tz);
      const e = localParts(new Date(b.ends_at!), tz);
      if (s.minutes === 0 && e.minutes === 0) {
        const last = addDays(e.date, -1);
        return last === s.date ? `${fmtDate(s.date)}, весь день` : `${fmtDate(s.date)} – ${fmtDate(last)}, весь день`;
      }
      if (s.date === e.date) {
        return `${fmtDate(s.date)}, ${minutesLabel(s.minutes)}–${minutesLabel(e.minutes)}`;
      }
      return `${fmtDate(s.date)} ${minutesLabel(s.minutes)} – ${fmtDate(e.date)} ${minutesLabel(e.minutes)}`;
    }
    const days =
      b.weekdays!.length === 7
        ? "Каждый день"
        : [...b.weekdays!].sort().map((d) => WEEKDAYS_SHORT[d - 1]).join(", ");
    const time = `${b.start_time!.slice(0, 5)}–${b.end_time!.slice(0, 5).replace("24:00", "24:00")}`;
    const period = b.valid_until
      ? `с ${fmtDate(b.valid_from!)} по ${fmtDate(b.valid_until)}`
      : b.valid_from! > today
        ? `с ${fmtDate(b.valid_from!)}`
        : "";
    return [days, time, period].filter(Boolean).join(" · ");
  };

  const blocks: BlockInfo[] = ((blockRows ?? []) as BlockRow[])
    .filter((b) =>
      b.kind === "once" ? new Date(b.ends_at!) > now : !b.valid_until || b.valid_until >= today,
    )
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      forAll: b.closer_id === null,
      reason: b.reason,
      reasonLabel: REASON_LABELS[b.reason],
      comment: b.comment,
      text: describe(b),
      canDelete: canAll || (b.closer_id !== null && b.closer_id === me.id),
    }));
  const blockById = Object.fromEntries(blocks.map((b) => [b.id, b]));

  // Состояние ячеек для выбранного клоузера / «всех»
  const cells: Record<string, CellInfo> = {};
  for (const slot of Object.values(grid.slots)) {
    let blockId: string | null = null;
    if (target === "all") {
      blockId = slot.cells.find((c) => c.blockForAll)?.blockId ?? null;
    } else {
      blockId = slot.cells.find((c) => c.closerId === target)?.blockId ?? null;
    }
    cells[slot.key] = { past: slot.past, block: blockId ? (blockById[blockId] ?? null) : null };
  }

  const targetName =
    target === "all" ? "Все клоузеры" : (grid.closers.find((c) => c.id === target)?.name ?? "");

  return (
    <AppShell user={me}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold">
          {target === me.id ? "Моё расписание" : `Расписание: ${targetName}`}
        </h1>
        <span className="text-xs text-gray-500">GMT+5</span>
      </div>

      {canAll && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
          {[{ id: "all", name: "Все клоузеры" }, ...grid.closers].map((c) => (
            <Link
              key={c.id}
              href={`/schedule?closer=${c.id}`}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm border ${
                c.id === target
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {grid.closers.length === 0 && target !== "all" ? (
        <div className="card text-sm text-gray-600">
          Нет активных клоузеров. Назначьте роль «Клоузер» в разделе «Сотрудники».
        </div>
      ) : (
        <ScheduleView
          key={target}
          target={target}
          isAll={target === "all"}
          canManageAll={canAll}
          days={grid.days}
          times={grid.times}
          cells={cells}
          blocks={blocks}
          slotMinutes={grid.settings.slot_minutes}
          workStart={grid.settings.work_start_hour}
          workEnd={grid.settings.work_end_hour}
          today={today}
        />
      )}
    </AppShell>
  );
}
