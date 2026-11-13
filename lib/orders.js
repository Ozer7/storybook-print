// ---------------------------------------------------------------------------
// Printed copies. The order of things is the point:
//
//   1. The reader opens the PDF and approves it. The approval is tied to the
//      book's exact content (a hash of every picture, every word placement and
//      the About Me), so nothing that wasn't approved can be printed.
//   2. The reader types the delivery address and sees the price.
//   3. Placing the order charges the balance and creates the Lulu print job in
//      one step; if Lulu says no, the money goes straight back.
//
// Lulu downloads the PDFs from /print-files/<token>/..., a link that only this
// order knows. They're rebuilt from the database on request, like the reader's
// PDF, so a restart in between loses nothing.
// ---------------------------------------------------------------------------
import crypto from "node:crypto";
import * as db from "./db.js";
import * as lulu from "./lulu.js";
import { log } from "./log.js";
import { interiorPageCount } from "./pdf.js";
import { checkChild } from "./moderate.js";

export const PRINT_CENTS = Number(process.env.PRINT_CENTS) || 2499;
// Stripe takes 2.9% + $0.30 of the money that comes in (sandbox or not, this is the real rate).
export const stripeFee = (cents) => Math.round(cents * 0.029 + 30) / 100;
const LAYOUT_VERSION = 2; // bump when the printed layout changes, so old approvals don't carry over
const DONE = new Set(["SHIPPED", "CANCELED", "REJECTED", "FAILED"]);

function httpError(status, message, extra = {}) { return Object.assign(new Error(message), { status, expose: true, ...extra }); }

export async function migrate() {
  await db.q(`
    ALTER TABLE books ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS print_approvals (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL, approved_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (book_id));
    CREATE TABLE IF NOT EXISTS print_orders (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER REFERENCES books(id) ON DELETE SET NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'placing', content_hash TEXT NOT NULL, files_token TEXT UNIQUE NOT NULL,
      pod TEXT NOT NULL, page_count INTEGER NOT NULL, cover_w NUMERIC, cover_h NUMERIC,
      address JSONB NOT NULL, shipping TEXT NOT NULL, price_cents INTEGER NOT NULL, quote JSONB,
      lulu_job_id TEXT, lulu_status TEXT, lulu_message TEXT, tracking JSONB, error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS print_orders_user ON print_orders(user_id, id DESC);
  `);
}

/** What the reader approves: everything that ends up on paper. */
export function contentHash(book) {
  const pages = (book.pages || []).map((p) => [p.n, p.image, p.place]);
  const { name, age, likes, food, growUp, more, pronoun } = book.child || {};
  return crypto.createHash("sha256").update(JSON.stringify({ v: LAYOUT_VERSION, id: book.id, story: book.story, portrait: book.portrait_id, child: { name, age, likes, food, growUp, more, pronoun }, pages })).digest("hex").slice(0, 32);
}

export async function approval(userId, book) {
  const { rows } = await db.q(`SELECT content_hash, approved_at FROM print_approvals WHERE book_id=$1 AND user_id=$2`, [book.id, userId]);
  const r = rows[0];
  return r && r.content_hash === contentHash(book) ? { approvedAt: r.approved_at } : null;
}

/** Before a book can be approved, its details must pass the checks (books made before the checks existed get them now). */
export async function ensureChecked(userId, book) {
  if (book.checked_at) return;
  const verdict = await checkChild(book.child || {}, { userId });
  if (!verdict.ok) throw httpError(400, `This book can't be printed: ${verdict.message} Make a new book with the details changed.`, { field: verdict.field });
  await db.q(`UPDATE books SET checked_at=now() WHERE id=$1`, [book.id]);
}

export async function approve(userId, book, seenHash) {
  if (book.status !== "done") throw httpError(409, "This book isn't finished yet.");
  const hash = contentHash(book);
  if (seenHash && seenHash !== hash) throw httpError(409, "The book changed since you opened it. Open the PDF again and check it.");
  await ensureChecked(userId, book);
  await db.q(`INSERT INTO print_approvals (user_id, book_id, content_hash) VALUES ($1,$2,$3)
    ON CONFLICT (book_id) DO UPDATE SET content_hash=$3, approved_at=now()`, [userId, book.id, hash]);
  log.info({ event: "print.approved", book: book.id, user: userId }, "PDF approved for print");
  return { approvedAt: new Date().toISOString(), hash };
}

