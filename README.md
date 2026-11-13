# Storybook, in print

A 20-page picture book starring you, in under a minute, and a real printed copy at your door. Pick Jack and the Beanstalk or Little Red Riding Hood, upload a photo, and pay $0.99 from your account; approve the PDF, type an address, and order a printed copy for $19.99. MCON 368, "Make it a real book." The previous homework ("Charge for the book") stays frozen at [Ozer7/beanstalk-book](https://github.com/Ozer7/beanstalk-book).

## How it works

- **One template** (`lib/template.js`): 20 page slots, each with a layout, a camera distance and a place for the words. Both stories (`stories/`) fill in the same slots.
- **Character bible** (`bible` table, public at `/bible`): every character's description and picture. Their pictures are edited into every scene.
- **Pre-generated scenes** (`scenes` table, `lib/pregen.js`): all 40 pages are painted once with a stand-in hero, checked, and stored with a box around every face and everything the page needs.
- **Your book** (`lib/pipeline.js`, `lib/face.js`): only a square around the hero's head goes to the image model, all pages at once. The new head is colour-matched and feathered back into the art.
- **Quality loop** (`lib/quality.js`, `lib/vision.js`): every generated image is analysed. A failure is regenerated, up to 3 generations in all, then the best of the three is kept.
- **Words** (`lib/layout.js`): the solver places the words so they clear every stored box, trying the template's zone first and then the others. If nothing clears, the art is framed and the words go on paper below it.
- **Money** (`lib/wallet.js`): every credit and debit is a ledger row, and the balance is their sum. Stripe sandbox only; the app refuses a live key.
- **A real book** (`lib/pdf.js`): front cover with the title "starring" the child, an inside page with the copyright notice and the publisher (Bluebid Books), the story from the next page on, and About Me on the back cover. The same drawing code makes the reader's PDF and the printer's files.
- **Checked before it's printed** (`lib/moderate.js`): the name and About Me pass rules (letters only, no rude words, no phone numbers, emails or addresses), OpenAI's moderation endpoint, and a model asked whether the name is a real person's name. Nothing is charged until they pass.
- **Printed and shipped** (`lib/lulu.js`, `lib/orders.js`): Lulu's Print API, sandbox only. The reader approves the PDF (tied to a hash of its exact content), enters a US address, sees a live quote, and places the order. Lulu downloads the interior (20 pages with bleed) and the one-piece cover from a private link.
- **Still there tomorrow**: images live in Postgres, and the PDF is rebuilt from them on request.

## Run it locally

```bash
npm install
cp .env.example .env   # fill it in; git ignores it
npm run dev
```

`DATABASE_URL=postgres://... npm test` runs the whole app end to end on placeholder pictures and a fake Stripe, with no API calls.

## Deploy (Render)

Build `npm install`, start `npm start`. Set the variables from `.env.example` in Render's Environment tab, including `LULU_CLIENT_KEY` and `LULU_CLIENT_SECRET` from developers.sandbox.lulu.com. The first start paints the bible and scenes, and `/bible` shows the progress. Add `https://<host>/auth/google/callback` to the Google OAuth client.
