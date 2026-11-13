import express from "express";
import multer from "multer";
import compression from "compression";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";
import { log, httpLog } from "./lib/log.js";
import * as db from "./lib/db.js";
import { setupAuth, requireUser, requireAdmin, isAdmin, adminLogin, adminPasswordSet, DEV_LOGIN } from "./lib/auth.js";
import { STORIES, pageWords } from "./lib/stories.js";
import { normalizePhoto, makeThumb, MOCK, BOOK_MODEL } from "./lib/images.js";
import { CHECK_MODEL, PASS_SCORE } from "./lib/vision.js";
import { PRICES_CHECKED } from "./lib/cost.js";
import { ensureArt, status as artStatus, storyReady, artOverview, sceneFor, showcaseFor } from "./lib/pregen.js";
import { startBook, jobFor } from "./lib/pipeline.js";
import { buildBookPdf, buildPrintFiles, PUBLISHER } from "./lib/pdf.js";
import { checkChild } from "./lib/moderate.js";
import * as orders from "./lib/orders.js";
import * as lulu from "./lib/lulu.js";
import { unsupportedChars } from "./lib/layout.js";
import * as wallet from "./lib/wallet.js";

const PORT = process.env.PORT || 3000;
// A safety valve for the shared test card: it's free money, but images aren't free.
const BOOKS_PER_USER_PER_DAY = Number(process.env.BOOKS_PER_USER_PER_DAY) || 10;
const BOOKS_PER_DAY = Number(process.env.BOOKS_PER_DAY) || 60;

await db.migrate();
await orders.migrate();

const app = express();
app.use(compression({ filter: (req, res) => (req.path.endsWith("/events") ? false : compression.filter(req, res)) }));
app.use(httpLog);