const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
export function cleanAddress(raw = {}) {
  const s = (k, max) => String(raw[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const a = { name: s("name", 35), street1: s("street1", 35), street2: s("street2", 35), city: s("city", 35), state: s("state", 2).toUpperCase(), zip: s("zip", 10), phone: s("phone", 20), email: s("email", 80) };
  const bad = (field, message) => httpError(400, message, { field });
  if (a.name.length < 2) throw bad("name", "Type the name of the person the book goes to.");
  if (!/\d/.test(a.street1) || a.street1.length < 4) throw bad("street1", "Type the street address, with the house number.");
  if (a.city.length < 2) throw bad("city", "Type the city or town.");
  if (!STATES.has(a.state)) throw bad("state", "Pick the state. We only ship within the US for now.");
  if (!/^\d{5}(-\d{4})?$/.test(a.zip)) throw bad("zip", "The ZIP code should be 5 digits (or ZIP+4).");
  const digits = a.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) throw bad("phone", "Type a 10-digit phone number. The carrier only uses it if there's a problem with delivery.");
  if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) throw bad("email", "That email address doesn't look right.");
  return a;
}
const cleanShipping = (s) => (lulu.SHIPPING[s] ? s : "MAIL");

/** Our price, Lulu's cost for this address, and the margin. */
export async function priceFor({ book, address, shipping }) {
  const pageCount = interiorPageCount(book.pages);
  const q = await lulu.quote({ pageCount, address, shipping: cleanShipping(shipping) });
  const price = PRINT_CENTS; // one price, standard shipping included
  const stripe = stripeFee(price);
  return { price, pageCount, quote: q, stripe, margin: Math.round((price / 100 - q.total - stripe) * 100) / 100 };
}

