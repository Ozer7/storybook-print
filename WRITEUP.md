# Make it a real book: write-up

**Live:** https://print.bluebid.online (forwards to https://storybook-print.onrender.com)
**Repo:** https://github.com/Ozer7/storybook-print
**A PDF it produced:** https://github.com/Ozer7/storybook-print/blob/main/samples/little-red-riding-hood-michael.pdf
**Previous homework, frozen:** https://book.bluebid.online and https://github.com/Ozer7/beanstalk-book

## What I did

**It looks like a real book.** The PDF is now laid out in book order:
- the front cover: the art, with "Jack and the Beanstalk, starring Sarah"
- the inside page: the copyright notice and the publisher, Bluebid Books (bluebid.online), with the edition date and book number
- the story, starting on the page after the copyright page
- the back cover: About Me, with the publisher at the foot

The reader on the site shows the copyright page in the same place. The printer gets two files, both drawn by the same code as the PDF you download:
- **Interior:** the copyright page plus story pages 2–20, which makes 20 pages at 6.25 × 9.25 in. That's 6 × 9 in plus 0.125 in bleed on every side.
- **Cover:** one sheet with the back cover, the spine and the front cover, sized by Lulu's cover-dimensions endpoint (12.25 × 9.25 in).

**Print API: Lulu, sandbox only.** The product is a 6 × 9 in saddle-stitched (stapled) paperback in premium full colour on 80# coated paper, with a gloss cover (`0600X0900FCPRESS080CW444GXX`). Saddle stitch takes 4–48 pages in multiples of 4, so our 20-page interior fits. The sandbox address is hard-coded and there is no setting for production. Ordering takes three steps:
1. **Check and approve.** The order page shows the PDF itself, a checkbox, and "Approve for printing". The approval stores a hash of every picture, every word placement and the About Me. If the book changes afterwards, the order is refused and the printer's file links stop working, so nothing that wasn't approved can be printed.
2. **Address.** The user types a US delivery address. Each field is checked (state, ZIP, phone) before Lulu sees it, and then they see a live price from Lulu's cost calculator.
3. **Place the order.** One click charges the balance and creates the Lulu print job. If Lulu refuses, the money goes straight back. Lulu downloads the two PDFs from a private link that only this order knows. The order's status is read back from Lulu, and an unpaid order can be canceled for a full refund.

**Checking what the child types.** Everything typed goes into the printed book, so it's checked before anything is charged. There are three layers, cheapest first:
1. **Rules:** the name is letters only, up to four words, and not keyboard mashing. There are no rude words, and no phone numbers, emails, web links or street addresses (a printed book can get lost, and a child's address shouldn't be in it).
2. **OpenAI's moderation endpoint:** it covers hate, harassment, sexual content and violence across every field.
3. **A small model** answers two questions: could this name be a real person's name, and is each detail fine for a children's book? This catches "Poopy Head", "Stinky", "Mickey Mouse", an epithet in another language, or an insult aimed at a sibling.

The error names the field, and the form highlights it. Books made before this homework are checked when someone tries to print them.

**A real order.** Order #1 went to Lulu's sandbox as print job 363659. Lulu downloaded both PDFs and validated them; the sandbox stops at "unpaid".

**Ready for customers.** The figures below are for the owner. They're on an admin page (`/#/admin`; the Admin link is in the header, and the page asks for a password), along with every order, the cost of each book and the character bible. Customers see prices, their books and their orders. There are no sandbox notes, no test card number and no model names on the public pages, and there are privacy and terms pages.

## Price: $24.99 for a printed copy, shipped

The business model has two steps:
- **$0.99** makes the book and gives you the PDF. You can see it, read it and keep it.
- **$24.99** prints and ships a copy of a book you've approved, with standard US mail included. A second copy is another $24.99, with no new painting needed.

### What one printed copy costs us

These are live quotes from Lulu's sandbox for this exact book (20-page interior, product above, standard mail), taken on Nov 13, 2026:

| | New York | Florida | California |
|---|---:|---:|---:|
| Printing (Lulu) | $6.56 | $6.56 | $6.56 |
| Shipping, standard mail | $5.69 | $5.69 | $5.69 |
| Lulu fulfillment fee | $0.75 | $0.75 | $0.75 |
| Sales tax Lulu charges us | $1.14 | $0.93 | $0.64 |
| **Lulu total** | **$14.14** | **$13.93** | **$13.64** |
| Stripe fee on the $24.99 coming in (2.9% + $0.30) | $1.02 | $1.02 | $1.02 |
| **Cost of a printed copy** | **$15.16** | **$14.95** | **$14.66** |
| **Price** | $24.99 | $24.99 | $24.99 |
| **Margin** | **$9.83 (39%)** | **$10.04 (40%)** | **$10.33 (41%)** |

### And the book itself

| | |
|---|---:|
| Generation: average API cost per book, over 10 books (first tries $0.490, retries $0.058, checks $0.039) | $0.587 |
| About Me check (moderation is free; one small-model call) | under $0.01 |
| Stripe fee on the $0.99 (2.9% + $0.30) | $0.33 |
| **Cost of the digital book** | **about $0.92** |
| **Price** | $0.99 |
| **Margin** | **about $0.07** |

### A customer who buys the book and one printed copy (New York)

| | |
|---|---:|
| Revenue: $0.99 + $24.99 | $25.98 |
| Generation $0.59 + check $0.01 + Lulu $14.14 | $14.74 |
| Stripe, if they top up once with $25.98: 2.9% + $0.30 | $1.05 |
| **Margin** | **$10.19 (39%)** |

### Why $24.99

- **Below the competition.** Wonderbly, the best-known personalised picture-book brand, sells softcovers from about $30 ($29.99 for a 34-page softcover; up to $34.99 for longer titles), before shipping. At $24.99 with shipping included, we're the cheaper option and still clear about $10 a copy.
- **Room for mistakes.** The margin has to cover misprints and lost parcels, which we'd reprint at our own cost (about $14 each). At about $10 a copy, one reprint for every 1.4 good copies would still break even.
- **The $0.99 book is a sample, not the business.** It barely covers its own generation and Stripe fee. The money is in the printed copy.
- **Cheaper top-ups would help.** Stripe's $0.30 per payment hurts on small top-ups. The per-copy figures above assume one payment per copy; a $50 top-up spreads that $0.30 further.

The order page shows this breakdown for the user's own address before they place the order.

## Carried over

Everything from "Charge for the book" still works:
- Stripe sandbox funding, refunds and the ledger
- 20 pages from one template, both stories
- the character bible
- under 60 seconds
- the quality loop with try counts
- the API cost per book

`storybook-review` run 4 scored 96, appended to `review-log.md`. Known defects are in `to-do.md`.
