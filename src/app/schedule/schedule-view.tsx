"use client";
import { useState, useTransition } from "react";
import { WeekGrid } from "@/components/week-grid";
import type { Day, Time } from "@/lib/schedule";
import {
  REASONS,
  REASON_LABELS,
  REASON_SHORT,
  WEEKDAYS_SHORT,
  minutesLabel,
  type BlockReason,
} from "@/lib/labels";
import {
  closeSlotsAction,
  closeRangeAction,
  closeRecurringAction,
  deleteBlockAction,
} from "./actions";

export type BlockInfo = {
  id: string;
  kind: "once" | "recurring";
  forAll: boolean;
  reason: BlockReason;
  reasonLabel: string;
  comment: string | null;
  text: string;
  canDelete: boolean;
};

export type CellInfo = { past: boolean; block: BlockInfo | null };

type Props = {
  target: string;
  isAll: boolean;
  canManageAll: boolean;
  days: Day[];
  times: Time[];
  cells: Record<string, CellInfo>;
  blocks: BlockInfo[];
  slotMinutes: number;
  workStart: number;
  workEnd: number;
  today: string;
};

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dayTitle = (d: Day) => `${d.weekday}, ${d.dayNum} ${MONTHS[d.month - 1]}`;

export function ScheduleView(p: Props) {
  const [selected, setSelected] = useState<{ date: string; minutes: number } | null>(null);
  const [form, setForm] = useState(false);

  const sel = selected ? p.cells[`${selected.date}|${selected.minutes}`] : null;
  const selDay = selected ? p.days.find((d) => d.date === selected.date) : null;

  return (
    <div className="space-y-4">
      <div className="card p-2 sm:p-4">
        <WeekGrid
          days={p.days}
          times={p.times}
          renderCell={(date, minutes) => {
            const c = p.cells[`${date}|${minutes}`];
            if (c?.past) return <div className="h-10 rounded-md bg-gray-50" aria-label="Прошло" />;
            const b = c?.block;
            return (
              <button
                type="button"
                onClick={() => setSelected({ date, minutes })}
                className={`h-10 w-full rounded-md border text-[10px] sm:text-xs leading-tight px-0.5 transition ${
                  b
                    ? b.forAll && !p.isAll
                      ? "bg-violet-50 border-violet-200 text-violet-800"
                      : "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                }`}
                title={b ? `${b.reasonLabel}${b.comment ? ": " + b.comment : ""}` : "Свободно"}
              >
                {b ? REASON_SHORT[b.reason] : <span className="opacity-60">✓</span>}
              </button>
            );
          }}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
          <Legend className="bg-emerald-100 border-emerald-200" label="свободно" />
          <Legend className="bg-amber-100 border-amber-200" label="закрыто" />
          {!p.isAll && <Legend className="bg-violet-100 border-violet-200" label="закрыто для всех" />}
          <span>Нажмите на слот, чтобы закрыть или открыть его</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setForm(true)}>
          {p.isAll ? "Закрыть слоты всем клоузерам" : "Закрыть слоты"}
        </button>
      </div>

      <BlocksList blocks={p.blocks} isAll={p.isAll} />

      {selected && selDay && (
        <SlotDialog
          title={`${dayTitle(selDay)}, ${minutesLabel(selected.minutes)}–${minutesLabel(selected.minutes + p.slotMinutes)}`}
          block={sel?.block ?? null}
          isAll={p.isAll}
          onClose={() => setSelected(null)}
          onCloseSlot={(reason, comment) =>
            closeSlotsAction({
              target: p.target,
              date: selected.date,
              minutes: [selected.minutes],
              reason,
              comment,
            })
          }
        />
      )}

      {form && <CloseForm {...p} onDone={() => setForm(false)} />}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded border ${className}`} /> {label}
    </span>
  );
}

/* ---------- Модальное окно ---------- */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Закрыть">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReasonFields({
  reason,
  setReason,
  comment,
  setComment,
}: {
  reason: BlockReason | "";
  setReason: (r: BlockReason) => void;
  comment: string;
  setComment: (c: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Причина</div>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full px-3 py-1.5 text-sm border ${
              reason === r ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300 text-gray-700"
            }`}
          >
            {REASON_LABELS[r]}
          </button>
        ))}
      </div>
      <input
        className="input"
        placeholder={reason === "other" ? "Комментарий (обязательно)" : "Комментарий (необязательно)"}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
    </div>
  );
}

