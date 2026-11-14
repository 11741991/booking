"use client";
import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { QUALS, STATUS_LABELS, type BookingStatus } from "@/lib/labels";
import { setStatusAction } from "@/app/bookings/actions";

/** Итог встречи: квал после встречи + примечание. Открывается при смене статуса на итоговый */
export function ResultDialog({
  id,
  status,
  initialQual,
  initialNote,
  onClose,
}: {
  id: string;
  status: BookingStatus;
  initialQual: string | null;
  initialNote: string | null;
  onClose: () => void;
}) {
  const [qual, setQual] = useState(initialQual ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [amo, setAmo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const qualRequired = status === "done" || status === "not_counted";
  const noteRequired = status === "not_counted";
  const ready = (!qualRequired || !!qual) && (!noteRequired || !!note.trim());

  if (amo !== null) {
    return (
      <Modal title={`Статус: ${STATUS_LABELS[status]}`} onClose={onClose}>
        <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-sm text-sky-950">
          <div className="font-medium">amoCRM</div>
          <div>{amo}</div>
        </div>
        <button className="btn-primary w-full" onClick={onClose}>
          Готово
        </button>
      </Modal>
    );
  }

  return (
    <Modal title={`Итог встречи: ${STATUS_LABELS[status]}`} onClose={onClose}>
      <div className="text-sm">
        Квал после встречи {qualRequired ? "*" : <span className="text-gray-400">(необязательно)</span>}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 mt-1">
          {QUALS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQual(qual === q && !qualRequired ? "" : q)}
              className={`rounded-md py-2 ${qual === q ? "bg-white shadow-sm font-semibold" : "text-gray-600"}`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-sm">
        Примечание после встречи {noteRequired ? "*" : <span className="text-gray-400">(необязательно)</span>}
        <textarea
          className="input mt-1"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={noteRequired ? "Почему эксперт не засчитал встречу" : "Как прошла встреча, о чём договорились"}
        />
      </label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        className="btn-primary w-full"
        disabled={pending || !ready}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await setStatusAction(id, status, "", { qualAfter: qual, noteAfter: note });
            if (r.error) setErr(r.error);
            else if (r.amo) setAmo(r.amo);
            else onClose();
          })
        }
      >
        {pending ? "Сохраняем…" : !ready ? (qualRequired && !qual ? "Укажите квал" : "Напишите примечание") : "Сохранить"}
      </button>
    </Modal>
  );
}
