"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { ResultDialog } from "@/components/result-dialog";
import {
  gradeOptions,
  QUALS,
  RESULT_STATUSES,
  STATUSES,
  STATUS_LABELS,
  STATUS_STYLES,
  formatSlot,
  type BookingFormat,
  type BookingStatus,
} from "@/lib/labels";
import {
  freeClosersAction,
  freeStartsAction,
  refreshAmoAction,
  rescheduleAction,
  ropUpdateAction,
  restoreBookingAction,
  retryAmoSyncAction,
  trashBookingAction,
  setMeetingResultAction,
  setStatusAction,
  updateMyBookingAction,
  type CreateResult,
  type FreeStart,
} from "../actions";

type R = { ok?: true; error?: string };

function useRun() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<R>, onOk?: () => void) => {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (r.error) setErr(r.error);
      else onOk?.();
    });
  };
  return { pending, err, run };
}

/* ---------- amoCRM ---------- */

export function RefreshAmo({ id, crmUrl }: { id: string; crmUrl: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <button
        className="btn-secondary w-full px-3 py-1.5"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshAmoAction(id, crmUrl);
            setMsg(r.error ?? "Обновлено");
          })
        }
      >
        {pending ? "Загружаем…" : "Обновить из amoCRM"}
      </button>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}

/* ---------- Статус ---------- */

export type Perms = {
  isRop: boolean;
  isHunterOwner: boolean;
  isCloserOwner: boolean;
  started: boolean;
};

