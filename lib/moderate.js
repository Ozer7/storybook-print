// ---------------------------------------------------------------------------
// What the child types gets printed, so it's checked before a cent is charged.
// Three layers, cheapest first; any one can say no:
//
//   1. Rules, here, instantly: the name is made of letters and looks like a name;
//      no rude words; no phone numbers, emails, links or street addresses (a
//      printed book can be lost, and a child's address shouldn't be on it).
//   2. OpenAI's moderation endpoint (free): hate, harassment, sexual content,
//      violence, self-harm, across every field.
//   3. A small model, asked plainly: is this a name a real person could have,
//      and is each detail fine to print in a children's book? It catches what
//      the first two can't: "Poopy Head" or "Stupid" as a name, an epithet in a
//      language the word list doesn't know, an insult aimed at a sibling.
//
// Each refusal names the field and says what to change.
// ---------------------------------------------------------------------------
import OpenAI from "openai";
import { MOCK } from "./images.js";
import { CHECK_MODEL } from "./vision.js";
import { record, withMeter } from "./cost.js";
import { log } from "./log.js";

const LABELS = { name: "The name", age: "Age", likes: "Favourite thing to do", food: "Favourite food", growUp: "When I grow up", more: "Anything else" };

// Rude words and playground insults. Slurs and epithets are caught by layers 2
// and 3, which know far more of them, in more languages, than any list here.
const RUDE = [
  "stupid", "idiot", "idiotic", "dumb", "dummy", "dumbo", "moron", "loser", "ugly", "fatso", "fatty", "lardo", "poop", "poopy",
  "butthead", "butface", "fart", "farty", "farthead", "stinky", "smelly", "jerk", "weirdo", "freak", "dork", "dweeb", "doofus",
  "dimwit", "dunce", "bozo", "nitwit", "numbskull", "noob", "booger", "turd", "scum", "creep", "retard", "retarded", "spaz", "psycho",
  "shut up", "shit", "crap", "damn", "dammit", "hell", "ass", "arse", "asshole", "bitch", "bastard", "piss", "cock", "fuck", "fck",
  "wtf", "sex", "sexy", "boob", "boobs", "penis", "vagina", "nazi", "hitler", "kkk",
];
// Fine in a detail ("I hate broccoli", "I love pigs"), never as the star's name.
const NAME_ONLY = ["butt", "poo", "pee", "wee", "trash", "garbage", "pig", "piggy", "cow", "donkey", "rat", "worm", "slug", "baboon",
  "monkey", "hate", "kill", "die", "dead", "sucks", "lame", "useless", "nobody", "dope", "baby", "meanie", "liar", "brat"];
// A real name (short for Richard), but not something to print in an About Me.
const DETAIL_ONLY = ["dick"];
const wordsRe = (list) => new RegExp(`(^|[^\\p{L}])(${list.map((w) => w.replace(/ /g, "\\s+")).join("|")})(?=$|[^\\p{L}])`, "iu");
const RUDE_RE = wordsRe(RUDE), NAME_RE_BAD = wordsRe(NAME_ONLY), DETAIL_RE_BAD = wordsRe(DETAIL_ONLY);

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}'’\-. ]*$/u;

/** The rules that need no network. Returns { field, message } or null. */
export function ruleCheck(child) {
  const name = child.name || "";
  if (!name) return { field: "name", message: "Type the child's name for the cover and the About Me page." };
  if (!NAME_RE.test(name)) return { field: "name", message: "The name can only have letters, spaces, hyphens and apostrophes. No numbers, emoji or symbols." };
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length > 4) return { field: "name", message: "That's a lot of names for a cover. Use up to four words, like a first and last name." };
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return { field: "name", message: "Type the child's name, not just an initial." };
  if (/(\p{L})\1\1/iu.test(name)) return { field: "name", message: "The name has the same letter three times in a row. Please type the child's real name." };
  if (/^[a-z'’\-. ]+$/i.test(name) && !/[aeiouy]/i.test(name)) return { field: "name", message: "That doesn't look like a name. Please type the child's real name." };
  for (const [field, value] of Object.entries(child)) {
    if (!LABELS[field] || !value) continue;
    const m = String(value).match(RUDE_RE) || String(value).match(field === "name" ? NAME_RE_BAD : DETAIL_RE_BAD);
    if (m) {
      return { field, message: `${LABELS[field]} has a word we won't print in a children's book ("${m[2]}"). Please change it.` };
    }
    if (field === "age") continue;
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(value)) return { field, message: `${LABELS[field]} has an email address in it. We don't print contact details in a book. Please take it out.` };
    if (/(\d[\s().-]*){7,}/.test(value)) return { field, message: `${LABELS[field]} has what looks like a phone number. We don't print contact details in a book. Please take it out.` };
    if (/(https?:\/\/|www\.)\S+|\b\S+\.(com|net|org|io|co)\b/i.test(value)) return { field, message: `${LABELS[field]} has a web address in it. Please take it out.` };
    if (/\b\d{1,5}\s+\p{L}+(\s+\p{L}+)?\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|place|pl|way)\b\.?/iu.test(value)) {
      return { field, message: `${LABELS[field]} looks like it has a street address. A printed book can get lost, so we don't put a child's address in it. Please take it out.` };
    }
  }
  const age = child.age || "";
  if (age && /^\d+$/.test(age.trim()) && (Number(age) < 1 || Number(age) > 120)) return { field: "age", message: "Age should be a number from 1 to 120, or leave it empty." };
  return null;
}

