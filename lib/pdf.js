// ---------------------------------------------------------------------------
// The PDFs. The model never draws words: they are set here in a real font, at the
// place layout.js solved for, so they're spelled right and clear of every face.
//
// One book, laid out like a real one:
//   front cover     page 1's art, the title, "starring" the child
//   inside page     copyright notice and publisher
//   story           pages 2 to 20, starting on the page after the copyright page
//   back cover      About Me
//
// buildBookPdf   the reader's PDF: those 22 pages in order, at the 6 x 9 in trim.
// buildPrintFiles what the printer gets: an interior PDF (inside page + story,
//                 with 0.125 in bleed) and a one-piece cover (back, spine, front).
// Every page is drawn by the same functions, so print and screen can't drift apart.
// ---------------------------------------------------------------------------
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PAGE_W, PAGE_H, FONT_BYTES, bodyWidth, wrap, balanced, visualRuns, hasHebrew } from "./layout.js";

const INK = rgb(0.106, 0.165, 0.255);
const PAPER = rgb(1, 0.985, 0.945);
const MUTED = rgb(0.34, 0.39, 0.46);
const GOLD = rgb(0.91, 0.7, 0.23);
const ACCENT = { jack: rgb(0.13, 0.42, 0.26), red: rgb(0.72, 0.15, 0.2) };

export const BLEED = 9; // 0.125 in, in points
export const PUBLISHER = process.env.PUBLISHER || "Bluebid Books";
export const PUBLISHER_SITE = process.env.PUBLISHER_SITE || "bluebid.online";

const TALE = {
  jack: "Retold from the traditional English fairy tale.",
  red: "Retold from the traditional European fairy tale, after Charles Perrault and the Brothers Grimm.",
};

// One line, drawn run by run so Hebrew and English can share it.
const fontOf = (fonts, font, heb) => (heb && fonts.heb ? fonts.heb(font) : font);
const lineWidth = (fonts, text, font, size) => visualRuns(text).reduce((w, r) => w + fontOf(fonts, font, r.heb).widthOfTextAtSize(r.text, size), 0);
function drawLine(page, fonts, text, x, y, size, font, color) {
  for (const r of visualRuns(text)) {
    const f = fontOf(fonts, font, r.heb);
    page.drawText(r.text, { x, y, size, font: f, color });
    x += f.widthOfTextAtSize(r.text, size);
  }
}

