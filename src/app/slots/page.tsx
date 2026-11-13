import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getGrid } from "@/lib/schedule";
import { SlotsView, type SlotSummary } from "./slots-view";
import { REASON_LABELS } from "@/lib/labels";

export default async function SlotsPage() {
  const user = await requireRole("hunter", "rop", "admin");
  const grid = await getGrid();
  const total = grid.closers.length;

  const slots: Record<string, SlotSummary> = {};
  for (const [key, sl] of Object.entries(grid.slots)) {
    slots[key] = {
      start: sl.start,
      minutes: sl.minutes,
      past: sl.past,
      free: sl.past ? 0 : sl.cells.filter((c) => c.canBook).length,
      busy: sl.past
        ? []
        : sl.cells
            .filter((c) => c.bookingId || c.blockId)
            .map((c) =>
              c.bookingId
                ? {
                    text: `${c.closerName} — встреча · хантер ${c.bookingHunterName ?? "—"}`,
                    bookingId: c.bookingId,
                    mine: c.bookingHunterId === user.id,
                  }
                : {
                    text: `${c.closerName} — ${c.reason ? REASON_LABELS[c.reason] : "закрыто"}${c.comment ? ` (${c.comment})` : ""}`,
                    bookingId: null,
                    mine: false,
                  },
            ),
    };
  }

  return (
    <AppShell user={user}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h1 className="text-lg font-semibold">Свободные слоты</h1>
        <span className="text-xs text-gray-500">GMT+5 · клоузеров: {total}</span>
      </div>

      {total === 0 ? (
        <div className="card text-sm text-gray-600">
          Нет активных клоузеров. Админ может назначить роль «Клоузер» в разделе «Сотрудники».
        </div>
      ) : (
        <SlotsView
          days={grid.days}
          times={grid.times}
          slots={slots}
          total={total}
          meId={user.id}
          seeAll={user.roles.includes("rop") || user.roles.includes("admin")}
          canBook={user.roles.some((r) => r === "hunter" || r === "rop" || r === "admin")}
          officeAddress={grid.settings.office_address}
          tz={grid.settings.timezone}
          slotMinutes={grid.settings.slot_minutes}
          meetingMinutes={grid.settings.meeting_minutes}
        />
      )}
    </AppShell>
  );
}
