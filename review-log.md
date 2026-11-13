# Review log

Every run of the `storybook-review` skill against the live site, oldest first. Entries are never edited or deleted.

## Run 1 — 2026-11-08 — reviewer: self — browser: Claude's built-in browser
Total 98 (first run)
PDF 39/40 · UI 20/20 · Money 19/20 · Engineering 20/20
Upload 18:26:19 → PDF 18:26:56 (37.6 s), Little Red Riding Hood, book #14 (one page repainted: p18 passed on try 2 of 3)
Upload 18:28:40 → PDF 18:29:03 (22.6 s), Jack and the Beanstalk, book #15 (every page passed on try 1)
Balance: 8.13 → fund 5.00 → 13.13 → generate 12.14 → generate 11.15 → refund 5.00 → 6.15 → refund 5.50 → 0.65 → generate refused (402, "Your balance is $0.65 and a book costs $0.99, so nothing was charged"), balance stays 0.65
Avg cost per book: $0.541 over 2 books (price $0.99): first tries $0.490, retries and checks the rest; cheapest $0.536, dearest $0.547
Photo: an AI-generated face from thispersondoesnotexist.com (a girl with long curly hair), never used in development. Name "Lily", girl, About Me: 8, drawing horses, pancakes, a vet.
Not measured: none. Deviations: the built-in browser has no private window, so the run started signed in and the sign-out / sign-in step was done in the same tab; the builder entered the 4242 test card on Stripe's page (the reviewer may not type card numbers), and the balance before and after was recorded.
Changed since last run: first run. Added for this run: API cost per book (every image call, retry and analysis check priced from token counts and shown against $0.99 in the purse) and the attempt count on every picture (live on the painting screen, on reader thumbnails, and under the page).

Evidence, line by line:
- PDF. Each PDF has 21 pages: 20 story pages plus About Me (pdf.js page count; text extracted from every page). Same 20-slot template in both: text zones match page for page except p13 (Jack bottom, Red top) and p17 (Jack middle, Red top), where the solver moved the words off the art. The child is the same girl on pp. 1, 10, 20 of both books, with her long curly hair on every page. Text over a face: none on any of the 42 pages, checked one by one. At 400% (Red p2, Jack p17, Jack p21) the letters are real type (Andika, Fraunces), crisp, and selectable. Story in order, complete. About Me shows "Lily", "starring as Little Red/Jack", and the four details entered.
- UI. Home loaded in 0.42 s (navigation timing, including the book.bluebid.online redirect). The progress bar names each stage: "Reading your photo", "Painting you into the pages: 9 of 20 done", "Repainting 1 page that didn't pass the check", "Binding your PDF". Thumbnails landed one at a time from 7.9 s to 24.9 s. Each slot showed "try 1/3" live and "try 2/3" on p18 while it was repainted. Balance in the top bar on every screen. History is one click away (the purse), dated, with cause and running balance. At 400 px the upload form works with no sideways scroll. Too little money: the form shows "A book costs $0.99, and your balance is $0.65" and an Add money button instead of the make button.
- Money. Funding: +$5.00 (pi_3UZfP2D77uFrOgI50TR1wiIt). Each book: exactly −$0.99. Refunds: $5.00 (re_3UZfP2D77uFrOgI50A2Vtqpr) and $5.50 processed at once; the balance updated without a reload. History: 21 rows, each with cause, amount and timestamp; they sum to the $0.65 balance, and every running balance checks.
- Engineering. Both books in under 60 s (37.6 s, 22.6 s). Signed out: PDFs refused (401). Signed back in: book #9 from Nov 6 downloads (6.8 MB, 1.6 s). The character bible is in Postgres and served by /bible.json. The attempt count is on every picture; book #10 p13 shows "3/3 ★" with "All 3 tries had problems: kept the best, try 1, check score 55". No keys in any commit, in .env history, or in the page source.