const roundRect = (w, h, r) => `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;

async function newDoc({ story, child, meta, title }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = {
    body: await pdf.embedFont(FONT_BYTES.body, { subset: true }),
    bold: await pdf.embedFont(FONT_BYTES.bold, { subset: true }),
    title: await pdf.embedFont(FONT_BYTES.title, { subset: true }),
  };
  // Only a book with Hebrew in it carries the Hebrew font.
  if (Object.values(child).some(hasHebrew)) {
    fonts.hebrew = await pdf.embedFont(FONT_BYTES.hebrew, { subset: true });
    fonts.hebrewBold = await pdf.embedFont(FONT_BYTES.hebrewBold, { subset: true });
    fonts.heb = (f) => (f === fonts.body ? fonts.hebrew : fonts.hebrewBold);
  }
  pdf.setTitle(title || `${story.title}, starring ${child.name}`);
  pdf.setAuthor(PUBLISHER);
  pdf.setCreator(`${PUBLISHER} (MCON 368)`);
  pdf.setProducer(PUBLISHER);
  pdf.setLanguage("en-US");
  // Fixed dates, so the same book always makes the same file.
  const at = meta?.madeAt ? new Date(meta.madeAt) : new Date(0);
  pdf.setCreationDate(at);
  pdf.setModificationDate(at);
  return { pdf, fonts };
}

// Where a page sits on its sheet: the trim's bottom-left corner (ox, oy), and the
// area its background must cover (the trim, or the trim plus bleed).
const trimOnly = { ox: 0, oy: 0, fill: { x: 0, y: 0, w: PAGE_W, h: PAGE_H } };

function withClip(page, fill, draw) {
  page.pushOperators(pushGraphicsState(), rectangle(fill.x, fill.y, fill.w, fill.h), clip(), endPath());
  draw();
  page.pushOperators(popGraphicsState());
}

// The art covers the fill area, centred on the trim, keeping its shape.
function coverArt(page, art, g) {
  const cx = g.ox + PAGE_W / 2, cy = g.oy + PAGE_H / 2, f = g.fill;
  const hw = Math.max(cx - f.x, f.x + f.w - cx), hh = Math.max(cy - f.y, f.y + f.h - cy);
  const k = Math.max((2 * hw) / PAGE_W, (2 * hh) / PAGE_H, 1);
  withClip(page, f, () => page.drawImage(art, { x: cx - (k * PAGE_W) / 2, y: cy - (k * PAGE_H) / 2, width: k * PAGE_W, height: k * PAGE_H }));
}

async function storyPage(pdf, page, fonts, p, buf, g = trimOnly) {
  const art = await pdf.embedJpg(buf);
  const { place } = p;
  const X = (fx) => g.ox + fx * PAGE_W, Y = (fy) => g.oy + PAGE_H - fy * PAGE_H;
  if (place.mode === "framed") {
    page.drawRectangle({ ...rect(g.fill), color: PAPER });
    const a = place.art;
    page.drawImage(art, { x: X(a.left), y: Y(a.bottom), width: (a.right - a.left) * PAGE_W, height: (a.bottom - a.top) * PAGE_H });
  } else {
    coverArt(page, art, g);
    const b = place.box;
    const w = (b.right - b.left) * PAGE_W, h = (b.bottom - b.top) * PAGE_H;
    page.drawSvgPath(roundRect(w, h, 12), { x: X(b.left), y: Y(b.top), color: PAPER, opacity: 0.93, borderWidth: 0 });
  }
  const font = place.font === "title" ? fonts.title : fonts.body;
  const b = place.box;
  const cx = X((b.left + b.right) / 2);
  const total = place.lines.length * place.lineH + (place.sub?.lineH || 0);
  let y = Y((b.top + b.bottom) / 2) + total / 2;
  for (const line of place.lines) {
    y -= place.lineH;
    page.drawText(line.text, { x: cx - (line.width * PAGE_W) / 2, y: y + (place.lineH - place.size) * 0.62, size: place.size, font, color: INK });
  }
  if (place.sub) {
    y -= place.sub.lineH;
    drawLine(page, fonts, place.sub.text, cx - lineWidth(fonts, place.sub.text, fonts.body, place.sub.size) / 2, y + 5, place.sub.size, fonts.body, MUTED);
  }
}
const rect = (f) => ({ x: f.x, y: f.y, width: f.w, height: f.h });

// The inside page: copyright and publisher, set low on the page like a real book.
function copyrightPage(page, fonts, { story, child, meta }, g = trimOnly) {
  page.drawRectangle({ ...rect(g.fill), color: PAPER });
  const accent = ACCENT[story.key] || INK;
  const cx = g.ox + PAGE_W / 2;
  const center = (text, font, size, y, color) => drawLine(page, fonts, text, cx - lineWidth(fonts, text, font, size) / 2, g.oy + y, size, font, color);
  const year = new Date(meta?.madeAt || Date.now()).getFullYear();
  const month = new Date(meta?.madeAt || Date.now()).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const W = 300, S = 10.5, LH = 15.5;
  const para = (t) => balanced(t, bodyWidth, S, W);
  const blocks = [
    para(`Text and illustrations copyright © ${year} ${PUBLISHER}. All rights reserved.`),
    para("No part of this book may be reproduced, stored or shared in any form without written permission from the publisher."),
    para(TALE[story.key] || "Retold from a traditional fairy tale."),
    para(`The pictures were made for this book with AI image tools, from a photo of its star, and checked page by page before printing.`),
    [`Published by ${PUBLISHER}`, PUBLISHER_SITE],
    [`First edition, ${month}`, meta?.bookId ? `Book no. ${meta.bookId}` : null].filter(Boolean),
  ];
  const height = 22 + 26 + blocks.reduce((s, b) => s + b.length * LH + 10, 0);
  let y = 72 + height; // the block sits in the lower part of the page

  // A small gold book, the publisher's mark.
  page.drawSvgPath("M12 6C9.5 4.2 6 3.8 2.5 4.5v14c3.5-.7 7-.3 9.5 1.5 2.5-1.8 6-2.2 9.5-1.5v-14C18 3.8 14.5 4.2 12 6z", { x: cx - 18, y: g.oy + y + 46, scale: 1.5, color: GOLD });
  center(`${story.title},`, fonts.title, 15, y, accent);
  y -= 20;
  center(`starring ${child.name}`, fonts.title, 15, y, accent);
  y -= 26;
  for (const block of blocks) {
    for (const line of block) { center(line, fonts.body, S, y, INK); y -= LH; }
    y -= 10;
  }
}

const DETAILS = [["age", "Age"], ["likes", "Favourite thing to do"], ["food", "Favourite food"], ["growUp", "When I grow up"]];

// The back cover: About Me.
async function aboutMe(pdf, page, fonts, story, child, portraitBuf, g = trimOnly) {
  const accent = ACCENT[story.key] || INK;
  page.drawRectangle({ ...rect(g.fill), color: PAPER });
  const center = (text, font, size, y, color) => drawLine(page, fonts, text, g.ox + (PAGE_W - lineWidth(fonts, text, font, size)) / 2, g.oy + y, size, font, color);

  const M = 48, FOOT = 34;
  const rows = DETAILS.filter(([k]) => child[k]).map(([k, label]) => ({ label, lines: wrap(child[k], bodyWidth, 14, PAGE_W - 2 * M) }));
  const more = child.more ? child.more.split(/\n+/).flatMap((para) => wrap(para, bodyWidth, 14, PAGE_W - 2 * M)) : [];
  const rowsH = rows.reduce((s, r) => s + 18 + r.lines.length * 19 + 8, 0) + (more.length ? 10 + more.length * 19 : 0);
  const fixed = 56 + 16 + 34 + 22 + 18;
  const side = Math.max(120, Math.min(280, PAGE_H - 90 - FOOT - fixed - rowsH));
  let y = PAGE_H - Math.max(36, (PAGE_H - 40 - FOOT - fixed - side - rowsH) / 2);

  y -= 40;
  center("About Me", fonts.title, 36, y, accent);
  y -= 16;
  if (portraitBuf) {
    const img = await pdf.embedJpg(portraitBuf);
    y -= side;
    page.drawImage(img, { x: g.ox + (PAGE_W - side) / 2, y: g.oy + y, width: side, height: side });
  }
  y -= 34;
  center(child.name, fonts.title, 26, y, INK);
  y -= 20;
  center(`starring as ${story.role}`, fonts.body, 13.5, y, MUTED);
  y -= 26;
  for (const r of rows) {
    center(r.label, fonts.bold, 12, y, accent);
    y -= 18;
    for (const line of r.lines) { center(line, fonts.body, 14, y, INK); y -= 19; }
    y -= 8;
  }
  if (more.length) {
    y -= 4;
    for (const line of more) { center(line, fonts.body, 14, y, INK); y -= 19; }
  }
  // The publisher, at the foot of the back cover.
  page.drawLine({ start: { x: g.ox + PAGE_W / 2 - 40, y: g.oy + 44 }, end: { x: g.ox + PAGE_W / 2 + 40, y: g.oy + 44 }, thickness: 0.8, color: GOLD });
  center(`${PUBLISHER} · ${PUBLISHER_SITE}`, fonts.body, 10, 28, MUTED);
}

/** The reader's PDF: cover, copyright page, story pages 2–20, About Me on the back. */
export async function buildBookPdf({ story, child, pages, portrait, loadImage, meta = {} }) {
  const { pdf, fonts } = await newDoc({ story, child, meta });
  const [cover, ...rest] = pages;
  await storyPage(pdf, pdf.addPage([PAGE_W, PAGE_H]), fonts, cover, await loadImage(cover.image));
  copyrightPage(pdf.addPage([PAGE_W, PAGE_H]), fonts, { story, child, meta });
  for (const p of rest) await storyPage(pdf, pdf.addPage([PAGE_W, PAGE_H]), fonts, p, await loadImage(p.image));
  await aboutMe(pdf, pdf.addPage([PAGE_W, PAGE_H]), fonts, story, child, portrait ? await loadImage(portrait) : null);
  return Buffer.from(await pdf.save());
}

/** Interior pages a printed book has: the inside page plus the story after the cover, padded to a multiple of 4. */
export const interiorPageCount = (pages) => Math.ceil(pages.length / 4) * 4; // 1 copyright + (n - 1) story pages = n

/**
 * What the printer gets. cover: { width, height } in points, from Lulu's
 * cover-dimensions endpoint for this product and page count.
 */
export async function buildPrintFiles({ story, child, pages, portrait, loadImage, meta = {}, cover: dims }) {
  const [cover, ...rest] = pages;
  const B = BLEED, SW = PAGE_W + 2 * B, SH = PAGE_H + 2 * B;
  const bled = { ox: B, oy: B, fill: { x: 0, y: 0, w: SW, h: SH } };

  // Interior: the copyright page, then the story. Every page carries bleed.
  const inside = await newDoc({ story, child, meta, title: `${story.title}, starring ${child.name} (interior)` });
  copyrightPage(inside.pdf.addPage([SW, SH]), inside.fonts, { story, child, meta }, bled);
  for (const p of rest) await storyPage(inside.pdf, inside.pdf.addPage([SW, SH]), inside.fonts, p, await loadImage(p.image), bled);
  const count = interiorPageCount(pages);
  while (inside.pdf.getPageCount() < count) inside.pdf.addPage([SW, SH]).drawRectangle({ x: 0, y: 0, width: SW, height: SH, color: PAPER });

  // Cover: one sheet, back cover on the left, spine, front cover on the right.
  const W = Number(dims?.width) || 2 * PAGE_W + 2 * B, H = Number(dims?.height) || SH;
  const spine = Math.max(0, W - 2 * B - 2 * PAGE_W);
  const out = await newDoc({ story, child, meta, title: `${story.title}, starring ${child.name} (cover)` });
  const sheet = out.pdf.addPage([W, H]);
  const oy = (H - PAGE_H) / 2, mid = W / 2;
  await aboutMe(out.pdf, sheet, out.fonts, story, child, portrait ? await loadImage(portrait) : null, { ox: B, oy, fill: { x: 0, y: 0, w: mid, h: H } });
  await storyPage(out.pdf, sheet, out.fonts, cover, await loadImage(cover.image), { ox: W - B - PAGE_W, oy, fill: { x: mid, y: 0, w: W - mid, h: H } });
  if (spine > 0) sheet.drawRectangle({ x: B + PAGE_W, y: 0, width: spine, height: H, color: ACCENT[story.key] || INK });

  return { interior: Buffer.from(await inside.pdf.save()), cover: Buffer.from(await out.pdf.save()), interiorPages: inside.pdf.getPageCount(), coverSize: { width: W, height: H, spine } };
}