// ---------------------------------------------------------------------------
// Public and instant: nothing here touches sessions or waits on the database.
// ---------------------------------------------------------------------------
app.get("/healthz", (_req, res) => res.send(`ok ${(process.env.RENDER_GIT_COMMIT || "").slice(0, 7)}`.trim()));
const require = createRequire(import.meta.url);
for (const [pkg, subset] of [["andika", "latin"], ["fraunces", "latin"], ["noto-sans-hebrew", "hebrew"]]) {
  const dir = path.dirname(require.resolve(`@fontsource/${pkg}/files/${pkg}-${subset}-700-normal.woff2`));
  app.use(`/fonts/${pkg}`, express.static(dir, { maxAge: "30d", immutable: true }));
}
// Pages revalidate, so a deploy shows at once; an unchanged page still answers instantly.
app.use(express.static("public", { index: "index.html", maxAge: 0, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));
app.get("/bible", (_req, res) => res.sendFile(path.resolve("public/bible.html")));
app.get("/privacy", (_req, res) => res.sendFile(path.resolve("public/privacy.html")));
app.get("/terms", (_req, res) => res.sendFile(path.resolve("public/terms.html")));

// The stories, for the page itself. Cover art comes straight from memory.
app.get("/catalog.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json({
    mock: MOCK,
    devLogin: DEV_LOGIN,
    art: { state: artStatus.state, done: artStatus.done, total: artStatus.total },
    stories: Object.values(STORIES).map((s) => {
      // Each story's most recognisable scene on its cover: Jack up the beanstalk, Red meeting the wolf.
      const cover = sceneFor(s.key, s.key === "jack" ? 9 : 6) || sceneFor(s.key, 1), world = sceneFor(s.key, s.key === "jack" ? 10 : 8);
      // A peek inside before buying: a few real pages of the book, with their words.
      const samples = [1, 4, 7, 10, 14, 17, 20].map((n) => {
        const sc = sceneFor(s.key, n), page = s.pages[n - 1];
        return sc ? { n, image: Number(sc.image_id), text: page.title ? s.title : pageWords(page, s.defaultPronoun) } : null;
      }).filter(Boolean);
      return { key: s.key, title: s.title, role: s.role, pronoun: s.defaultPronoun, ready: storyReady(s.key), samples, cover: showcaseFor(s.key) || (cover ? Number(cover.image_id) : null), world: showcaseFor(s.key, "showcase-world") || (world ? Number(world.image_id) : null) };
    }),
  });
});
app.get("/bible.json", async (_req, res) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json(await artOverview()); } catch (err) { sendError(res, err); }
});
const artCache = new Map();
app.get("/art/:id", async (req, res) => {
  try {
    const key = `${req.params.id}:${req.query.thumb ? 1 : 0}`;
    let img = artCache.get(key);
    if (!img) {
      img = await db.readImage(Number(req.params.id), null, !!req.query.thumb);
      if (!img) return res.status(404).end();
      if (req.query.thumb) artCache.set(key, img);
    }
    res.setHeader("Content-Type", req.query.thumb ? "image/jpeg" : img.mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(img.data);
  } catch (err) { sendError(res, err); }
});

// The printer's copy. Lulu downloads these from a link only the order knows, and
// only while the book still matches what the reader approved.
const printCache = new Map();
app.get("/print-files/:token/:kind(interior|cover).pdf", async (req, res) => {
  try {
    const order = await orders.orderByToken(req.params.token);
    if (!order || !order.book_id) return res.status(404).end();
    let files = printCache.get(order.files_token);
    if (!files) {
      const { rows } = await db.q(`SELECT * FROM books WHERE id=$1`, [order.book_id]);
      const b = rows[0];
      if (!b || orders.contentHash(b) !== order.content_hash) return res.status(410).send("This book changed after it was approved.");
      const t = Date.now();
      files = await buildPrintFiles({ story: STORIES[b.story], child: b.child, pages: b.pages, portrait: b.portrait_id, loadImage: (id) => db.imageData(id),
        meta: { bookId: b.id, madeAt: b.finished_at }, cover: { width: Number(order.cover_w), height: Number(order.cover_h) } });
      log.info({ event: "print.files", order: order.id, ms: Date.now() - t, interior: files.interior.length, cover: files.cover.length, pages: files.interiorPages }, "built print files");
      printCache.set(order.files_token, files);
      if (printCache.size > 4) printCache.delete(printCache.keys().next().value);
    }
    log.info({ event: "print.download", order: order.id, kind: req.params.kind, ua: req.get("user-agent") }, "print file fetched");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="order-${order.id}-${req.params.kind}.pdf"`);
    res.send(files[req.params.kind]);
  } catch (err) { sendError(res, err); }
});

// ---------------------------------------------------------------------------
// Signed-in.
// ---------------------------------------------------------------------------
setupAuth(app);
app.use(express.json({ limit: "64kb" }));
// Signed-in only, except "who am I" and the admin pages (which have their own password).
app.use(["/api", "/img"], (req, res, next) => (req.path === "/me" || req.path.startsWith("/admin") || req.path === "/costs" ? next() : requireUser(req, res, next)));

app.get("/api/me", route(async (req) => {
  if (!req.user) return { user: null };
  return { user: req.user, balance: await wallet.balance(req.user.id), bookCents: wallet.BOOK_CENTS, printCents: orders.PRINT_CENTS };
}));

app.get("/img/:id(\\d+)", async (req, res) => {
  try {
    const img = await db.readImage(Number(req.params.id), req.user.id, !!req.query.thumb);
    if (!img) return res.status(404).end();
    res.setHeader("Content-Type", req.query.thumb ? "image/jpeg" : img.mime);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(img.data);
  } catch (err) { sendError(res, err); }
});

// A picture as base64 text, small, for checking a book from a machine whose
// network filter blanks out images of people.
app.get("/img/:id.txt", async (req, res) => {
  try {
    const img = await db.readImage(Number(req.params.id), req.user.id, false);
    if (!img) return res.status(404).end();
    const w = Math.min(1024, Number(req.query.w) || 256);
    const out = await sharp(img.data).resize({ width: w }).jpeg({ quality: Number(req.query.q) || 60 }).toBuffer();
    res.type("text/plain").send(out.toString("base64"));
  } catch (err) { sendError(res, err); }
});

// Money ---------------------------------------------------------------------
app.get("/api/wallet", route(async (req) => {
  await wallet.syncOpenPayments(req.user.id);
  return wallet.history(req.user.id);
}));
app.post("/api/wallet/fund", route(async (req) => wallet.startFunding({
  userId: req.user.id, email: req.user.email, cents: Number(req.body?.cents), origin: `${req.protocol}://${req.get("host")}`,
})));
app.post("/api/wallet/confirm", route(async (req) => ({ credited: await wallet.confirmPayment(req.user.id, String(req.body?.sessionId || "")) })));
app.post("/api/refunds", route(async (req) => wallet.requestRefund({
  userId: req.user.id, paymentId: Number(req.body?.paymentId), cents: req.body?.cents == null ? null : Number(req.body.cents), reason: req.body?.reason,
})));

