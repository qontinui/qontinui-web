/**
 * The project-name → slug preview: coord's rule, mirrored for the eye only.
 *
 * Plan `2026-08-27-tenant-creation-fix-and-members-page-ux`, Phase 1 #7 — the
 * one Phase 1 item that was genuinely unbuilt. `CoordProjectCreateDialog`
 * shows the derived slug only AFTER creation, which is exactly too late to be
 * an affordance: coord's contract is **reject, never mangle**
 * (`My Pizzeria!` → `my-pizzeria`, `...` → `400 invalid_name`), and a contract
 * the user meets only by failing is a surprise rather than a design.
 *
 * ## This is a MIRROR, and the mirror is the risk
 *
 * The rule lives in Rust — `slugify_user_tenant_name`, qontinui-coord
 * `crates/coord/src/tenant_self_service.rs` — and a second implementation of a
 * validation rule is the thing this plan's own Defect-2 fix and
 * `TenantCreateIn`'s docstring both warn against. Two things contain that:
 *
 *  1. **It is pinned by data, not by eyeball.** Every case in
 *     `projectSlug.fixtures.json` is transcribed from coord's own
 *     `slugify_rejects_rather_than_mangles` test, in a language-neutral file
 *     coord could later read too.
 *  2. **It has no authority.** Nothing here gates submit. The dialog still
 *     posts the name exactly as typed and lets coord answer — which is the
 *     documented decision in `CoordProjectCreateDialog`'s own header ("this
 *     form does not pre-slugify, does not 'clean up' what was typed"), and a
 *     client-side veto would quietly reverse it. A mirror that drifts too
 *     STRICT would then make a legitimate name unusable with no way through;
 *     a mirror that drifts too LAX costs one round-trip and coord's honest
 *     error. Only the second failure is acceptable, so the design admits only
 *     the second.
 *
 * ## And it must never claim the name is AVAILABLE
 *
 * Derivation is all that can be mirrored. The other two ways coord rejects a
 * name are structurally unmirrorable: `reserved_slug_reason` reads
 * `COORD_SSO_DEFAULT_TENANT` (coord deployment config) and `slug_is_group_mapped`
 * is a DB read inside the create transaction. So a preview may say *what the id
 * would be*, never *that you can have it*.
 */

/**
 * `TenantNameError::reason()` verbatim — the discriminator coord puts on the
 * wire beside `invalid_name`, so a preview rejection and the server rejection
 * that follows it can be recognised as the same answer.
 */
export type ProjectSlugReason =
  | "empty"
  | "display_name_too_long"
  | "no_slug_characters"
  | "too_short"
  | "too_long"
  | "must_start_with_letter_or_digit";

export type ProjectSlugResult =
  | { ok: true; slug: string }
  | { ok: false; reason: ProjectSlugReason };

/** `MIN_SLUG_LEN` (coord). */
export const MIN_SLUG_LEN = 3;
/** `MAX_SLUG_LEN` (coord). */
export const MAX_SLUG_LEN = 63;
/**
 * `MAX_DISPLAY_NAME_CHARS` (coord). Deliberately NOT the dialog's own
 * `maxLength`, which is the web proxy's stricter 120 (`TenantCreateIn`); this
 * constant exists so the mirror reproduces coord's ORDER of checks, in which
 * the display-name gate runs before slugification.
 */
export const MAX_DISPLAY_NAME_CHARS = 200;

/**
 * Derive the slug coord would derive, or the reason coord would refuse.
 *
 * Mirrors `slugify_user_tenant_name` step for step, checks in the same order:
 * trim → non-empty → display-name length → lowercase → every non-`[a-z0-9]`
 * char becomes `-` → runs collapse → strip leading/trailing `-` → non-empty →
 * `MIN_SLUG_LEN..=MAX_SLUG_LEN` → starts `[a-z0-9]`.
 *
 * The order is load-bearing, not incidental: a 201-character name of `a`s is
 * `display_name_too_long`, while a 200-character one is `too_long`. Both are
 * in the fixture so a reordering cannot pass.
 */
export function slugifyProjectName(displayName: string): ProjectSlugResult {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  // Code points, matching Rust's `chars().count()` — `.length` would count a
  // surrogate pair twice and reject a name coord accepts.
  if ([...trimmed].length > MAX_DISPLAY_NAME_CHARS) {
    return { ok: false, reason: "display_name_too_long" };
  }

  let slug = "";
  for (const ch of trimmed.toLowerCase()) {
    if (ch >= "a" && ch <= "z") {
      slug += ch;
    } else if (ch >= "0" && ch <= "9") {
      slug += ch;
    } else if (!slug.endsWith("-")) {
      // Collapse: append a separator only when the last emitted character was
      // not already one. A LEADING run emits a single `-` here and is stripped
      // below — the same two-step coord uses, and the reason `---lead` is
      // `lead` rather than a `must_start_with_letter_or_digit` rejection.
      slug += "-";
    }
  }
  slug = slug.replace(/^-+/, "").replace(/-+$/, "");

  if (slug.length === 0) return { ok: false, reason: "no_slug_characters" };
  if (slug.length < MIN_SLUG_LEN) return { ok: false, reason: "too_short" };
  if (slug.length > MAX_SLUG_LEN) return { ok: false, reason: "too_long" };
  if (!/^[a-z0-9]/.test(slug)) {
    // Unreachable — the strip above guarantees it. Kept because coord keeps
    // it: the rule is part of the contract, so it is asserted, not inferred.
    return { ok: false, reason: "must_start_with_letter_or_digit" };
  }
  return { ok: true, slug };
}

/**
 * Why the name cannot produce a short id, as a sentence for a human.
 *
 * Not the rule, and not the reason token. The members page one surface over
 * prints `Must match ^[a-z0-9][a-z0-9-]{0,63}$` at its slug field — a machine
 * constraint pasted into a human sentence, which this plan names as the
 * treatment NOT to copy. Each sentence below says what to do next instead.
 *
 * `empty` has no sentence: an untouched field is not an error, and the submit
 * button is already disabled there.
 */
export function projectSlugProblemMessage(
  reason: ProjectSlugReason
): string | null {
  switch (reason) {
    case "empty":
      return null;
    case "display_name_too_long":
      return "That name is too long.";
    case "no_slug_characters":
      return "That name has no letters or digits to build a short id from — add some.";
    case "too_short":
      return `A short id needs at least ${MIN_SLUG_LEN} letters or digits.`;
    case "too_long":
      return `A short id can be at most ${MAX_SLUG_LEN} characters — this name makes a longer one.`;
    case "must_start_with_letter_or_digit":
      return "A short id has to start with a letter or a digit.";
  }
}
