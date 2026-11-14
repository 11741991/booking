import "server-only";

export type AmoData = {
  lead_name: string | null;
  price: number | null;
  pipeline: string | null;
  status: string | null;
  status_color: string | null;
  responsible: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  fetched_at: string;
};

export type AmoResult =
  | { ok: true; leadId: number; data: AmoData }
  | { ok: false; leadId: number | null; reason: "not_configured" | "bad_link" | "not_found" | "error" };

const LINK_RE = /^https?:\/\/([a-z0-9-]+\.(?:amocrm\.(?:ru|com)|kommo\.com))\/leads\/detail\/(\d+)/i;

export function parseAmoLink(url: string): { host: string; leadId: number } | null {
  const m = url.trim().match(LINK_RE);
  return m ? { host: m[1].toLowerCase(), leadId: Number(m[2]) } : null;
}

export function amoConfigured() {
  return Boolean(process.env.AMO_TOKEN);
}

async function amoGet<T>(host: string, path: string): Promise<T | null> {
  const res = await fetch(`https://${host}/api/v4${path}`, {
    headers: { Authorization: `Bearer ${process.env.AMO_TOKEN}` },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`amo ${res.status}`);
  return (await res.json()) as T;
}

type Lead = {
  id: number;
  name: string;
  price: number;
  status_id: number;
  pipeline_id: number;
  responsible_user_id: number;
  _embedded?: { contacts?: { id: number; is_main: boolean }[] };
};
type Pipeline = { name: string; _embedded: { statuses: { id: number; name: string; color: string }[] } };
type Contact = {
  name: string;
  custom_fields_values: { field_code: string | null; values: { value: string }[] }[] | null;
};

export async function fetchAmoLead(url: string): Promise<AmoResult> {
  const link = parseAmoLink(url);
  if (!link) return { ok: false, leadId: null, reason: "bad_link" };
  if (!amoConfigured()) return { ok: false, leadId: link.leadId, reason: "not_configured" };
  const allowed = process.env.AMO_DOMAIN?.toLowerCase();
  if (allowed && link.host !== allowed) return { ok: false, leadId: link.leadId, reason: "bad_link" };

  try {
    const lead = await amoGet<Lead>(link.host, `/leads/${link.leadId}?with=contacts`);
    if (!lead) return { ok: false, leadId: link.leadId, reason: "not_found" };

    const mainContact = lead._embedded?.contacts?.find((c) => c.is_main) ?? lead._embedded?.contacts?.[0];
    const [pipeline, contact, user] = await Promise.all([
      amoGet<Pipeline>(link.host, `/leads/pipelines/${lead.pipeline_id}`).catch(() => null),
      mainContact ? amoGet<Contact>(link.host, `/contacts/${mainContact.id}`).catch(() => null) : null,
      amoGet<{ name: string }>(link.host, `/users/${lead.responsible_user_id}`).catch(() => null),
    ]);
    const status = pipeline?._embedded.statuses.find((s) => s.id === lead.status_id);
    const phone =
      contact?.custom_fields_values?.find((f) => f.field_code === "PHONE")?.values?.[0]?.value ?? null;

    return {
      ok: true,
      leadId: lead.id,
      data: {
        lead_name: lead.name || null,
        price: lead.price ?? null,
        pipeline: pipeline?.name ?? null,
        status: status?.name ?? null,
        status_color: status?.color ?? null,
        responsible: user?.name ?? null,
        contact_name: contact?.name ?? null,
        contact_phone: phone,
        fetched_at: new Date().toISOString(),
      },
    };
  } catch {
    return { ok: false, leadId: link.leadId, reason: "error" };
  }
}

/* ---------- Передача итога встречи в amoCRM ---------- */

export type AmoSync = {
  ok: boolean;
  at: string;
  /** Что сделано / что не получилось — готовый текст для карточки */
  message: string;
  stage?: boolean;
  closer?: boolean;
  note?: boolean;
};

async function amoSend(host: string, method: "PATCH" | "POST", path: string, body: unknown) {
  const res = await fetch(`https://${host}/api/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.AMO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`amo ${res.status}`);
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

type CustomField = { id: number; name: string; type: string; enums: { id: number; value: string }[] | null };

const DONE_STAGE = "Консультация проведена";

/** Встреча проведена: этап сделки → «Консультация проведена», поле «Клоузер», примечание */
export async function syncAmoDone(input: {
  crmUrl: string;
  closerName: string;
  qualAfter: string | null;
  noteAfter: string | null;
}): Promise<AmoSync> {
  const at = new Date().toISOString();
  const fail = (message: string): AmoSync => ({ ok: false, at, message });

  const link = parseAmoLink(input.crmUrl);
  if (!link) return fail("Ссылка на сделку не из amoCRM — этап не изменён");
  if (!amoConfigured()) return fail("Интеграция с amoCRM ещё не подключена");
  const allowed = process.env.AMO_DOMAIN?.toLowerCase();
  if (allowed && link.host !== allowed) return fail("Ссылка из другого amoCRM-аккаунта");

  try {
    const lead = await amoGet<Lead>(link.host, `/leads/${link.leadId}`);
    if (!lead) return fail("Сделка в amoCRM не найдена");

    const [pipeline, fields] = await Promise.all([
      amoGet<Pipeline>(link.host, `/leads/pipelines/${lead.pipeline_id}`),
      amoGet<{ _embedded: { custom_fields: CustomField[] } }>(link.host, `/leads/custom_fields?limit=250`).catch(
        () => null,
      ),
    ]);

    const problems: string[] = [];
    const patch: Record<string, unknown> = {};

    // 1. Этап
    const statuses = pipeline?._embedded.statuses ?? [];
    const stage =
      statuses.find((s) => norm(s.name) === norm(DONE_STAGE)) ??
      statuses.find((s) => norm(s.name).includes("консультац") && norm(s.name).includes("проведен"));
    if (stage) {
      patch.status_id = stage.id;
      patch.pipeline_id = lead.pipeline_id;
    } else {
      problems.push(`в воронке «${pipeline?.name ?? "?"}» нет этапа «${DONE_STAGE}»`);
    }

    // 2. Поле «Клоузер»
    let closerSet = false;
    const field = fields?._embedded.custom_fields.find((f) => norm(f.name) === "клоузер");
    if (!field) {
      problems.push("в сделках нет поля «Клоузер»");
    } else if (field.enums?.length) {
      const want = norm(input.closerName);
      const en =
        field.enums.find((e) => norm(e.value) === want) ??
        field.enums.find((e) => norm(e.value).includes(want) || want.includes(norm(e.value)));
      if (en) {
        patch.custom_fields_values = [{ field_id: field.id, values: [{ enum_id: en.id }] }];
        closerSet = true;
      } else {
        problems.push(`в списке поля «Клоузер» нет варианта «${input.closerName}»`);
      }
    } else {
      patch.custom_fields_values = [{ field_id: field.id, values: [{ value: input.closerName }] }];
      closerSet = true;
    }

    if (Object.keys(patch).length) await amoSend(link.host, "PATCH", `/leads/${lead.id}`, patch);

    // 3. Примечание
    const text = [
      "Букинг: встреча проведена",
      `Клоузер: ${input.closerName}`,
      input.qualAfter ? `Квал после встречи: ${input.qualAfter}` : null,
      input.noteAfter ? `Примечание после встречи: ${input.noteAfter}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    let noteOk = true;
    try {
      await amoSend(link.host, "POST", `/leads/${lead.id}/notes`, [{ note_type: "common", params: { text } }]);
    } catch {
      noteOk = false;
      problems.push("не удалось добавить примечание");
    }

    const did = [
      stage ? `этап → «${stage.name}»` : null,
      closerSet ? "поле «Клоузер» заполнено" : null,
      noteOk ? "примечание добавлено" : null,
    ].filter(Boolean);
    return {
      ok: problems.length === 0,
      at,
      stage: Boolean(stage),
      closer: closerSet,
      note: noteOk,
      message: [did.join(", "), problems.length ? `Не получилось: ${problems.join("; ")}` : null]
        .filter(Boolean)
        .join(". "),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/amo 40[13]/.test(msg)) return fail("amoCRM отклонил запрос: у токена нет прав на изменение сделок");
    return fail("amoCRM не ответил — попробуйте «Повторить» позже");
  }
}
