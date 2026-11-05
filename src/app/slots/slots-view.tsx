"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WeekGrid } from "@/components/week-grid";
import { Modal } from "@/components/modal";
import type { Day, GridSlot, Time } from "@/lib/schedule";
import { REASON_LABELS, formatSlot, minutesLabel } from "@/lib/labels";
import { createBookingAction, lookupAmoAction, type CreateResult } from "@/app/bookings/actions";
import type { AmoData } from "@/lib/amo";

type Props = {
  days: Day[];
  times: Time[];
  slots: Record<string, GridSlot>;
  total: number;
  meId: string;
  seeAll: boolean;
  canBook: boolean;
  officeAddress: string;
  tz: string;
  slotMinutes: number;
};

type Busy = { text: string; bookingId: string | null; mine: boolean };

function busyList(slot: GridSlot, meId: string): Busy[] {
  return slot.cells
    .filter((c) => c.bookingId || c.blockId)
    .map((c) =>
      c.bookingId
        ? {
            text: `${c.closerName} — встреча · хантер ${c.bookingHunterName ?? "—"}`,
            bookingId: c.bookingId,
            mine: c.bookingHunterId === meId,
          }
        : {
            text: `${c.closerName} — ${c.reason ? REASON_LABELS[c.reason] : "закрыто"}${c.comment ? ` (${c.comment})` : ""}`,
            bookingId: null,
            mine: false,
          },
    );
}