// Books ---------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    cb(ok ? null : httpError(400, "Please upload a PNG, JPEG or WEBP photo."), ok);
  },
});

const FIELDS = { name: 40, age: 20, likes: 60, food: 60, growUp: 60, more: 300 };
function cleanChild(raw = {}, story) {
  const child = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    let v = String(raw[k] ?? "").trim();
    v = k === "more" ? v.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n") : v.replace(/\s+/g, " ");
    child[k] = v.slice(0, max);
  }
  if (!child.name) throw httpError(400, "Type a name for the cover and the About Me page.", { field: "name" });
  // NAME IN CAPITALS prints as Name In Capitals.
  if (/^[A-Z'’\-. ]{3,}$/.test(child.name)) child.name = child.name.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  const bad = unsupportedChars(Object.values(child).join(""));
  if (bad.length) throw httpError(400, `The book's font can't print ${bad.slice(0, 6).join(" ")} yet. Please use English or Hebrew letters.`);
  child.pronoun = ["he", "she"].includes(raw.pronoun) ? raw.pronoun : story.defaultPronoun;
  return child;
}

// Books made before "kept" was stored: the kept try is the best-scored one.
const keptOf = (p) => (p.attempts || []).filter((a) => a.score != null).sort((a, b) => b.score - a.score)[0]?.attempt ?? null;
const bookOut = (b) => ({
  id: b.id, story: b.story, title: STORIES[b.story]?.title, status: b.status, child: b.child, error: b.error, timing: b.timing,
  createdAt: b.created_at, finishedAt: b.finished_at, portrait: b.portrait_id ? Number(b.portrait_id) : null, photo: b.photo_id ? Number(b.photo_id) : null,
  pages: (b.pages || []).map((p) => ({ n: p.n, url: `${p.shared ? "/art" : "/img"}/${p.image}`, text: p.text, place: p.place, score: p.score, attempts: p.attempts, kept: p.kept ?? keptOf(p), passed: p.score != null && p.score >= PASS_SCORE, ahead: !!p.ahead || !!p.shared, standIn: p.standIn })),
});

app.get("/api/books", route(async (req) => ({ books: (await db.listBooks(req.user.id)).map(bookOut) })));

// What a book costs to make, next to what we charge for it.
app.get("/api/costs", requireAdmin, route(async (req) => ({ price: wallet.BOOK_CENTS / 100, pricesChecked: PRICES_CHECKED, models: { pages: BOOK_MODEL, checks: CHECK_MODEL }, ...(await db.costSummary(req.user.id)) })));

app.post("/api/books", upload.single("photo"), route(async (req) => {
  const story = STORIES[req.body.story];
  if (!story) throw httpError(400, "Pick a story.");
  if (!storyReady(story.key)) throw httpError(503, "This story's pictures are still being painted. Try again in a few minutes.");
  // "Use my last photo" reuses the stored picture, so nothing has to be uploaded again.
  let lastPhoto = null;
  if (!req.file && req.body.samePhoto) {
    const { rows } = await db.q(`SELECT photo_id FROM books WHERE user_id=$1 AND photo_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [req.user.id]);
    if (rows[0]) lastPhoto = await db.imageData(rows[0].photo_id);
  }
  if (!req.file && !lastPhoto) throw httpError(400, "Add a photo first.");
  const child = cleanChild(req.body, story);
  // Everything typed here gets printed, so it's checked before anything is charged.
  let verdict;
  try { verdict = await checkChild(child, { userId: req.user.id }); } catch (err) {
    log.error({ err: err.message }, "child check failed");
    throw httpError(503, "We couldn't check the details just now, so nothing was charged. Try again in a minute.");
  }
  if (!verdict.ok) throw httpError(400, verdict.message, { field: verdict.field });

  const counts = (await db.q(`SELECT count(*) FILTER (WHERE user_id=$1)::int AS mine, count(*)::int AS everyone FROM books WHERE created_at > now() - interval '24 hours'`, [req.user.id])).rows[0];
  if (counts.mine >= BOOKS_PER_USER_PER_DAY) throw httpError(429, `That's ${BOOKS_PER_USER_PER_DAY} books today, the limit for one account. Try again tomorrow.`);
  if (counts.everyone >= BOOKS_PER_DAY) throw httpError(429, "The site has made all its books for today. Try again tomorrow.");

  const photo = lastPhoto || (await normalizePhoto(req.file.buffer));
  const book = await wallet.chargeForBook({ userId: req.user.id, story: story.key, storyTitle: story.title, child });
  const photoId = await db.saveImage({ userId: req.user.id, bookId: book.id, kind: "photo", buf: photo, thumb: await makeThumb(photo) });
  await db.q(`UPDATE books SET photo_id=$2, checked_at=now() WHERE id=$1`, [book.id, photoId]);
  log.info({ event: "book.start", book: book.id, user: req.user.id, story: story.key }, "book started");
  startBook({ book, photo, userId: req.user.id });
  return { id: book.id };
}));

app.get("/api/books/:id", route(async (req) => {
  const b = await db.getBook(req.user.id, Number(req.params.id));
  if (!b) throw httpError(404, "That book isn't yours or doesn't exist.");
  return { book: bookOut(b) };
}));

const pdfCache = new Map();

// Deleting takes the book's photo and pictures with it. The ledger keeps its line.
app.delete("/api/books/:id", route(async (req) => {
  const b = await db.getBook(req.user.id, Number(req.params.id));
  if (!b) throw httpError(404, "That book isn't yours or doesn't exist.");
  if (b.status === "running") throw httpError(409, "This book is still being painted.");
  await db.q(`DELETE FROM books WHERE id=$1 AND user_id=$2`, [b.id, req.user.id]);
  pdfCache.delete(b.id);
  log.info({ event: "book.delete", book: b.id, user: req.user.id }, "book deleted");
  return { ok: true };
}));

// Live progress, as server-sent events.
app.get("/api/books/:id/events", async (req, res) => {
  const b = await db.getBook(req.user.id, Number(req.params.id));
  if (!b) return res.status(404).end();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const job = jobFor(b.id);
  if (!job) { send({ stage: b.status === "done" ? "done" : b.status === "failed" ? "failed" : "lost", label: b.error || "", percent: 100, thumbs: [] }); return res.end(); }
  const onUpdate = (s) => { send(s); if (s.stage === "done" || s.stage === "failed") res.end(); };
  job.events.on("update", onUpdate);
  const ping = setInterval(() => res.write(": ping\n\n"), 10_000);
  req.on("close", () => { clearInterval(ping); job.events.off("update", onUpdate); });
  send(job.snapshot);
});

// The PDF, rebuilt on demand from the pictures in the database, so it's still
// here tomorrow. The last few are kept in memory so a second click is instant.
app.get("/api/books/:id/pdf", async (req, res) => {
  try {
    const b = await db.getBook(req.user.id, Number(req.params.id));
    if (!b) throw httpError(404, "That book isn't yours or doesn't exist.");
    if (b.status !== "done") throw httpError(409, "This book isn't finished.");
    let pdf = pdfCache.get(b.id);
    if (!pdf) {
      const t = Date.now();
      pdf = await buildBookPdf({ story: STORIES[b.story], child: b.child, pages: b.pages, portrait: b.portrait_id, loadImage: (id) => db.imageData(id), meta: { bookId: b.id, madeAt: b.finished_at } });
      log.info({ event: "pdf", book: b.id, ms: Date.now() - t, bytes: pdf.length }, "built PDF");
      pdfCache.set(b.id, pdf);
      if (pdfCache.size > 3) pdfCache.delete(pdfCache.keys().next().value);
    }
    const slug = String(b.child.name || "book").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${req.query.inline ? "inline" : "attachment"}; filename="${b.story === "jack" ? "jack-and-the-beanstalk" : "little-red-riding-hood"}-${slug}.pdf"`);
    res.send(pdf);
  } catch (err) { sendError(res, err); }
});

// Printed copies -------------------------------------------------------------
async function ownBook(req) {
  const b = await db.getBook(req.user.id, Number(req.params.id));
  if (!b) throw httpError(404, "That book isn't yours or doesn't exist.");
  return b;
}
const titleOf = (b) => `${STORIES[b.story]?.title}, starring ${b.child?.name}`;

app.get("/api/books/:id/print", route(async (req) => {
  const b = await ownBook(req);
  return {
    ready: b.status === "done", configured: lulu.configured(), hash: orders.contentHash(b),
    approval: await orders.approval(req.user.id, b), price: orders.PRINT_CENTS, product: lulu.POD_LABEL,
    publisher: PUBLISHER, email: req.user.email, orders: await orders.listOrders(req.user.id, b.id),
  };
}));
app.post("/api/books/:id/approve", route(async (req) => orders.approve(req.user.id, await ownBook(req), req.body?.hash ? String(req.body.hash) : null)));
app.post("/api/books/:id/quote", route(async (req) => {
  const b = await ownBook(req);
  const address = orders.cleanAddress({ email: req.user.email, ...(req.body?.address || {}) });
  const p = await orders.priceFor({ book: b, address, shipping: req.body?.shipping });
  // What it costs us and the margin are the owner's business, not the customer's.
  return isAdmin(req) ? { address, ...p } : { address, price: p.price, pageCount: p.pageCount };
}));
app.post("/api/books/:id/orders", route(async (req) => {
  const b = await ownBook(req);
  return orders.placeOrder({ userId: req.user.id, email: req.user.email, book: b, rawAddress: req.body?.address || {}, shipping: req.body?.shipping,
    origin: process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`, seenPrice: req.body?.price, title: titleOf(b) });
}));
app.get("/api/orders", route(async (req) => ({ orders: await orders.listOrders(req.user.id) })));
app.get("/api/orders/:id", route(async (req) => ({ order: await orders.getOrder(req.user.id, Number(req.params.id)) })));
app.post("/api/orders/:id/cancel", route(async (req) => ({ order: await orders.cancelOrder(req.user.id, Number(req.params.id)) })));
// The owner's pages ------------------------------------------------------------
app.get("/api/print/ping", requireAdmin, route(async () => lulu.ping()));
app.get("/api/admin/status", (req, res) => res.json({ admin: isAdmin(req), passwordSet: adminPasswordSet() }));
app.post("/api/admin/login", (req, res) => {
  const r = adminLogin(req);
  log.info({ event: r.ok ? "admin.unlocked" : "admin.refused", ip: req.ip, status: r.status }, "admin password");
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  req.session.save(() => res.json({ admin: true }));
});
app.post("/api/admin/logout", (req, res) => { if (req.session) req.session.adminUnlocked = false; res.json({ admin: false }); });
app.get("/api/admin/summary", requireAdmin, route(async () => ({
  ...(await orders.adminSummary()),
  costs: { price: wallet.BOOK_CENTS / 100, pricesChecked: PRICES_CHECKED, models: { pages: BOOK_MODEL, checks: CHECK_MODEL }, ...(await db.costSummary(null)) },
  printer: { base: lulu.LULU_BASE, pod: lulu.POD, product: lulu.POD_LABEL, configured: lulu.configured(), mock: lulu.MOCK },
})));

app.use((err, _req, res, _next) => sendError(res, err));

// A restart in the middle of a book: the reader isn't charged for it.
const { rows: stranded } = await db.q(`UPDATE books SET status='failed', error='The server restarted while this book was being made. You were not charged.', finished_at=now() WHERE status='running' RETURNING id, user_id`);
for (const b of stranded) await wallet.refundFailedBook({ userId: b.user_id, bookId: b.id }).catch((err) => log.error({ err: err.message }, "refund failed"));

app.listen(PORT, () => log.info({ port: PORT, mock: MOCK }, "Storybook is up"));
ensureArt();

// ---------------------------------------------------------------------------
function route(fn) {
  return async (req, res) => {
    try { res.json(await fn(req)); } catch (err) { sendError(res, err); }
  };
}
function sendError(res, err) {
  if (res.headersSent) return res.end();
  if (err.expose) return res.status(err.status).json({ error: err.message, ...(err.field ? { field: err.field } : {}) });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  log.error({ err: err.message, status: err.status }, "request failed");
  res.status(500).json({ error: "Something went wrong on the server. Try again." });
}
function httpError(status, message, extra = {}) { return Object.assign(new Error(message), { status, expose: true, ...extra }); }
