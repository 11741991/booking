"use client";
import { useState, useTransition } from "react";
import { refreshAmoAction, updateMyBookingAction } from "../actions";

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

export function EditBooking(p: { id: string; format: "online" | "offline"; meetingUrl: string; crmUrl: string; comment: string }) {
  const [open, setOpen] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState(p.meetingUrl);
  const [crmUrl, setCrmUrl] = useState(p.crmUrl);
  const [comment, setComment] = useState(p.comment);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button className="btn-secondary w-full" onClick={() => setOpen(true)}>
        Изменить ссылки и комментарий
      </button>
    );
  }

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await updateMyBookingAction({ id: p.id, meetingUrl, crmUrl, comment });
          if (r.error) setErr(r.error);
          else setOpen(false);
        });
      }}
    >
      <h2 className="font-medium">Изменить бронь</h2>
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
      <p className="text-xs text-gray-500">Отменить или перенести встречу может только РОП.</p>
    </form>
  );
}