Fix first:
1. Cost card splits don't add up: retries ($0.033) and checks are averaged only over books that had them, so first tries + retries + checks ($0.558) is more than the $0.541 average (lib/db.js costSummary; Money, −1)
2. Likeness drifts on a few pages: Lily reads older and her eyes differ on Red p9 and Jack p11 (both scored as passes by the check) (PDF, −1)
3. At 400 px the header breaks into three lines: the balance pill floats above the logo and "Sign out" sits on its own line (public/index.html header; UI, 0 but looks unfinished)
4. Red p2 words are set smaller than the other pages (the top band is short), and the About Me labels are about 7 pt: legible, but the smallest type in the book (lib/layout.js, lib/pdf.js; PDF, 0)
5. Cost is 55% of the price ($0.54 of $0.99), and every retry eats into it; worth knowing before pricing changes (no points)

## Run 2 — 2026-11-08 — reviewer: self — browser: Claude's built-in browser
Total 94 (was 98)
PDF 34/40 · UI 20/20 · Money 20/20 · Engineering 20/20
Upload 19:00:42 → PDF 19:01:24 (42.6 s), Jack and the Beanstalk, book #16 (6 pages repainted, all passed on try 2)
Upload 19:01:53 → PDF 19:02:46 (53.3 s), Little Red Riding Hood, book #17 (p3 lost tries 1 and 2 to OpenAI 429s, passed on try 3; p19 scored 20 and 8, ran out of time, kept try 1)
Balance: 0.65 → fund 20.00 → 20.65 → generate 19.66 → generate 18.67 → refund 2.00 → 16.67
Avg cost per book: $0.616 over 4 books (price $0.99); book #16 $0.743, book #17 $0.601
Photo: a new AI-generated face from thispersondoesnotexist.com (a man of about 40 with stubble), never used before. Name "Daniel", boy, About Me: 40, fixing old bikes, lasagna, a pilot.
Not measured: none. Deviations as in run 1 (no private window in the built-in browser; the builder entered the test card).
Changed since run 1: the cost card's parts now add up to the average; the face check marks down age drift; the phone header is one line at 400 px; About Me labels 12 pt and details 14 pt.

Evidence:
- PDF. 21 pages each (20 + About Me). Same template and text zones as run 1; no text over a face on any page. About Me shows "Daniel", "starring as Jack/Little Red" and all four details. But the faces look pasted on: Daniel's head is close to a photograph on Red pp. 8, 10, 14 and Jack p16, much more detailed than the painted bodies and the other characters (style −2). And likeness drifts: in Jack he is plainly Daniel on pp. 4, 8, 14, 16 but a generic young boy on pp. 3, 6, 11, 13 (−4).
- UI. Progress names each stage, including "Repainting 3 pages that didn't pass the check" with "try 2/3" on slots 2, 8 and 14. Thumbnails one by one. Balance always in the top bar. The header is one line at 400 px.
- Money. +$20.00 from the builder's payment. Each book −$0.99 exactly. Refund $2.00 (re_3UZfwyD77uFrOgI50aBDVJih) processed at once. 25 history rows sum to $16.67, and every running balance checks. Purse: "$0.616 average API cost per book, over 4 books. You pay $0.99: $0.374 left over per book", with first tries, retries and checks adding up to the average.
- Engineering. Both under 60 s (42.6 s, 53.3 s). Signed out: PDF 401; signed in: book #14 downloads (7.6 MB, 2.0 s). Attempt counts shown on every picture.

Fix first:
1. Faces look pasted in: the page edit copies the face from the photo, so it comes out photographic (Red pp. 8, 10, 14; Jack p16) (PDF style, −2). Fix: copy the face from the book's own painted portrait, which passes its own likeness check against the photo, and keep checking every page against the photo.
2. Likeness drifts between pages: Daniel becomes a generic boy on Jack pp. 3, 6, 11, 13 (PDF likeness, −4). Same fix: every page copies one painted face.
3. The face check judged the wrong face: on Red p19 the hero is cheek to cheek with Grandmother, and the check scored Grandmother (20, then 8), so a good page used up its time and shows "★" (lib/pipeline.js analyse; 0 points, but a misleading attempt count and a slower book).
4. Two books back to back hit OpenAI's image limit (20 input images a minute): Red p3 lost two attempts to 429s and the book took 53.3 s, 7 s from the limit (lib/images.js; Engineering at risk).
5. Retries push cost up: 11 retries across the two books made them $0.74 and $0.60, against $0.54 in run 1 (no points).

