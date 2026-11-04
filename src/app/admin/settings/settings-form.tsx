"use client";
import { useActionState } from "react";
import { saveSettings } from "./actions";

type Values = {
  work_start_hour: number;
  work_end_hour: number;
  slot_minutes: number;
  booking_horizon_days: number;
  office_address: string;
  timezone: string;
};

export function SettingsForm({ values }: { values: Values }) {
  const [state, action, pending] = useActionState<{ error?: string; ok?: boolean } | null, FormData>(
    saveSettings,
    null,
  );
  return (
    <form action={action} className="card space-y-4 max-w-lg">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Начало работы (час)
          <input name="work_start_hour" type="number" min={0} max={23} defaultValue={values.work_start_hour} className="input mt-1" />
        </label>
        <label className="text-sm">
          Конец работы (час)
          <input name="work_end_hour" type="number" min={1} max={24} defaultValue={values.work_end_hour} className="input mt-1" />
        </label>
        <label className="text-sm">
          Длительность встречи (мин)
          <select name="slot_minutes" defaultValue={values.slot_minutes} className="input mt-1">
            <option value={30}>30</option>
            <option value={60}>60</option>
            <option value={90}>90</option>
            <option value={120}>120</option>
          </select>
        </label>
        <label className="text-sm">
          Горизонт брони (дней)
          <input name="booking_horizon_days" type="number" min={1} max={30} defaultValue={values.booking_horizon_days} className="input mt-1" />
        </label>
      </div>
      <label className="text-sm block">
        Адрес офиса (для оффлайн-встреч)
        <input name="office_address" defaultValue={values.office_address} className="input mt-1" />
      </label>
      <p className="text-xs text-gray-500">Часовой пояс: {values.timezone} (GMT+5)</p>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">Сохранено</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}
