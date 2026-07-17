import { randomInt } from "node:crypto";

/**
 * Student portal credentials (Slice D — doc 26 §2D).
 *
 * The locked decision: the TUTOR provisions the account (no public self-signup —
 * these are minors, and parent-mediated provisioning is what keeps us clean under
 * the Australian Privacy Principles), auth is USERNAME + PASSWORD with NO email
 * required, and a generator suggests both so Fatima isn't inventing credentials
 * for twenty children by hand. Everything it suggests is editable and resettable.
 *
 * Why not magic links (the rest of the app's auth): docs 22/24 — the PKCE path is
 * brittle, and it presumes an inbox. A Year-5 student generally hasn't got one.
 * That's the point of "no email required", not a shortcut.
 *
 * This module is deliberately dependency-free and pure apart from the CSPRNG, so
 * the rules below are readable in one screen. It is imported only by server code
 * (the credential action + the sign-in action); nothing here is client-safe to
 * call, and a generated password must never be logged or persisted anywhere but
 * Supabase Auth's own hash.
 */

/**
 * The synthetic-email domain (doc 35b §5.2). `public.users.email` is NOT NULL
 * UNIQUE and Supabase Auth is email-keyed, so a username-only account still needs
 * *an* address. `.invalid` is reserved by RFC 2606 precisely for this — it is
 * guaranteed never to resolve, so no mail can ever be sent to a child's account
 * by us or by anyone who later wires up an email feature and forgets these exist.
 *
 * The address is DERIVED from the username, never looked up. That is what makes
 * sign-in "username + password" with no username→email table on the read path:
 * `emailForUsername()` reconstructs it deterministically. The cost is that
 * usernames are globally unique (enforced by students.username UNIQUE *and*, as a
 * second layer we get for free, by auth.users.email UNIQUE) rather than
 * per-tenant — a fine trade for one lookup fewer on an unauthenticated path, and
 * for never exposing a table that answers "which handles exist?".
 */
export const STUDENT_EMAIL_DOMAIN = "students.impactstudy.invalid";

/** Usernames: lowercase letters, digits, hyphens; 3–32 chars; must start with a
 *  letter. Narrow on purpose — this is typed by a child, often on a phone. */
const USERNAME_RE = /^[a-z][a-z0-9-]{2,31}$/;

export function emailForUsername(username: string): string {
  return `${username.trim().toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
}

export function normaliseUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

export function validateUsername(raw: string): string | null {
  const u = normaliseUsername(raw);
  if (!USERNAME_RE.test(u)) {
    return "Username must be 3–32 characters: letters, numbers and hyphens, starting with a letter.";
  }
  return null;
}

/** Passwords are for children and are typed from a printed card, so length beats
 *  character-class theatre. 12 is the floor for the memorable 3-part form below;
 *  a tutor who types their own gets the same floor and nothing more fussy. */
export const MIN_PASSWORD_LENGTH = 12;

export function validatePassword(raw: string): string | null {
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (raw.length > 72) {
    // bcrypt truncates at 72 bytes; refuse rather than silently ignore the tail.
    return "Password must be 72 characters or fewer.";
  }
  return null;
}

/**
 * Word list for memorable passwords. Curated for the actual users: concrete,
 * unambiguous when read aloud by a tutor to a child, and unambiguous when TYPED
 * — no homophones, nothing that invites a spelling argument, nothing a parent
 * would object to. Deliberately not a dictionary import: 96 hand-checked words
 * beat 10,000 unvetted ones when a human has to read one off a card.
 */
const WORDS = [
  "amber", "anchor", "apple", "arrow", "atlas", "autumn",
  "basil", "beacon", "bridge", "bronze", "butter", "cactus",
  "candle", "canyon", "cedar", "cherry", "cinnamon", "cobalt",
  "comet", "copper", "coral", "cotton", "crayon", "crystal",
  "daisy", "dolphin", "dragon", "ember", "falcon", "feather",
  "fern", "forest", "garnet", "ginger", "glacier", "granite",
  "harbour", "hazel", "honey", "indigo", "island", "ivory",
  "jasmine", "jigsaw", "jungle", "kettle", "lagoon", "lantern",
  "lemon", "lilac", "lotus", "lumber", "mango", "maple",
  "marble", "meadow", "melon", "meteor", "mint", "monsoon",
  "mosaic", "nectar", "nutmeg", "oasis", "olive", "orbit",
  "orchid", "otter", "pebble", "pepper", "pigeon", "planet",
  "pocket", "pumpkin", "quartz", "rabbit", "ribbon", "river",
  "rocket", "saffron", "sapphire", "shadow", "silver", "sparrow",
  "spruce", "sugar", "summit", "sunset", "teapot", "thunder",
  "tiger", "tulip", "velvet", "walnut", "willow", "yellow",
];

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

/**
 * A memorable password: two words + two digits, hyphen-joined ("maple-river-47").
 *
 * Entropy: 96² × 90 ≈ 2²⁰. That is WEAK in isolation and we are not pretending
 * otherwise — doc 35b §5.5 named this exact trade ("memorable passwords for
 * children are weak by design"). What makes it safe is the pairing: online-only
 * exposure (there is no offline hash to grind) behind the lockout in
 * lib/actions/student-auth.ts, which caps an attacker at a few hundred guesses an
 * hour against a 2²⁰ space. Raise the word count here before you'd ever raise the
 * lockout — but not past what a 10-year-old will retype correctly.
 */
export function generatePassword(): string {
  return `${pick(WORDS)}-${pick(WORDS)}-${randomInt(10, 100)}`;
}

/**
 * Suggest a username from what the tutor calls the student.
 *
 * PRIVACY DEFAULT (doc 35e §1 / the Slice-D brief): built from a NICKNAME or
 * FIRST NAME ONLY — never a full legal name. The handle then becomes the name
 * used in AI-prompt text, so every grading call carries "amara" instead of a
 * child's full identity. To be clear about the size of that win: it reduces the
 * NAME text only. The homework IMAGES are the larger exposure and this does
 * nothing about them — the real fix is the deferred zero-retention agreement or a
 * redaction layer (doc 35e §1), and it is not D's job to solve. D's job is not to
 * make it worse.
 *
 * The trailing digits are a privacy feature, not a collision hack: they mean the
 * handle doesn't have to grow toward a surname to stay unique as the practice
 * fills up with Amaras. `taken` lets the caller feed back existing usernames so
 * a suggestion is unique on first try.
 */
export function suggestUsername(
  nickname: string,
  taken: Iterable<string> = [],
): string {
  const takenSet = new Set(Array.from(taken, (t) => t.toLowerCase()));
  const base = normaliseUsername(nickname).slice(0, 12) || "student";
  // Guarantee the leading-letter rule even if the nickname starts with a digit.
  const stem = /^[a-z]/.test(base) ? base : `s${base}`;

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = `${stem}${randomInt(100, 1000)}`;
    if (!takenSet.has(candidate)) return candidate;
  }
  // Fall back to a wider number space rather than returning a known-taken handle.
  return `${stem}${randomInt(1000, 100000)}`;
}

export interface SuggestedCredentials {
  username: string;
  password: string;
}

export function suggestCredentials(
  nickname: string,
  taken: Iterable<string> = [],
): SuggestedCredentials {
  return {
    username: suggestUsername(nickname, taken),
    password: generatePassword(),
  };
}
