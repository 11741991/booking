"use client";
import { useState, useTransition } from "react";
import { STATUS_LABELS, STATUS_STYLES, type BookingStatus } from "@/lib/labels";
import { setStatusAction } from "@/app/bookings/actions";

/** Быстрая смена статуса прямо в списке встреч */
export function StatusSelect({
  id,
  status,
  options,
}: {
  id: string;
  status: BookingStatus;
  options: BookingStatus[];
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
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
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value as BookingStatus;
          setErr(null);
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
    </span>
  );
}