/** Place the order: charge, record, send to Lulu. Refund if Lulu refuses. */
export async function placeOrder({ userId, email, book, rawAddress, shipping, origin, seenPrice, title }) {
  if (!lulu.configured()) throw httpError(503, "Printing isn't set up on this server yet.");
  if (book.status !== "done") throw httpError(409, "This book isn't finished yet.");
  if (!(await approval(userId, book))) throw httpError(409, "Approve the PDF first. Nothing is sent to the printer until you've checked it.");
  await ensureChecked(userId, book);
  const address = cleanAddress({ email, ...rawAddress });
  shipping = cleanShipping(shipping);
  const { price, pageCount, quote } = await priceFor({ book, address, shipping });
  if (seenPrice != null && Number(seenPrice) !== price) throw httpError(409, `The price changed to $${(price / 100).toFixed(2)}. Check it and place the order again.`);
  const dims = await lulu.coverDimensions(pageCount);
  const token = crypto.randomBytes(24).toString("base64url");

  const order = await db.tx(async (c) => {
    await c.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    const bal = Number((await c.query(`SELECT COALESCE(SUM(cents),0) AS b FROM ledger WHERE user_id=$1`, [userId])).rows[0].b);
    if (bal < price) throw httpError(402, `A printed copy is $${(price / 100).toFixed(2)} and your balance is $${(bal / 100).toFixed(2)}, so nothing was charged. Add money in your purse, then try again.`);
    const { rows } = await c.query(
      `INSERT INTO print_orders (user_id, book_id, title, content_hash, files_token, pod, page_count, cover_w, cover_h, address, shipping, price_cents, quote)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [userId, book.id, title, contentHash(book), token, lulu.POD, pageCount, dims.width, dims.height, address, shipping, price, quote]);
    await c.query(`INSERT INTO ledger (user_id, cents, kind, cause, book_id, unique_ref) VALUES ($1,$2,'print',$3,$4,$5)`,
      [userId, -price, `Printed copy of ${title}, order #${rows[0].id}`, book.id, `print:${rows[0].id}`]);
    return rows[0];
  });
  log.info({ event: "print.charged", order: order.id, book: book.id, user: userId, cents: price }, "print order charged");

  try {
    const job = await lulu.createJob({
      externalId: `storybook-${order.id}`, title, email: address.email || email, address, shipping,
      coverUrl: `${origin}/print-files/${token}/cover.pdf`, interiorUrl: `${origin}/print-files/${token}/interior.pdf`,
    });
    await db.q(`UPDATE print_orders SET status='sent', lulu_job_id=$2, lulu_status=$3, lulu_message=$4, updated_at=now() WHERE id=$1`,
      [order.id, String(job.id), job.status?.name || "CREATED", job.status?.message || null]);
    log.info({ event: "print.sent", order: order.id, job: job.id, status: job.status?.name }, "print job created at Lulu");
  } catch (err) {
    await refundOrder(order, `Lulu didn't take the order, so the money is back in your balance`, err.message);
    throw httpError(err.status === 400 ? 400 : 502, `${err.message}. Nothing was charged: the money is back in your balance.`);
  }
  return getOrder(userId, order.id);
}

async function refundOrder(order, cause, error) {
  await db.tx(async (c) => {
    await c.query(`UPDATE print_orders SET status=$2, error=$3, updated_at=now() WHERE id=$1`, [order.id, error ? "failed" : "canceled", error || null]);
    await c.query(`INSERT INTO ledger (user_id, cents, kind, cause, book_id, unique_ref) VALUES ($1,$2,'print_refund',$3,$4,$5) ON CONFLICT (unique_ref) DO NOTHING`,
      [order.user_id, order.price_cents, `${cause} (order #${order.id})`, order.book_id, `print-refund:${order.id}`]);
  });
  log.info({ event: "print.refunded", order: order.id, error }, "print order refunded");
}

const orderOut = (o) => ({
  id: o.id, bookId: o.book_id, title: o.title, status: o.status, luluJobId: o.lulu_job_id, luluStatus: o.lulu_status, luluMessage: o.lulu_message,
  tracking: o.tracking, error: o.error, price: o.price_cents, shipping: o.shipping, shippingLabel: lulu.SHIPPING[o.shipping],
  address: o.address, quote: o.quote, pages: o.page_count, createdAt: o.created_at, updatedAt: o.updated_at,
  canCancel: o.status === "sent" && ["CREATED", "UNPAID", "PAYMENT_IN_PROGRESS"].includes(o.lulu_status),
  sandbox: true,
});

// Ask Lulu where the job is, at most every 30 seconds per order.
async function refresh(o) {
  if (o.status !== "sent" || !o.lulu_job_id || DONE.has(o.lulu_status) || Date.now() - new Date(o.updated_at).getTime() < 30_000) return o;
  try {
    const job = await lulu.getJob(o.lulu_job_id);
    const li = job.line_items?.[0] || {};
    const tracking = li.tracking_id || li.tracking_urls?.length ? { id: li.tracking_id, urls: li.tracking_urls, carrier: li.carrier_name } : null;
    const { rows } = await db.q(`UPDATE print_orders SET lulu_status=$2, lulu_message=$3, tracking=$4, updated_at=now() WHERE id=$1 RETURNING *`,
      [o.id, job.status?.name || o.lulu_status, [job.status?.message, ...(li.status?.messages ? flat(li.status.messages) : [])].filter(Boolean).join(" ") || null, tracking]);
    if (job.status?.name === "REJECTED" || job.status?.name === "CANCELED") {
      await refundOrder(rows[0], job.status.name === "REJECTED" ? "Lulu rejected the files, money back" : "Order canceled at Lulu, money back", job.status.name === "REJECTED" ? job.status?.message || "rejected" : null);
      return (await db.q(`SELECT * FROM print_orders WHERE id=$1`, [o.id])).rows[0];
    }
    return rows[0];
  } catch (err) {
    log.warn({ order: o.id, err: err.message }, "lulu status refresh failed");
    return o;
  }
}
const flat = (m) => (typeof m === "string" ? [m] : Array.isArray(m) ? m.flatMap(flat) : m && typeof m === "object" ? Object.values(m).flatMap(flat) : []);

export async function listOrders(userId, bookId = null) {
  const { rows } = await db.q(`SELECT * FROM print_orders WHERE user_id=$1 AND ($2::int IS NULL OR book_id=$2) ORDER BY id DESC LIMIT 50`, [userId, bookId]);
  return Promise.all(rows.map(async (o) => orderOut(await refresh(o))));
}

export async function getOrder(userId, id) {
  const { rows } = await db.q(`SELECT * FROM print_orders WHERE id=$1 AND user_id=$2`, [id, userId]);
  if (!rows[0]) throw httpError(404, "That order isn't yours or doesn't exist.");
  return orderOut(await refresh(rows[0]));
}

export async function cancelOrder(userId, id) {
  const { rows } = await db.q(`SELECT * FROM print_orders WHERE id=$1 AND user_id=$2`, [id, userId]);
  const o = rows[0];
  if (!o) throw httpError(404, "That order isn't yours or doesn't exist.");
  if (o.status !== "sent") throw httpError(409, "This order can't be canceled.");
  try { await lulu.cancelJob(o.lulu_job_id); } catch (err) {
    throw httpError(409, `Lulu wouldn't cancel it (${err.message.replace(/^Lulu said: /, "")}). Once a book is in production it can't be stopped.`);
  }
  await db.q(`UPDATE print_orders SET lulu_status='CANCELED', updated_at=now() WHERE id=$1`, [o.id]);
  await refundOrder(o, "Printed copy canceled, money back");
  return getOrder(userId, id);
}

/** For the public file route: the order behind a token, if it's still live. */
export async function orderByToken(token) {
  const { rows } = await db.q(`SELECT * FROM print_orders WHERE files_token=$1`, [token]);
  return rows[0] || null;
}