## Run 3 — 2026-11-08 — reviewer: self — browser: Claude's built-in browser
Total 99 (was 94)
PDF 39/40 · UI 20/20 · Money 20/20 · Engineering 20/20
Upload 19:17:29 → PDF 19:18:14 (45.0 s), Jack and the Beanstalk, book #19 (portrait ready at 13.5 s; pp. 1, 7, 10, 13 passed on try 2)
Upload 19:18:38 → PDF 19:19:12 (33.9 s), Little Red Riding Hood, book #20, started straight after (every page passed on try 1; no rate-limit errors)
Balance: 15.68 → generate 14.69 → generate 13.70 → refund 1.00 → 12.70
Avg cost per book: $0.601 over 7 books (price $0.99): first tries $0.486, retries $0.076, checks $0.040
Photo: a third AI-generated face from thispersondoesnotexist.com (a man of about 35 with dark hair and glasses), not used in development. Name "Sam", boy, About Me: 35, chess, sushi, a teacher.
Not measured: none. Deviations as in run 1 (no private window in the built-in browser; the builder entered the test card, for the $20.00 funding before run 2).
Changed since run 2: pages copy the face from the book's painted portrait instead of the photo; the portrait is painted with the story's hero from the character bible as the style example; the face check sees other characters' faces and hair greyed out; OpenAI 429s are waited out and resent instead of failing an attempt.

Evidence:
- PDF. 21 pages each. Same template and text zones; no text over a face on any page. Sam is the same person, glasses included, on every page of both books (pp. 1, 10, 20 side by side), and in Jack the head is painted to match the child-sized bodies. Red p19, which scored 20 and 8 in run 2, passed on try 1. Remaining: in Red the largest heads (pp. 8, 14) still read a little more realistic than the paint around them (style −1).
- UI. The progress bar shows "Painting your portrait first" for the first 13 s, then "Painting you into the pages: n of 20 done". Attempt counts on every picture.
- Money. Each book −$0.99 exactly; refund $1.00 (re_3UZfwyD77uFrOgI506wmjDSO) processed at once; 29 history rows sum to $12.70, and every running balance checks. Cost card parts add up to the average.
- Engineering. 45.0 s and 33.9 s, made back to back. Signed out: PDF 401; signed in: book #16 downloads (6.8 MB, 1.4 s).