function SlotDialog({
  title,
  block,
  isAll,
  onClose,
  onCloseSlot,
}: {
  title: string;
  block: BlockInfo | null;
  isAll: boolean;
  onClose: () => void;
  onCloseSlot: (reason: string, comment: string) => Promise<{ ok?: true; error?: string }>;
}) {
  const [reason, setReason] = useState<BlockReason | "">("");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok?: true; error?: string }>) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res.error) setErr(res.error);
      else onClose();
    });
  }

  if (block) {
    return (
      <Modal title={title} onClose={onClose}>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-1">
          <div className="font-medium">
            Закрыто: {block.reasonLabel}
            {block.forAll && !isAll && <span className="ml-1 text-violet-700">(для всех клоузеров)</span>}
          </div>
          {block.comment && <div className="text-gray-700">{block.comment}</div>}
          <div className="text-gray-600">
            {block.kind === "recurring" ? "Повтор: " : ""}
            {block.text}
          </div>
        </div>
        {block.canDelete ? (
          <>
            <p className="text-xs text-gray-500">
              Откроется закрытие целиком: {block.kind === "recurring" ? "все повторы" : block.text}.
            </p>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button
              className="btn-primary w-full"
              disabled={pending}
              onClick={() => run(() => deleteBlockAction(block.id))}
            >
              {pending ? "Открываем…" : "Открыть"}
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-500">Это закрытие поставил админ или РОП — открыть его могут только они.</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-gray-600">
        {isAll ? "Слот свободен. Закрыть его всем клоузерам?" : "Слот свободен. Закрыть его?"}
      </p>
      <ReasonFields reason={reason} setReason={setReason} comment={comment} setComment={setComment} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        className="btn-primary w-full"
        disabled={pending || !reason}
        onClick={() => run(() => onCloseSlot(reason, comment))}
      >
        {pending ? "Закрываем…" : "Закрыть слот"}
      </button>
    </Modal>
  );
}

/* ---------- Форма закрытия: разово / диапазон / повтор ---------- */

type Mode = "slots" | "range" | "recurring";

function CloseForm(p: Props & { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("slots");
  const [reason, setReason] = useState<BlockReason | "">("");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // разово
  const [date, setDate] = useState(p.today);
  const [mins, setMins] = useState<number[]>([]);
  // диапазон
  const [from, setFrom] = useState(p.today);
  const [to, setTo] = useState(p.today);
  // повтор
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [rStart, setRStart] = useState(p.times[0]?.minutes ?? p.workStart * 60);
  const [rEnd, setREnd] = useState((p.times[0]?.minutes ?? p.workStart * 60) + p.slotMinutes);
  const [rFrom, setRFrom] = useState(p.today);
  const [rUntil, setRUntil] = useState("");

  const hourOptions: number[] = [];
  for (let m = p.workStart * 60; m <= p.workEnd * 60; m += p.slotMinutes) hourOptions.push(m);

  const toggle = (arr: number[], v: number) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  function submit() {
    setErr(null);
    start(async () => {
      let res: { ok?: true; error?: string };
      if (mode === "slots") {
        res = await closeSlotsAction({ target: p.target, date, minutes: mins, reason, comment });
      } else if (mode === "range") {
        res = await closeRangeAction({ target: p.target, from, to, reason, comment });
      } else {
        res = await closeRecurringAction({
          target: p.target,
          weekdays,
          startMinutes: rStart,
          endMinutes: rEnd,
          from: rFrom,
          until: rUntil,
          reason,
          comment,
        });
      }
      if (res.error) setErr(res.error);
      else p.onDone();
    });
  }

  const tabs: { id: Mode; label: string }[] = [
    { id: "slots", label: "Слоты в день" },
    { id: "range", label: "Диапазон дат" },
    { id: "recurring", label: "Повтор" },
  ];

  return (
    <Modal title={p.isAll ? "Закрыть слоты всем клоузерам" : "Закрыть слоты"} onClose={p.onDone}>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 text-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            className={`rounded-md py-1.5 ${mode === t.id ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "slots" && (
        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {p.days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => {
                  setDate(d.date);
                  setMins([]);
                }}
                className={`rounded-lg px-2.5 py-1.5 text-sm border whitespace-nowrap ${
                  date === d.date ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"
                }`}
              >
                {d.weekday} {d.dayNum}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {p.times.map((t) => {
              const c = p.cells[`${date}|${t.minutes}`];
              const disabled = !!c?.past || !!c?.block;
              const on = mins.includes(t.minutes);
              return (
                <button
                  key={t.minutes}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMins(toggle(mins, t.minutes))}
                  className={`rounded-lg py-2 text-sm border tabular-nums ${
                    disabled
                      ? "bg-gray-50 text-gray-300 border-gray-100"
                      : on
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white border-gray-300"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="text-xs text-gray-600 underline"
            onClick={() =>
              setMins(
                p.times
                  .filter((t) => {
                    const c = p.cells[`${date}|${t.minutes}`];
                    return !c?.past && !c?.block;
                  })
                  .map((t) => t.minutes),
              )
            }
          >
            Выбрать весь день
          </button>
        </div>
      )}

      {mode === "range" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            С
            <input type="date" className="input mt-1" value={from} min={p.today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            По (включительно)
            <input type="date" className="input mt-1" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <p className="col-span-2 text-xs text-gray-500">Закрываются все слоты в эти дни целиком.</p>
        </div>
      )}

      {mode === "recurring" && (
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium mb-1.5">Дни недели</div>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS_SHORT.map((w, i) => {
                const v = i + 1;
                const on = weekdays.includes(v);
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWeekdays(toggle(weekdays, v))}
                    className={`rounded-lg py-1.5 text-sm border ${
                      on ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"
                    }`}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
            <button type="button" className="text-xs text-gray-600 underline mt-1.5" onClick={() => setWeekdays([1, 2, 3, 4, 5, 6, 7])}>
              Каждый день
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              С
              <select className="input mt-1" value={rStart} onChange={(e) => setRStart(Number(e.target.value))}>
                {hourOptions.slice(0, -1).map((m) => (
                  <option key={m} value={m}>
                    {minutesLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              До
              <select className="input mt-1" value={rEnd} onChange={(e) => setREnd(Number(e.target.value))}>
                {hourOptions.slice(1).map((m) => (
                  <option key={m} value={m}>
                    {minutesLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Начиная с
              <input type="date" className="input mt-1" value={rFrom} min={p.today} onChange={(e) => setRFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              До даты (необяз.)
              <input type="date" className="input mt-1" value={rUntil} min={rFrom} onChange={(e) => setRUntil(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      <ReasonFields reason={reason} setReason={setReason} comment={comment} setComment={setComment} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-primary w-full" disabled={pending || !reason} onClick={submit}>
        {pending ? "Сохраняем…" : "Закрыть"}
      </button>
    </Modal>
  );
}

/* ---------- Список закрытий ---------- */

function BlocksList({ blocks, isAll }: { blocks: BlockInfo[]; isAll: boolean }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!blocks.length) {
    return <div className="card text-sm text-gray-500">Активных закрытий нет.</div>;
  }

  return (
    <div className="card space-y-2">
      <h2 className="font-medium">Закрытия</h2>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <ul className="divide-y divide-gray-100">
        {blocks.map((b) => (
          <li key={b.id} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <div className="font-medium">
                {b.reasonLabel}
                {b.kind === "recurring" && <span className="ml-1.5 text-xs text-gray-500">повтор</span>}
                {b.forAll && !isAll && <span className="ml-1.5 text-xs text-violet-700">для всех</span>}
              </div>
              <div className="text-gray-600">{b.text}</div>
              {b.comment && <div className="text-gray-500 text-xs mt-0.5">{b.comment}</div>}
            </div>
            {b.canDelete && (
              <button
                className="btn-secondary px-3 py-1.5 shrink-0"
                disabled={pending && busy === b.id}
                onClick={() => {
                  setBusy(b.id);
                  setErr(null);
                  start(async () => {
                    const res = await deleteBlockAction(b.id);
                    if (res.error) setErr(res.error);
                  });
                }}
              >
                {pending && busy === b.id ? "…" : "Открыть"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