export function StatusPanel({
  id,
  status,
  perms,
  qualAfter,
  noteAfter,
}: {
  id: string;
  status: BookingStatus;
  perms: Perms;
  qualAfter: string | null;
  noteAfter: string | null;
}) {
  const { pending, err, run } = useRun();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<BookingStatus | null>(null);
  const terminal = status === "rescheduled";

  const buttons: BookingStatus[] = [];
  if (!terminal) {
    if (perms.isRop) {
      STATUSES.filter((s) => s !== "rescheduled" && s !== status).forEach((s) => buttons.push(s));
    } else {
      if (perms.isCloserOwner && perms.started)
        RESULT_STATUSES.filter((s) => s !== status).forEach((s) => buttons.push(s));
      if (perms.isHunterOwner && !perms.started) {
        if (status === "scheduled") buttons.push("confirmed");
        if (status === "confirmed") buttons.push("scheduled");
      }
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Статус</h2>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>
      {terminal && <p className="text-sm text-gray-500">Встреча перенесена — статус ведётся у новой встречи.</p>}
      {buttons.length > 0 && (
        <>
          <div className="text-xs text-gray-500">Поставить статус:</div>
          <div className="flex flex-wrap gap-1.5">
            {buttons.map((s) => (
              <button
                key={s}
                disabled={pending}
                onClick={() => (RESULT_STATUSES.includes(s) ? setResult(s) : run(() => setStatusAction(id, s, note)))}
                className={`rounded-full border px-3 py-1.5 text-sm ${STATUS_STYLES[s]} hover:opacity-80`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {perms.isRop && (
            <input
              className="input"
              placeholder="Комментарий (для «Подтверждена», «Отменена»)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </>
      )}
      {!perms.isRop && perms.isCloserOwner && !perms.started && (
        <p className="text-xs text-gray-500">Итог встречи можно будет поставить после её начала.</p>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {result && (
        <ResultDialog id={id} status={result} initialQual={qualAfter} initialNote={noteAfter} onClose={() => setResult(null)} />
      )}
    </div>
  );
}

/** Итог встречи: квал после встречи, примечание, отметка о передаче в amoCRM */
export function MeetingResult({
  id,
  status,
  qual,
  note,
  canEdit,
  amoSync,
}: {
  id: string;
  status: BookingStatus;
  qual: string | null;
  note: string | null;
  canEdit: boolean;
  amoSync: { ok: boolean; message: string } | null;
}) {
  const { pending, err, run } = useRun();
  const [q, setQ] = useState(qual ?? "");
  const [n, setN] = useState(note ?? "");
  const [saved, setSaved] = useState(false);
  const [amoMsg, setAmoMsg] = useState<string | null>(null);
  const dirty = q !== (qual ?? "") || n !== (note ?? "");
  const qualRequired = status === "done" || status === "not_counted";

  return (
    <div className="card space-y-3">
      <h2 className="font-medium">Итог встречи</h2>
      {canEdit ? (
        <>
          <div className="text-sm">
            Квал после встречи
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 mt-1">
              {QUALS.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => {
                    setQ(q === x && !qualRequired ? "" : x);
                    setSaved(false);
                  }}
                  className={`rounded-md py-1.5 ${q === x ? "bg-white shadow-sm font-semibold" : "text-gray-600"}`}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            Примечание после встречи
            <textarea
              className="input mt-1"
              rows={3}
              value={n}
              onChange={(e) => {
                setN(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          {(dirty || saved) && (
            <button
              className="btn-primary w-full"
              disabled={pending || !dirty}
              onClick={() => run(() => setMeetingResultAction(id, q, n), () => setSaved(true))}
            >
              {pending ? "Сохраняем…" : saved && !dirty ? "Сохранено" : "Сохранить итог"}
            </button>
          )}
        </>
      ) : (
        <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-gray-500">Квал</dt>
          <dd>{qual ?? <span className="text-gray-400">не указан</span>}</dd>
          <dt className="text-gray-500">Примечание</dt>
          <dd className="whitespace-pre-wrap">{note ?? <span className="text-gray-400">—</span>}</dd>
        </dl>
      )}

      {status === "done" && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs space-y-1.5 ${
            amoSync?.ok ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          <div>
            <b>amoCRM:</b> {amoMsg ?? amoSync?.message ?? "итог ещё не передавался"}
          </div>
          {canEdit && !amoSync?.ok && (
            <button
              className="underline"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await retryAmoSyncAction(id);
                  if (r.amo) setAmoMsg(r.amo);
                  return r;
                })
              }
            >
              {pending ? "Передаём…" : "Повторить передачу в amoCRM"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Перенос ---------- */

type Closer = { id: string; name: string };

export function RescheduleButton({ id, isRop, tz, closers }: { id: string; isRop: boolean; tz: string; closers: Closer[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-secondary w-full" onClick={() => setOpen(true)}>
        Перенести встречу
      </button>
      {open && <RescheduleDialog id={id} isRop={isRop} tz={tz} closers={closers} onClose={() => setOpen(false)} />}
    </>
  );
}

function RescheduleDialog({
  id,
  isRop,
  tz,
  closers,
  onClose,
}: {
  id: string;
  isRop: boolean;
  tz: string;
  closers: Closer[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [starts, setStarts] = useState<FreeStart[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [pick, setPick] = useState<FreeStart | null>(null);
  const [closer, setCloser] = useState("");
  const [done, setDone] = useState<Extract<CreateResult, { ok: true }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    freeStartsAction().then((r) => {
      if (!alive) return;
      setStarts(r.starts);
      setDate(r.starts.find((s) => s.free > 0)?.date ?? r.starts[0]?.date ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const dates = starts ? [...new Set(starts.map((s) => s.date))] : [];
  const dayStarts = starts?.filter((s) => s.date === date) ?? [];

  if (done) {
    return (
      <Modal title="Встреча перенесена" onClose={onClose}>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-1">
          <div className="text-sm text-emerald-900">Новое время</div>
          <div className="text-lg font-semibold">{formatSlot(done.startsAt, tz)}</div>
          <div className="text-sm text-emerald-900">Клоузер: {done.closerName}</div>
        </div>
        <Link href={`/bookings/${done.id}`} className="btn-primary w-full" onClick={onClose}>
          Открыть новую встречу
        </Link>
      </Modal>
    );
  }

  return (
    <Modal title="Перенос встречи" onClose={onClose}>
      {!starts ? (
        <p className="text-sm text-gray-500">Загружаем свободное время…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {dates.map((d) => {
              const first = starts.find((s) => s.date === d)!;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDate(d);
                    setPick(null);
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-sm border whitespace-nowrap ${
                    date === d ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"
                  }`}
                >
                  {formatSlot(first.start, tz, false)}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {dayStarts.map((s) => (
              <button
                key={s.start}
                type="button"
                disabled={s.free === 0}
                onClick={() => {
                  setPick(s);
                  setCloser("");
                }}
                className={`rounded-lg py-2 text-sm border tabular-nums ${
                  s.free === 0
                    ? "bg-gray-50 text-gray-300 border-gray-100"
                    : pick?.start === s.start
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white border-gray-300"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {isRop && pick && (
            <label className="block text-sm">
              Клоузер
              <select className="input mt-1" value={closer} onChange={(e) => setCloser(e.target.value)}>
                <option value="">Тот же, если свободен (иначе случайный)</option>
                {closers
                  .filter((c) => pick.closerIds.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p className="text-xs text-gray-500">
            Старая встреча получит статус «Перенос», на новое время создастся встреча с теми же данными. Клоузер
            останется прежним, если он свободен.
          </p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            className="btn-primary w-full"
            disabled={!pick || pending}
            onClick={() =>
              start(async () => {
                setErr(null);
                const r = await rescheduleAction(id, pick!.start, closer || null);
                if (r.ok) {
                  setDone(r);
                  router.refresh();
                } else setErr(r.error);
              })
            }
          >
            {pending ? "Переносим…" : pick ? `Перенести на ${formatSlot(pick.start, tz)}` : "Выберите время"}
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Отмена (РОП) ---------- */

export function CancelButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { pending, err, run } = useRun();
  return (
    <>
      <button className="btn-danger w-full" onClick={() => setOpen(true)}>
        Отменить встречу
      </button>
      {open && (
        <Modal title="Отменить встречу?" onClose={() => setOpen(false)}>
          <p className="text-sm text-gray-600">Слот освободится. Встречу можно будет вернуть, сменив статус.</p>
          <input className="input" placeholder="Причина (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            className="btn-danger w-full"
            disabled={pending}
            onClick={() => run(() => setStatusAction(id, "cancelled", note), () => setOpen(false))}
          >
            {pending ? "Отменяем…" : "Отменить встречу"}
          </button>
        </Modal>
      )}
    </>
  );
}

/* ---------- Корзина (РОП/админ) ---------- */

export function TrashButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const { pending, err, run } = useRun();
  return (
    <>
      <button className="w-full text-sm text-gray-500 underline underline-offset-2 hover:text-red-700 py-1" onClick={() => setOpen(true)}>
        Удалить в корзину
      </button>
      {open && (
        <Modal title="Удалить встречу в корзину?" onClose={() => setOpen(false)}>
          <p className="text-sm text-gray-600">
            Встреча исчезнет из статистики и списков, слот клоузера освободится. Вернуть её можно в разделе «Все
            встречи» → «Корзина».
          </p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button className="btn-danger w-full" disabled={pending} onClick={() => run(() => trashBookingAction(id), () => setOpen(false))}>
            {pending ? "Удаляем…" : "Удалить в корзину"}
          </button>
        </Modal>
      )}
    </>
  );
}

export function RestoreButton({ id, small }: { id: string; small?: boolean }) {
  const { pending, err, run } = useRun();
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        className={small ? "btn-secondary px-3 py-1 text-xs" : "btn-primary"}
        disabled={pending}
        onClick={() => run(() => restoreBookingAction(id))}
      >
        {pending ? "Восстанавливаем…" : "Восстановить"}
      </button>
      {err && <span className="text-xs text-red-600 max-w-56 text-right">{err}</span>}
    </span>
  );
}

/* ---------- Правка хантером ---------- */

export function EditBooking(p: {
  id: string;
  format: BookingFormat;
  meetingUrl: string;
  crmUrl: string;
  comment: string;
  grade: string;
  qual: string;
}) {
  const [open, setOpen] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState(p.meetingUrl);
  const [crmUrl, setCrmUrl] = useState(p.crmUrl);
  const [comment, setComment] = useState(p.comment);
  const [grade, setGrade] = useState(p.grade);
  const [qual, setQual] = useState(p.qual);
  const { pending, err, run } = useRun();

  if (!open) {
    return (
      <button className="btn-secondary w-full" onClick={() => setOpen(true)}>
        Изменить данные встречи
      </button>
    );
  }

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateMyBookingAction({ id: p.id, meetingUrl, crmUrl, comment, grade, qual }), () => setOpen(false));
      }}
    >
      <h2 className="font-medium">Изменить встречу</h2>
      {p.format === "online" && (
        <label className="block text-sm">
          Ссылка на встречу
          <input className="input mt-1" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} required />
        </label>
      )}
      <label className="block text-sm">
        Ссылка на сделку в CRM
        <input className="input mt-1" value={crmUrl} onChange={(e) => setCrmUrl(e.target.value)} required />
      </label>
      <GradeQual grade={grade} setGrade={setGrade} qual={qual} setQual={setQual} />
      <label className="block text-sm">
        Комментарий для клоузера
        <textarea className="input mt-1" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Отмена
        </button>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}

function GradeQual({
  grade,
  setGrade,
  qual,
  setQual,
}: {
  grade: string;
  setGrade: (v: string) => void;
  qual: string;
  setQual: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm">
        Класс обучения
        <select className="input mt-1" value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">—</option>
          {gradeOptions(grade).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <div className="text-sm">
        Степень квала
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 mt-1">
          {QUALS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQual(qual === q ? "" : q)}
              className={`rounded-md py-1 ${qual === q ? "bg-white shadow-sm font-semibold" : "text-gray-600"}`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Правка РОПом ---------- */

export function RopEdit(p: {
  id: string;
  closerId: string;
  clientName: string;
  clientPhone: string;
  crmUrl: string;
  format: BookingFormat;
  meetingUrl: string;
  comment: string;
  grade: string;
  qual: string;
}) {
  const [open, setOpen] = useState(false);
  const [closers, setClosers] = useState<{ id: string; name: string }[] | null>(null);
  const [f, setF] = useState(p);
  const { pending, err, run } = useRun();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <>
      <button
        className="btn-secondary w-full"
        onClick={() => {
          setOpen(true);
          setF(p);
          freeClosersAction(p.id).then(setClosers);
        }}
      >
        Редактировать карточку (РОП)
      </button>
      {open && (
        <Modal title="Редактировать встречу" onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => ropUpdateAction(f), () => setOpen(false));
            }}
          >
            <label className="block text-sm">
              Клоузер
              <select className="input mt-1" value={f.closerId} onChange={(e) => set("closerId", e.target.value)}>
                {(closers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.id === p.closerId ? " (сейчас)" : ""}
                  </option>
                ))}
                {!closers && <option value={p.closerId}>Загружаем…</option>}
              </select>
              <span className="text-xs text-gray-500">В списке только клоузеры, свободные в это время.</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                Имя клиента
                <input className="input mt-1" value={f.clientName} onChange={(e) => set("clientName", e.target.value)} />
              </label>
              <label className="block text-sm">
                Телефон
                <input className="input mt-1" value={f.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} />
              </label>
            </div>
            <label className="block text-sm">
              Ссылка на сделку в CRM
              <input className="input mt-1" value={f.crmUrl} onChange={(e) => set("crmUrl", e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-sm">
              {(["online", "offline"] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => set("format", x)}
                  className={`rounded-md py-1.5 ${f.format === x ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}
                >
                  {x === "online" ? "Онлайн" : "Оффлайн"}
                </button>
              ))}
            </div>
            {f.format === "online" && (
              <label className="block text-sm">
                Ссылка на встречу
                <input className="input mt-1" value={f.meetingUrl} onChange={(e) => set("meetingUrl", e.target.value)} />
              </label>
            )}
            <GradeQual grade={f.grade} setGrade={(v) => set("grade", v)} qual={f.qual} setQual={(v) => set("qual", v)} />
            <label className="block text-sm">
              Комментарий
              <textarea className="input mt-1" rows={2} value={f.comment} onChange={(e) => set("comment", e.target.value)} />
            </label>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className="btn-primary w-full" disabled={pending}>
              {pending ? "Сохраняем…" : "Сохранить"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