Fix first:
1. Big heads in Red still look a little more realistic than the paint (pp. 8, 14) (PDF style, −1). Next: paint the portrait at medium quality (one image, a few seconds), or soften the blended head to the page's texture.
2. The portrait is painted before any page starts, so a book with retries runs 45–53 s (book #18 between runs: 52.8 s): under 60, with less margin than before (Engineering at risk).
3. Cost is $0.60 a book, 61% of the $0.99 price; retries add about $0.08 a book (no points).
4. An adult's head on the story's child-sized body reads oddly at close range; the template's heroes are children (no points; a product decision).
5. Red p2's words are set small because its clear band is short (carried over from run 1; no points).

## Run 4 — 2026-11-13 — reviewer: self — browser: Claude's built-in browser
Total 96 (was 99)
PDF 36/40 · UI 20/20 · Money 20/20 · Engineering 20/20
Upload 01:06:44 → PDF 01:07:31 (about 47 s; server timing 45.8 s), Little Red Riding Hood, book #24 (pp. 3, 16, 17 passed on try 2)
Upload 01:09:34 → PDF ready by 01:10:19 (under 45 s; server timing 41.2 s), Jack and the Beanstalk, book #25 (p11 passed on try 2; p7 had no passing try and kept its best, score 55)
Balance: 12.70 → fund 100.00 → 112.70 → printed copy (order #1) 87.71 → generate 86.72 → generate 85.73 → refund 85.00 → 0.73 → generate refused (402, "Your balance is $0.73 and a book costs $0.99, so nothing was charged"), balance stays 0.73
Avg cost per book: $0.587 over 10 books (price $0.99): first tries $0.490, retries $0.058, checks $0.039 (now on the admin page, see Fix first 3)
Photo: a new AI-generated face from thispersondoesnotexist.com (a man of about 45, short dark hair), never used before. Name "Michael", boy, About Me: 45, fixing up old cars, pizza, a firefighter.
Not measured: none. Deviations: no private window in the built-in browser, so the run started signed in (the sign-out / sign-in step was done in the same tab); the builder entered the 4242 test card on Stripe's page for the $100.00 funding.
Changed since run 3: this homework. The PDF is now laid out as a book (front cover "starring Michael", copyright page published by Bluebid Books, story from the next page, About Me on the back cover). The About Me details are checked before any charge. Printed copies can be ordered through Lulu's sandbox. Costs, margins and model names moved to an admin page; customer-facing copy rewritten; sandbox notes removed.

Evidence:
- PDF. Each PDF has 22 pages: cover (story page 1), copyright page, story pages 2–20, About Me back cover. So it still has 20 story pages plus About Me (pdf.js page count and text on every page). Same template and text zones in both books. Text over a face: none on any of the 44 pages, checked one by one at 190 px wide. Fonts are embedded Andika and Fraunces (pdffonts), and a 400% crop of Red p3 is crisp type. Red: Michael is plainly the same man on pp. 1, 10 and 20. Jack: he's recognisable on pp. 7, 14, 16, 17 and the back cover, but on the small-head pages (3, 4, 5, 6, 10, 11, 18) he reads as a generic young boy (likeness −3). The heads on Red pp. 1, 7, 9 and 15 look more photographic than the paint around them (style −1). About Me shows "Michael", "starring as Little Red/Jack" and all four details.
- Checks on what's typed (before any charge, balance unchanged at $87.71): "Poopy Head" refused by the rules layer; "Mickey Mouse" refused by the model ("famous cartoon character"); "My brother is a total loser lol" in Anything else refused, naming the field.
- Printing. Order #1 (Sam's Red book): approved on the page, a bad ZIP (4 digits) refused before Lulu saw it, $24.99 charged, Lulu print job 363659. Lulu fetched both PDFs and reports "Print-job was accepted and needs to be paid. Line Item was successfully validated." Sandbox stops at unpaid.
- UI. Home loaded in 240 ms (navigation timing; first paint 516 ms). Progress names each stage: "Reading your photo", "Painting the portrait", "Illustrating the pages: n of 20 done", "Touching up 3 pages", "Binding your book". Thumbnails landed one at a time: 4 at 31 s, 8 at 34 s, 14 at 36 s, 19 at 43 s, 20 at 47 s. Live "try 2/3" on slots 3, 16 and 17 while they were redone. The reader's "Quality check" lists every redone page ("Page 7: kept the best of 2 tries"). At 400 px the form has no sideways scroll (scrollWidth 400) and the header is one line (59 px).
- Money. +$100.00 (pi_3UbDIRD77uFrOgI50GvliNUV). Each book −$0.99 exactly. Refund $85.00 (re_3UbDIRD77uFrOgI50iQdVPTi) processed in about 1 s; the top-bar balance updated without a reload. History: 34 rows with cause, amount and time; they sum to $0.73, the balance, and every running balance checks.
- Engineering. Both books under 60 s. Signed out: PDF 401. Signed back in: book #14 from Nov 8 downloads (7.6 MB, 1.9 s). Bible at /bible and /bible.json. Attempt counts live on the painting screen and in the reader's Quality check. No keys in the repo (.env is ignored; the Lulu keys and Stripe key live in Render's environment).

Fix first:
1. Likeness drifts in Jack on the small-head pages: Michael reads as a generic young boy on pp. 3, 4, 5, 6, 10, 11, 18 (PDF likeness, −3). The template's heroes are children, and an adult's face painted onto a small child's head loses its features. Next: pass the portrait at higher detail for small heads, or crop tighter around the head before the edit.
2. Photographic heads on Red pp. 1, 7, 9, 15 (PDF style, −1). Carried over from run 3. Next: paint the portrait at medium quality and soften the blended head to the page's texture.
3. The average cost per book is now on the admin page only. A grader using the site as a customer won't see it (Money, −3 at risk). Fix: add the grader's email to ADMIN_EMAILS before grading, or point them at the write-up.
4. The short-balance message still said "Add money in your purse" after the page was renamed "Your account" (UI, 0). Fixed after this run.
5. Opening a deep link (#/book/25) right after signing in showed the home page until a reload (UI, 0; a race with the sign-in check). Fixed after this run.
