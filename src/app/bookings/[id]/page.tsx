import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/schedule";
import {
  FORMAT_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  formatPhone,
  formatSlot,
  type BookingFormat,
  type BookingStatus,
} from "@/lib/labels";
import type { AmoData } from "@/lib/amo";
import { RefreshAmo, EditBooking } from "./card-actions";

type BookingRow = {
  id: string;
  hunter_id: string;
  closer_id: string;
  starts_at: string;
  ends_at: string;
  format: BookingFormat;
  meeting_url: string | null;
  address: string | null;
  client_name: string;
  client_phone: string;
  crm_url: string;
  comment: string | null;
  status: BookingStatus;
  amo_data: AmoData | null;
  created_at: string;
  hunter: { name: string; email: string } | null;
  closer: { name: string; email: string } | null;
};

export default async function BookingPage(props: PageProps<"/bookings/[id]">) {
  const me = await requireUser();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "*, hunter:users!bookings_hunter_id_fkey(name,email), closer:users!bookings_closer_id_fkey(name,email)",
      )
      .eq("id", id)
      .maybeSingle(),
    getSettings(),
  ]);
  const b = data as BookingRow | null;
  if (!b) notFound();

  const tz = settings.timezone;
  const endTime = formatSlot(b.ends_at, tz).split(", ").pop();
  const canEdit = b.hunter_id === me.id && b.status === "scheduled" && new Date(b.starts_at) > new Date();

  return (
    <AppShell user={me}>
      <Link href="/meetings" className="text-sm text-gray-500 hover:text-gray-800">
        ← Встречи
      </Link>

      <div className="mt-2 grid gap-4 md:grid-cols-[1fr_320px]">
        <div className="card space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-gray-500">Встреча</div>
              <h1 className="text-xl font-semibold">{b.client_name}</h1>
              <div className="text-sm text-gray-700 mt-0.5">
                {formatSlot(b.starts_at, tz)}–{endTime}
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[b.status]}`}>
              {STATUS_LABELS[b.status]}
            </span>
          </div>

          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 text-sm">
            <dt className="text-gray-500">Клоузер</dt>
            <dd className="font-medium">{b.closer?.name ?? "—"}</dd>
            <dt className="text-gray-500">Хантер</dt>
            <dd className="font-medium">{b.hunter?.name ?? "—"}</dd>
            <dt className="text-gray-500">Телефон</dt>
            <dd>
              <a className="underline underline-offset-2" href={`tel:${b.client_phone}`}>
                {formatPhone(b.client_phone)}
              </a>
            </dd>
            <dt className="text-gray-500">Формат</dt>
            <dd>{FORMAT_LABELS[b.format]}</dd>
            {b.format === "online" ? (
              <>
                <dt className="text-gray-500">Ссылка</dt>
                <dd className="break-all">
                  <a className="underline underline-offset-2 text-sky-700" href={b.meeting_url ?? "#"} target="_blank" rel="noreferrer">
                    {b.meeting_url}
                  </a>
                </dd>
              </>
            ) : (
              <>
                <dt className="text-gray-500">Адрес</dt>
                <dd>{b.address}</dd>
              </>
            )}
            <dt className="text-gray-500">Сделка в CRM</dt>
            <dd className="break-all">
              <a className="underline underline-offset-2 text-sky-700" href={b.crm_url} target="_blank" rel="noreferrer">
                {b.crm_url}
              </a>
            </dd>
            <dt className="text-gray-500">Комментарий</dt>
            <dd className="whitespace-pre-wrap">{b.comment || <span className="text-gray-400">—</span>}</dd>
          </dl>
        </div>

        <div className="space-y-4">
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">amoCRM</h2>
            </div>
            {b.amo_data ? (
              <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-gray-500">Сделка</dt>
                <dd>{b.amo_data.lead_name ?? "—"}</dd>
                <dt className="text-gray-500">Этап</dt>
                <dd>
                  {b.amo_data.status ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-xs"
                      style={{ background: b.amo_data.status_color ?? "#eee" }}
                    >
                      {b.amo_data.status}
                    </span>
                  ) : (
                    "—"
                  )}
                  {b.amo_data.pipeline && <div className="text-xs text-gray-500 mt-0.5">{b.amo_data.pipeline}</div>}
                </dd>
                <dt className="text-gray-500">Бюджет</dt>
                <dd>{b.amo_data.price ? `${b.amo_data.price.toLocaleString("ru-RU")} ₸` : "—"}</dd>
                <dt className="text-gray-500">Ответственный</dt>
                <dd>{b.amo_data.responsible ?? "—"}</dd>
                <dt className="text-gray-500">Контакт</dt>
                <dd>
                  {b.amo_data.contact_name ?? "—"}
                  {b.amo_data.contact_phone && <div className="text-xs text-gray-500">{b.amo_data.contact_phone}</div>}
                </dd>
                <dt className="text-gray-500">Обновлено</dt>
                <dd className="text-xs text-gray-500">{formatSlot(b.amo_data.fetched_at, tz)}</dd>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Данные из amoCRM ещё не загружены.</p>
            )}
            <RefreshAmo id={b.id} crmUrl={b.crm_url} />
          </div>

          {canEdit && (
            <EditBooking
              id={b.id}
              format={b.format}
              meetingUrl={b.meeting_url ?? ""}
              crmUrl={b.crm_url}
              comment={b.comment ?? ""}
            />
          )}

          <p className="text-xs text-gray-400 px-1">Создана: {formatSlot(b.created_at, tz)}</p>
        </div>
      </div>
    </AppShell>
  );
}
