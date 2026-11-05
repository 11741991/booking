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