export function SlotsView(p: Props) {
  const [open, setOpen] = useState<GridSlot | null>(null);

  return (
    <>
      <div className="card p-2 sm:p-4">
        <WeekGrid
          days={p.days}
          times={p.times}
          renderCell={(date, minutes) => {
            const slot = p.slots[`${date}|${minutes}`];
            if (!slot || slot.past) return <div className="h-10 rounded-md bg-gray-50" aria-label="Прошло" />;
            const free = slot.cells.filter((c) => !c.blockId && !c.bookingId).length;
            const busy = busyList(slot, p.meId);
            const dayIdx = p.days.findIndex((d) => d.date === date);
            return (
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => setOpen(slot)}
                  className={`h-10 w-full rounded-md border flex flex-col items-center justify-center leading-none transition ${
                    free > 0
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
                      : "bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200"
                  }`}
                >
                  {free > 0 ? (
                    <>
                      <span className="font-semibold text-sm">{free}</span>
                      <span className="text-[10px] hidden sm:block mt-0.5">свободно</span>
                    </>
                  ) : (
                    "—"
                  )}
                </button>
                {busy.length > 0 && (
                  <div
                    className={`pointer-events-none hidden md:group-hover:block absolute z-30 top-full mt-1 w-64 rounded-lg bg-gray-900 text-white text-xs p-2.5 shadow-lg space-y-1 ${
                      dayIdx >= p.days.length - 2 ? "right-0" : "left-0"
                    }`}
                  >
                    <div className="font-medium text-gray-300">Занято:</div>
                    {busy.map((b, i) => (
                      <div key={i}>{b.text}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> число свободных клоузеров
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-100 border border-gray-200" /> занято
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-50 border border-gray-200" /> прошло
          </span>
          <span>Нажмите на слот, чтобы записать клиента или посмотреть, кем занято</span>
        </div>
      </div>

      {open && <SlotDialog {...p} slot={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SlotDialog(p: Props & { slot: GridSlot; onClose: () => void }) {
  const free = p.slot.cells.filter((c) => !c.blockId && !c.bookingId).length;
  const busy = busyList(p.slot, p.meId);
  const [done, setDone] = useState<Extract<CreateResult, { ok: true }> | null>(null);
  const title = `${formatSlot(p.slot.start, p.tz)}–${minutesLabel(p.slot.minutes + p.slotMinutes)}`;

  if (done) {
    return (
      <Modal title="Встреча назначена" onClose={p.onClose}>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-1">
          <div className="text-sm text-emerald-900">Клоузер</div>
          <div className="text-xl font-semibold text-emerald-950">{done.closerName}</div>
          <div className="text-sm text-emerald-900">{formatSlot(done.startsAt, p.tz)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/bookings/${done.id}`} className="btn-secondary">
            Карточка встречи
          </Link>
          <button className="btn-primary" onClick={p.onClose}>
            Готово
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={p.onClose}>
      {busy.length > 0 && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm space-y-1">
          <div className="text-xs font-medium text-gray-500">Занято</div>
          {busy.map((b, i) =>
            b.bookingId && (b.mine || p.seeAll) ? (
              <Link key={i} href={`/bookings/${b.bookingId}`} className="block text-gray-800 underline underline-offset-2">
                {b.text}
              </Link>
            ) : (
              <div key={i} className="text-gray-700">
                {b.text}
              </div>
            ),
          )}
        </div>
      )}

      {free === 0 ? (
        <p className="text-sm text-gray-600">На это время свободных клоузеров нет.</p>
      ) : !p.canBook ? (
        <p className="text-sm text-gray-600">Свободно клоузеров: {free}.</p>
      ) : (
        <BookingForm {...p} free={free} onDone={setDone} />
      )}
    </Modal>
  );
}

function BookingForm(p: Props & { slot: GridSlot; free: number; onDone: (r: Extract<CreateResult, { ok: true }>) => void }) {
  const router = useRouter();
  const [crmUrl, setCrmUrl] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [format, setFormat] = useState<"online" | "offline" | "">("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [comment, setComment] = useState("");
  const [amo, setAmo] = useState<AmoData | null>(null);
  const [amoMsg, setAmoMsg] = useState<string | null>(null);
  const [amoLoading, setAmoLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function lookup(url: string) {
    if (!/^https?:\/\//i.test(url.trim())) return;
    setAmoLoading(true);
    setAmoMsg(null);
    const r = await lookupAmoAction(url);
    setAmoLoading(false);
    if (r.ok) {
      setAmo(r.data);
      if (!name && r.data.contact_name) setName(r.data.contact_name);
      if (!phone && r.data.contact_phone) setPhone(r.data.contact_phone);
    } else {
      setAmo(null);
      setAmoMsg(r.message);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!format) return setErr("Выберите формат встречи");
    setErr(null);
    start(async () => {
      const r = await createBookingAction({
        start: p.slot.start,
        format,
        meetingUrl,
        clientName: name,
        clientPhone: phone,
        crmUrl,
        comment,
      });
      if (r.ok) {
        p.onDone(r);
        router.refresh();
      } else {
        setErr(r.error);
        if (r.refresh) router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-gray-500">Свободно клоузеров: {p.free}. Клоузер будет выбран случайно.</p>

      <label className="block text-sm">
        Ссылка на сделку в CRM *
        <input
          className="input mt-1"
          inputMode="url"
          placeholder="https://….amocrm.ru/leads/detail/…"
          value={crmUrl}
          onChange={(e) => setCrmUrl(e.target.value)}
          onBlur={(e) => lookup(e.target.value)}
          onPaste={(e) => {
            const v = e.clipboardData.getData("text");
            setTimeout(() => lookup(v), 0);
          }}
          required
        />
      </label>
      {amoLoading && <p className="text-xs text-gray-500">Загружаем данные из amoCRM…</p>}
      {amo && <AmoPreview data={amo} />}
      {amoMsg && <p className="text-xs text-amber-700">{amoMsg}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          Имя клиента *
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          Телефон *
          <input
            className="input mt-1"
            type="tel"
            inputMode="tel"
            placeholder="+7 7XX XXX XX XX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>
      </div>

      <div className="text-sm">
        Формат *
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 mt-1">
          {(["online", "offline"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`rounded-md py-1.5 ${format === f ? "bg-white shadow-sm font-medium" : "text-gray-600"}`}
            >
              {f === "online" ? "Онлайн" : "Оффлайн"}
            </button>
          ))}
        </div>
      </div>

      {format === "online" && (
        <label className="block text-sm">
          Ссылка на встречу *
          <input
            className="input mt-1"
            inputMode="url"
            placeholder="https://zoom.us/… или meet.google.com/…"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            required
          />
        </label>
      )}
      {format === "offline" && (
        <div className="text-sm rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
          Адрес: <b>{p.officeAddress}</b>
        </div>
      )}

      <label className="block text-sm">
        Комментарий для клоузера
        <textarea className="input mt-1" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>

      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? "Записываем…" : "Записать клиента"}
      </button>
    </form>
  );
}

export function AmoPreview({ data }: { data: AmoData }) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 space-y-0.5">
      <div className="font-medium">amoCRM: {data.lead_name ?? "сделка"}</div>
      <div className="text-sky-900">
        {[data.status && `${data.pipeline ? data.pipeline + " → " : ""}${data.status}`, data.price ? `${data.price.toLocaleString("ru-RU")} ₸` : null, data.responsible && `отв. ${data.responsible}`]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}
