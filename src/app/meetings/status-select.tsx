"use client";
import { useState, useTransition } from "react";
import { RESULT_STATUSES, STATUS_LABELS, STATUS_STYLES, type BookingStatus } from "@/lib/labels";
import { setStatusAction } from "@/app/bookings/actions";
import { ResultDialog } from "@/components/result-dialog";

/** Быстрая смена статуса прямо в списке встреч */
export function StatusSelect({
  id,
  status,
  options,
  qualAfter,
  noteAfter,
}: {
  id: string;
  status: BookingStatus;
  options: BookingStatus[];
  qualAfter: string | null;
  noteAfter: string | null;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BookingStatus | null>(null);
  if (!options.length) {
    return (
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}>
        {STATUS_LABELS[status]}
      </span>
    );
  }
  return (
    <span className="shrink-0 flex flex-col items-end">
      <select
        aria-label="Статус встречи"
        disabled={pending}
        value={status}
        onChange={(e) => {
          const v = e.target.value as BookingStatus;
          setErr(null);
          if (RESULT_STATUSES.includes(v)) return setResult(v); // итог — через окно с квалом и примечанием
          start(async () => {
            const r = await setStatusAction(id, v);
            if (r.error) setErr(r.error);
          });
        }}
        className={`rounded-full border px-2 py-0.5 text-xs cursor-pointer ${STATUS_STYLES[status]} ${pending ? "opacity-50" : ""}`}
      >
        <option value={status}>{STATUS_LABELS[status]}</option>
        {options
          .filter((o) => o !== status)
          .map((o) => (
            <option key={o} value={o}>
              {STATUS_LABELS[o]}
            </option>
          ))}
      </select>
      {err && <span className="text-[10px] text-red-600 max-w-40 text-right">{err}</span>}
      {result && (
        <ResultDialog id={id} status={result} initialQual={qualAfter} initialNote={noteAfter} onClose={() => setResult(null)} />
      )}
    </span>
  );
}
