import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { WeekGrid } from "@/components/week-grid";
import { getGrid } from "@/lib/schedule";

export default async function SlotsPage() {
  const user = await requireRole("hunter", "rop", "admin");
  const grid = await getGrid();
  const total = grid.closers.length;

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
        <div className="card p-2 sm:p-4">
          <WeekGrid
            days={grid.days}
            times={grid.times}
            renderCell={(date, minutes) => {
              const slot = grid.slots[`${date}|${minutes}`];
              if (!slot || slot.past) {
                return <div className="h-10 rounded-md bg-gray-50" aria-label="Прошло" />;
              }
              const free = slot.cells.filter((c) => !c.blockId).length;
              return free > 0 ? (
                <div
                  className="h-10 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 flex flex-col items-center justify-center leading-none"
                  title={`Свободно: ${free} из ${total}`}
                >
                  <span className="font-semibold text-sm">{free}</span>
                  <span className="text-[10px] hidden sm:block mt-0.5">свободно</span>
                </div>
              ) : (
                <div
                  className="h-10 rounded-md bg-gray-100 text-gray-400 flex items-center justify-center"
                  title="Нет свободных клоузеров"
                >
                  —
                </div>
              );
            }}
          />
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> число
              свободных клоузеров
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-gray-100" /> занято
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-gray-50 border border-gray-200" /> прошло
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Запись клиента на слот появится на этапе 3.
          </p>
        </div>
      )}
    </AppShell>
  );
}
