import type { Day, Time } from "@/lib/schedule";

/** Каркас сетки: колонки — дни, строки — время. Ячейку рисует renderCell */
export function WeekGrid({
  days,
  times,
  renderCell,
  onDayClick,
}: {
  days: Day[];
  times: Time[];
  renderCell: (date: string, minutes: number) => React.ReactNode;
  onDayClick?: (date: string) => void;
}) {
  return (
    <div
      className="grid gap-1 text-xs"
      style={{ gridTemplateColumns: `40px repeat(${days.length}, minmax(0, 1fr))` }}
    >
      <div />
      {days.map((d) => {
        const cls = `text-center rounded-md py-1 leading-tight ${
          d.isToday ? "bg-gray-900 text-white" : "text-gray-600"
        }`;
        const inner = (
          <>
            <div className="font-medium">{d.weekday}</div>
            <div>{d.dayNum}</div>
          </>
        );
        return onDayClick ? (
          <button
            key={d.date}
            type="button"
            onClick={() => onDayClick(d.date)}
            className={`${cls} ${d.isToday ? "" : "hover:bg-gray-100"}`}
            title="Закрыть или открыть слоты в этот день"
          >
            {inner}
          </button>
        ) : (
          <div key={d.date} className={cls}>
            {inner}
          </div>
        );
      })}
      {times.map((t) => (
        <Row key={t.minutes} label={t.label}>
          {days.map((d) => (
            <div key={d.date}>{renderCell(d.date, t.minutes)}</div>
          ))}
        </Row>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="text-right pr-1 text-gray-500 self-center tabular-nums">{label}</div>
      {children}
    </>
  );
}