let client = null;
const openai = () => (client ??= new OpenAI({ maxRetries: 1, timeout: 20_000 }));

const FIELD_SCHEMA = { type: "object", additionalProperties: false, required: ["ok", "problem"], properties: { ok: { type: "boolean" }, problem: { type: "string" } } };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["name_is_real", "name_problem", "fields"],
  properties: {
    name_is_real: { type: "boolean" },
    name_problem: { type: "string" },
    fields: { type: "object", additionalProperties: false, required: Object.keys(LABELS), properties: Object.fromEntries(Object.keys(LABELS).map((k) => [k, FIELD_SCHEMA])) },
  },
};

async function modelCheck(child) {
  const res = await openai().responses.create({
    model: CHECK_MODEL,
    reasoning: { effort: "low" },
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: [
          "A family typed these details into a form. They will be printed in a picture book for a child: the name on the front cover, the rest on the back cover under \"About Me\".",
          "",
          "1. name_is_real: could \"name\" be the real name of a person? Names from any language, culture or script count, including rare and unusual ones, nicknames (Max, Ellie, Bubba), and a first name with a last name. It is NOT a real name if it is an insult, an epithet or slur, a rude or toilet word, a joke or put-down (\"Poopy Head\", \"Stinky\", \"Loser\", \"Fatty\"), an ordinary object or food used as a name (\"Toilet\", \"Banana\"), a famous cartoon or brand character (\"Mickey Mouse\", \"SpongeBob\"), or keyboard mashing. If it is not real, say why in name_problem in a few plain words; otherwise leave name_problem empty.",
          "2. fields: for every field, ok is false if printing it in a children's book would be inappropriate: insults or mockery of anyone, profanity even if disguised, sexual content, violence or weapons in a frightening way, hate, drugs, alcohol, smoking, gambling, self-harm, bullying, or personal contact details (home address, phone, email, school). Ordinary childish things are fine: wanting to be a ninja, loving pizza, a pet's name. An empty field is ok. For a field that isn't ok, say what's wrong in a few plain words in problem; otherwise leave problem empty.",
          "",
          JSON.stringify(Object.fromEntries(Object.keys(LABELS).map((k) => [k, child[k] || ""]))),
        ].join("\n"),
      }],
    }],
    text: { format: { type: "json_schema", name: "about_me_check", schema: SCHEMA, strict: true } },
  });
  record({ model: CHECK_MODEL, usage: res.usage, kind: "check" });
  return JSON.parse(res.output_text);
}

/**
 * Checks a child's details. Returns { ok: true } or { ok: false, field, message, layer }.
 * Throws only when the checkers can't be reached (the caller says "try again").
 */
export async function checkChild(child, { userId = null } = {}) {
  const rule = ruleCheck(child);
  if (rule) return { ok: false, layer: "rules", ...rule };
  if (MOCK) return { ok: true, layer: "rules" };

  return withMeter({ purpose: "validate", userId, bookId: null }, async () => {
    const fields = Object.keys(LABELS).filter((k) => child[k]);
    const [mod, model] = await Promise.all([
      openai().moderations.create({ model: "omni-moderation-latest", input: fields.map((k) => `${LABELS[k]}: ${child[k]}`) }),
      modelCheck(child),
    ]);
    const flagged = mod.results.findIndex((r) => r.flagged);
    if (flagged >= 0) {
      const cats = Object.entries(mod.results[flagged].categories).filter(([, v]) => v).map(([k]) => k.replace(/[/_-]/g, " "));
      log.info({ event: "child.rejected", layer: "moderation", field: fields[flagged], cats }, "details rejected");
      return { ok: false, layer: "moderation", field: fields[flagged], message: `${LABELS[fields[flagged]]} can't be printed in a children's book (it was flagged for ${cats.join(", ") || "its content"}). Please change it.` };
    }
    if (!model.name_is_real) {
      log.info({ event: "child.rejected", layer: "model", field: "name", why: model.name_problem }, "name rejected");
      return { ok: false, layer: "model", field: "name", message: `"${child.name}" doesn't look like a real name${model.name_problem ? ` (${model.name_problem.replace(/\.$/, "")})` : ""}. The cover says "starring" this name, so please type the child's real name.` };
    }
    for (const k of fields) {
      const f = model.fields[k];
      if (f && !f.ok) {
        log.info({ event: "child.rejected", layer: "model", field: k, why: f.problem }, "detail rejected");
        return { ok: false, layer: "model", field: k, message: `${LABELS[k]} can't go in a children's book${f.problem ? ` (${f.problem.replace(/\.$/, "")})` : ""}. Please change it.` };
      }
    }
    return { ok: true, layer: "model" };
  });
}
