// ---------------------------------------------------------------------------
// Lulu's Print API, sandbox only. Lulu downloads the two PDFs from our URLs,
// prints a saddle-stitched 6 x 9 in full-colour book and ships it. In the
// sandbox nothing is printed or shipped and no real money moves; the app has no
// way to point at production (there is no setting for it).
//
// Product: 0600X0900FCSTDSS080CW444GXX = 6 x 9 in, full colour, standard
// quality, saddle stitch, 80# coated white paper, gloss cover. Saddle stitch
// takes 4–48 pages in multiples of 4; our interior is 20.
// ---------------------------------------------------------------------------
import { log } from "./log.js";

export const LULU_BASE = "https://api.sandbox.lulu.com";
export const POD = process.env.LULU_POD_PACKAGE_ID || "0600X0900FCSTDSS080CW444GXX";
export const POD_LABEL = "6 × 9 in paperback, full colour, stapled (saddle stitch), gloss cover";
export const SHIPPING = { MAIL: "Standard mail, included" };
export const MOCK = process.env.LULU_MOCK === "1" || (!process.env.LULU_CLIENT_KEY && process.env.MOCK_IMAGES === "1");
export const configured = () => MOCK || !!(process.env.LULU_CLIENT_KEY && process.env.LULU_CLIENT_SECRET);

function httpError(status, message, extra = {}) { return Object.assign(new Error(message), { status, expose: true, ...extra }); }

let token = null;
async function auth() {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const key = process.env.LULU_CLIENT_KEY, secret = process.env.LULU_CLIENT_SECRET;
  if (!key || !secret) throw httpError(503, "Printing isn't set up on this server yet (no Lulu sandbox keys).");
  const res = await fetch(`${LULU_BASE}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    log.error({ status: res.status, data }, "lulu auth failed");
    throw httpError(502, "Lulu's sandbox didn't accept our keys. The site owner needs to check them.");
  }
  token = { value: data.access_token, until: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

// Lulu's errors come nested in many shapes; flatten them into one readable line.
function flatten(x, path = []) {
  if (x == null) return [];
  if (typeof x === "string") return [path.length ? `${path.filter((p) => !/^(detail|errors|\d+)$/.test(p)).join(" ")}: ${x}`.replace(/^: /, "") : x];
  if (Array.isArray(x)) return x.flatMap((v, i) => flatten(v, [...path, String(i)]));
  if (typeof x === "object") return Object.entries(x).flatMap(([k, v]) => flatten(v, [...path, k]));
  return [String(x)];
}

async function call(method, path, body) {
  const res = await fetch(`${LULU_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await auth()}`, "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
  if (!res.ok) {
    const why = flatten(data).slice(0, 4).join("; ").replace(/_/g, " ") || `HTTP ${res.status}`;
    log.warn({ event: "lulu.error", path, status: res.status, data }, "lulu call failed");
    throw httpError(res.status >= 500 ? 502 : 400, `Lulu said: ${why}`, { lulu: data });
  }
  return data;
}

const n = (v) => (v == null ? 0 : Number(v));
const addressOut = (a) => ({
  name: a.name, street1: a.street1, ...(a.street2 ? { street2: a.street2 } : {}), city: a.city, state_code: a.state, postcode: a.zip,
  country_code: "US", phone_number: a.phone, ...(a.email ? { email: a.email } : {}),
});

/** The one-piece cover's size, in points, for this many interior pages. */
export async function coverDimensions(pageCount) {
  if (MOCK) return { width: 2 * 432 + 2 * 9 + 9, height: 666 };
  const d = await call("POST", "/cover-dimensions/", { pod_package_id: POD, interior_page_count: pageCount, unit: "pt" });
  return { width: n(d.width), height: n(d.height) };
}

/** What Lulu would charge us to print and ship one copy to this address. */
export async function quote({ pageCount, address, shipping = "MAIL" }) {
  if (MOCK) return { currency: "USD", book: 4.41, shipping: 4.99, fulfillment: 0.75, fees: 0, tax: 0.71, total: 10.86, mock: true };
  const d = await call("POST", "/print-job-cost-calculations/", {
    line_items: [{ page_count: pageCount, pod_package_id: POD, quantity: 1 }],
    shipping_address: addressOut(address),
    shipping_option: shipping,
  });
  const fees = (d.fees || []).reduce((s, f) => s + n(f.total_cost_excl_tax), 0);
  return {
    currency: d.currency || "USD",
    book: n(d.line_item_costs?.[0]?.total_cost_excl_tax),
    shipping: n(d.shipping_cost?.total_cost_excl_tax),
    fulfillment: n(d.fulfillment_cost?.total_cost_excl_tax),
    fees,
    tax: n(d.total_tax),
    total: n(d.total_cost_incl_tax),
  };
}

/** Place the print job. Lulu fetches the PDFs from the two URLs. */
export async function createJob({ externalId, title, coverUrl, interiorUrl, address, shipping = "MAIL", email }) {
  if (MOCK) return { id: `mock-${externalId}`, status: { name: "CREATED", message: "Mock print job (no Lulu keys)" }, line_items: [{ status: { name: "CREATED" } }] };
  return call("POST", "/print-jobs/", {
    external_id: externalId,
    contact_email: email,
    shipping_level: shipping,
    shipping_address: addressOut(address),
    line_items: [{
      external_id: externalId, title: title.slice(0, 255), quantity: 1,
      printable_normalization: { pod_package_id: POD, cover: { source_url: coverUrl }, interior: { source_url: interiorUrl } },
    }],
  });
}

export async function getJob(id) {
  if (MOCK) return { id, status: { name: "UNPAID", message: "" }, line_items: [{ status: { name: "ACCEPTED" } }] };
  return call("GET", `/print-jobs/${encodeURIComponent(id)}/`);
}

export async function cancelJob(id) {
  if (MOCK) return { name: "CANCELED" };
  return call("PUT", `/print-jobs/${encodeURIComponent(id)}/status/`, { name: "CANCELED" });
}

/** Can we reach the sandbox with our keys? For the setup check. */
export async function ping() {
  const dims = await coverDimensions(20);
  return { base: LULU_BASE, pod: POD, cover20: dims };
}
