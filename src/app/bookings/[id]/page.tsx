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
import {
  CancelButton,
  EditBooking,
  MeetingResult,
  RefreshAmo,
  RescheduleButton,
  RestoreButton,
  RopEdit,
  StatusPanel,
  TrashButton,
} from "./card-actions";

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
  student_grade: string | null;
  qual: string | null;
  qual_after: string | null;
  note_after: string | null;
  amo_sync: { ok: boolean; message: string } | null;
  deleted_at: string | null;
  rescheduled_from: string | null;
  rescheduled_to: string | null;
  amo_data: AmoData | null;
  created_at: string;
  hunter: { name: string } | null;
  closer: { name: string } | null;
};

type HistoryRow = {
  id: string;
  old_status: BookingStatus | null;
  new_status: BookingStatus;
  changed_at: string;
  note: string | null;
  who: { name: string } | null;
};

export default async function BookingPage(props: PageProps<"/bookings/[id]">) {
  const me = await requireUser();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data }, { data: hist }, settings, { data: closerRows }] = await Promise.all([
    supabase
      .from("bookings")
      .select("*, hunter:users!bookings_hunter_id_fkey(name), closer:users!bookings_closer_id_fkey(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("booking_status_history")
      .select("id,old_status,new_status,changed_at,note,who:users!booking_status_history_changed_by_fkey(name)")
      .eq("booking_id", id)
      .order("changed_at", { ascending: false }),
    getSettings(),
    supabase.from("users").select("id,name").eq("is_active", true).contains("roles", ["closer"]).order("name"),
  ]);
  const b = data as BookingRow | null;
  if (!b) notFound();
  const history = (hist ?? []) as unknown as HistoryRow[];

  const tz = settings.timezone;
  const endTime = formatSlot(b.ends_at, tz).split(", ").pop();
  const isRop = me.roles.includes("rop") || me.roles.includes("admin");
  const isHunterOwner = b.hunter_id === me.id;
  const isCloserOwner = b.closer_id === me.id;
  const started = new Date(b.starts_at) <= new Date();
  const active = b.status === "scheduled" || b.status === "confirmed";
  const deleted = b.deleted_at !== null;
  const canHunterEdit = !deleted && isHunterOwner && active && !started;
  const canReschedule = !deleted && (isRop || isHunterOwner) && ["scheduled", "confirmed", "no_show"].includes(b.status);

  return (
    <AppShell user={me}>
      <Link href="/meetings" className="text-sm text-gray-500 hover:text-gray-800">
        ← Встречи
      </Link>

      {deleted && (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-red-900">
            <b>Встреча в корзине</b> с {formatSlot(b.deleted_at!, tz)}. Она не учитывается в статистике и не занимает
            слот.
          </div>
          <RestoreButton id={b.id} />
        </div>
      )}

      <div className="mt-2 grid gap-4 md:grid-cols-[1fr_320px]">
        <div className="space-y-4">
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

            {b.rescheduled_to && (
              <Link
                href={`/bookings/${b.rescheduled_to}`}
                className="block rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 underline underline-offset-2"
              >
                Встреча перенесена → открыть новую встречу
              </Link>
            )}
            {b.rescheduled_from && (
              <Link
                href={`/bookings/${b.rescheduled_from}`}
                className="block rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700 underline underline-offset-2"
              >
                Создана переносом ← исходная встреча
              </Link>
            )}

            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2.5 text-sm">
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
              <dt className="text-gray-500">Класс</dt>
              <dd>{b.student_grade ?? <span className="text-gray-400">—</span>}</dd>
              <dt className="text-gray-500">Квал</dt>
              <dd>
                {b.qual ?? <span className="text-gray-400">—</span>}
                {b.qual_after && <span className="text-gray-500"> → после встречи: {b.qual_after}</span>}
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

          <div className="card space-y-2">
            <h2 className="font-medium">История</h2>
            <ul className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-gray-500 tabular-nums w-28 shrink-0">{formatSlot(h.changed_at, tz)}</span>
                  <span>
                    {h.old_status ? `${STATUS_LABELS[h.old_status]} → ` : "Создана: "}
                    <b>{STATUS_LABELS[h.new_status]}</b>
                    {h.who?.name && <span className="text-gray-500"> · {h.who.name}</span>}
                    {h.note && <span className="text-gray-500"> · {h.note}</span>}
                  </span>
                </li>
              ))}
              {history.length === 0 && <li className="text-gray-400">Нет записей</li>}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          {!deleted && (
          <StatusPanel
            id={b.id}
            status={b.status}
            perms={{ isRop, isHunterOwner, isCloserOwner, started }}
            qualAfter={b.qual_after}
            noteAfter={b.note_after}
          />
          )}

          {!deleted && (canReschedule || (isRop && b.status !== "cancelled" && b.status !== "rescheduled")) && (
            <div className="space-y-2">
              {canReschedule && (
                <RescheduleButton
                  id={b.id}
                  isRop={isRop}
                  tz={tz}
                  closers={(closerRows ?? []) as { id: string; name: string }[]}
                />
              )}
              {isRop && b.status !== "rescheduled" && (
                <RopEdit
                  id={b.id}
                  closerId={b.closer_id}
                  clientName={b.client_name}
                  clientPhone={b.client_phone}
                  crmUrl={b.crm_url}
                  format={b.format}
                  meetingUrl={b.meeting_url ?? ""}
                  comment={b.comment ?? ""}
                  grade={b.student_grade ?? ""}
                  qual={b.qual ?? ""}
                />
              )}
              {isRop && active && <CancelButton id={b.id} />}
            </div>
          )}

          {canHunterEdit && !isRop && (
            <EditBooking
              id={b.id}
              format={b.format}
              meetingUrl={b.meeting_url ?? ""}
              crmUrl={b.crm_url}
              comment={b.comment ?? ""}
              grade={b.student_grade ?? ""}
              qual={b.qual ?? ""}
            />
          )}

          <MeetingResult
            key={`${b.status}|${b.qual_after}|${b.note_after}`}
            id={b.id}
            status={b.status}
            qual={b.qual_after}
            note={b.note_after}
            canEdit={!deleted && (isRop || isCloserOwner) && b.status !== "rescheduled"}
            amoSync={b.amo_sync}
          />

          <div className="card space-y-2">
            <h2 className="font-medium">amoCRM</h2>
            {b.amo_data ? (
              <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-gray-500">Сделка</dt>
                <dd>{b.amo_data.lead_name ?? "—"}</dd>
                <dt className="text-gray-500">Этап</dt>
                <dd>
                  {b.amo_data.status ? (
                    <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: b.amo_data.status_color ?? "#eee" }}>
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
              </dl>
            ) : (
              <p className="text-sm text-gray-500">Данные из amoCRM ещё не загружены.</p>
            )}
            <RefreshAmo id={b.id} crmUrl={b.crm_url} />
          </div>

          <p className="text-xs text-gray-400 px-1">Создана: {formatSlot(b.created_at, tz)}</p>
          {isRop && !deleted && <TrashButton id={b.id} />}
        </div>
      </div>
    </AppShell>
  );
}
