/**
 * Payload and Cognito group-name checks for /admin/coord/members. Pure; moved
 * verbatim out of `page.tsx`.
 */

// ---------------------------------------------------------------------------
// Payload shape — a successful STATUS is not a successful READ
// ---------------------------------------------------------------------------

/**
 * The list a 200 promised, or a throw.
 *
 * Every read on this page renders `loading` → `error` → `rows.length === 0` →
 * the table. That ordering is right, and it is not the gap. The gap is one
 * layer up: `setRows(json.things ?? [])` turns a body that never carried the
 * list into a **successful, empty** read — `error` stays null, the error arm is
 * skipped, and the page prints its absence copy for a table it never saw. The
 * `?? []` is dead per the wire types (every list field here is declared
 * non-optional) and live at runtime, which is exactly why it survived review.
 *
 * A non-array value is worse than a missing one: `.length` succeeds on a
 * string, so the `=== 0` guard does not fire, the value reaches `.map()`, and
 * the panel throws.
 *
 * The predicate lives here rather than at each call site for the reason
 * `console/readFailure.ts` gives for its own: seven sites each spelling it
 * themselves will drift, and the drift is invisible because every spelling
 * looks right.
 *
 * It stays local for one reason only — no second page needs it yet. NOT
 * because the `console/` barrel is off-limits to wire concerns: that barrel
 * says "nothing here fetches, polls, or knows a route", but it exports
 * `readFailure.ts`, whose `isNotFoundError` parses an HTTP status out of a
 * `GET <url> failed: <status> - <body>` message. So the barrel already holds a
 * predicate about a wire body, and citing "presentation only" as the reason
 * would be a rule this file's own precedent breaks. Promote this the first
 * time a second consumer appears.
 *
 * Throwing is the whole mechanism: each caller already has a `catch` that sets
 * the error state, so refusing the body here routes it to the unknown arm the
 * page already renders. No caller learns a new failure mode.
 */
export function requireRows<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`malformed ${what} payload`);
  }
  return value as T[];
}

// ---------------------------------------------------------------------------
// Cognito group-name validation (mirrors the backend, next to the input)
// ---------------------------------------------------------------------------
//
// Cognito constrains `groupName` to `[\p{L}\p{M}\p{S}\p{N}\p{P}]+`, which
// excludes whitespace — so `test admins` is rejected. The backend now answers
// that with a 400 naming the reason (web #1099 for create; its follow-up for
// delete / list-members / add-member / remove-member). This is the layer in
// front of that: the operator should never have to make a network round-trip,
// or read an HTTP status, to learn that a space is not allowed.
//
// `\p{…}` escapes need the `u` flag, which is why this regex can say exactly
// what AWS says rather than approximating it.

const COGNITO_GROUP_NAME_RE = /^[\p{L}\p{M}\p{S}\p{N}\p{P}]+$/u;
const COGNITO_GROUP_NAME_MAX = 128;

/**
 * Why `name` cannot be a Cognito group name, as a sentence for a human — or
 * `null` when it can.
 *
 * Deliberately NOT the regex itself. The tenant-slug field one card up prints
 * `Must match ^[a-z0-9][a-z0-9-]{0,63}$`, which is a machine constraint pasted
 * into a human sentence; an operator reading it still has to work out what
 * they typed wrong. Mirrors the backend's `invalid_group_name_reason` in the
 * same order, so the two layers never disagree about which rule bit.
 */
export function groupNameProblem(name: string): string | null {
  if (!name) return "A group name is required.";
  if (name.length > COGNITO_GROUP_NAME_MAX) {
    return `Group names are at most ${COGNITO_GROUP_NAME_MAX} characters.`;
  }
  if (COGNITO_GROUP_NAME_RE.test(name)) return null;
  if (/\s/.test(name)) return "Group names can't contain spaces.";
  return "Group names can't contain spaces or control characters.";
}

/**
 * A valid name derived from `name`, or `null` when there is nothing to offer.
 *
 * Offered as a one-click fix rather than printed as advice: the operator's
 * intent (`test admins`) is unambiguous, and retyping it is work the page can
 * simply do.
 */
export function suggestGroupName(name: string): string | null {
  const fixed = name
    // Every character Cognito rejects is whitespace or a control character,
    // so one class covers the whole complement.
    .replace(/[\s\p{C}]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COGNITO_GROUP_NAME_MAX);
  if (!fixed || fixed === name || groupNameProblem(fixed) !== null) return null;
  return fixed;
}
