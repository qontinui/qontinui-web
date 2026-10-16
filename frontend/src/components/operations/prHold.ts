/**
 * prHold — the pure half of `PrHoldControl`: the coord hold contract as the
 * console reads it, and the derivations the control renders from.
 *
 * Plan `2026-10-04-coord-pr-hold-without-github-drafts` (D1, D4, D6, Phase 4).
 * coord's hold is coord state (`coord.pr_holds`), not GitHub's draft flag, so
 * it works on GitHub Free private repos, where drafts do not exist.
 *
 * ## The wire contract (`GET /pr-merge/prs`, one row per PR)
 *
 * - `hold` is ALWAYS serialized by a coord that knows about holds:
 *   - an object `{held_by, reason, kind, since, hold_id?, gate_id?}` — held;
 *   - `null` — coord read `coord.pr_holds` and the PR is not held.
 * - `hold_unknown: true` — coord's hold read FAILED. `hold` is `null` beside
 *   it, and that `null` means "cannot tell", never "not held".
 * - The `hold` KEY ABSENT — a coord build that predates holds. Also UNKNOWN.
 *
 * Another tenant's hold renders `held_by: "another_tenant"` with its reason,
 * kind and ids withheld; it still blocks the PR (a GitHub repo is shared), and
 * this console cannot release it.
 *
 * An UNKNOWN hold state renders amber `–` (console style guide R3, "amber also
 * covers we do not know"), never "not held": painting it calm would assert the
 * PR is free to land, which is exactly what we do not know.
 */

/** One active hold, as coord serves it. */
export interface PrHold {
  held_by: string;
  reason: string;
  kind: string;
  /** RFC3339; null for a hold coord has no placement time for. */
  since: string | null;
  hold_id?: string;
  gate_id?: string;
}

/** The two hold fields a `/pr-merge/prs` row may carry. */
export interface PrHoldFields {
  hold?: PrHold | null;
  hold_unknown?: boolean;
}

/** `held_by` coord serves for a hold placed by another tenant. */
export const ANOTHER_TENANT = "another_tenant";

export type HoldView =
  | { state: "unknown"; why: string }
  | { state: "not_held" }
  | { state: "held"; hold: PrHold; foreign: boolean };

function isHoldObject(v: unknown): v is PrHold {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.held_by === "string" &&
    typeof r.reason === "string" &&
    typeof r.kind === "string"
  );
}

/**
 * Read a row's hold state. PURE.
 *
 * Fails toward UNKNOWN on every shape it does not recognise: an absent key, a
 * failed read, and a `hold` that is neither `null` nor a well-formed object.
 */
export function holdViewOf(row: PrHoldFields): HoldView {
  if (row.hold_unknown === true) {
    return {
      state: "unknown",
      why: "coord could not read this PR's hold state",
    };
  }
  if (!("hold" in row) || row.hold === undefined) {
    return {
      state: "unknown",
      why: "this coord build does not report hold state",
    };
  }
  if (row.hold === null) return { state: "not_held" };
  if (!isHoldObject(row.hold)) {
    return {
      state: "unknown",
      why: "coord sent a hold this build cannot read",
    };
  }
  return {
    state: "held",
    hold: { ...row.hold, since: row.hold.since ?? null },
    foreign: row.hold.held_by === ANOTHER_TENANT,
  };
}

/**
 * Plain-language name for a hold kind (style guide R8). An unrecognised kind
 * renders its own id — a real fact — rather than a friendly placeholder.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  manual: "manual",
  security_tier: "security review",
  migration_order: "waiting on a migration",
  create: "held at creation",
  coord_proposal: "coord's own proposal",
};

export function holdKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Plain-language name for the holder. coord's actor keys look like
 * `operator:<uuid>`, `agent:<uuid>`, `device:<uuid>`, `coord`.
 */
export function holderLabel(heldBy: string): string {
  if (heldBy === ANOTHER_TENANT) return "another tenant";
  if (heldBy === "coord") return "coord";
  const colon = heldBy.indexOf(":");
  if (colon > 0) {
    const who = heldBy.slice(0, colon);
    const id = heldBy.slice(colon + 1);
    return `${who} ${id.slice(0, 8)}`;
  }
  return heldBy;
}

/** Whether this console can offer Release for a hold. */
export function canOfferRelease(view: HoldView): boolean {
  // Another tenant's hold is not ours to release, and coord would refuse it.
  return view.state === "held" && !view.foreign;
}

/**
 * Turn a failed hold response into a human line.
 *
 * The proxy returns coord's `{error, message}` body verbatim, and the codes
 * mean different things (`not_holder` vs `security_tier_operator_only` vs
 * `not_found` vs `invalid_input`), so collapsing them into `HTTP <status>`
 * leaves the operator unable to tell why. Falls back to the raw body, then to
 * the bare status, so an unparseable or empty response still says something
 * true.
 */
export function describeHoldError(status: number, body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.trim() ? `HTTP ${status} — ${body.trim()}` : `HTTP ${status}`;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return body.trim() ? `HTTP ${status} — ${body.trim()}` : `HTTP ${status}`;
  }
  const rec = parsed as Record<string, unknown>;
  // The proxy nests coord's body under `detail` for some error classes.
  const inner =
    typeof rec.detail === "object" && rec.detail !== null
      ? (rec.detail as Record<string, unknown>)
      : rec;
  const code = typeof inner.error === "string" ? inner.error : null;
  const message =
    typeof inner.message === "string"
      ? inner.message
      : typeof inner.detail === "string"
        ? inner.detail
        : null;
  const parts: string[] = [`HTTP ${status}`];
  if (code) parts.push(code);
  if (message) parts.push(message);
  return parts.join(" — ");
}

/**
 * Split `owner/name` into its two halves. Returns null for anything that is
 * not a two-part slug, so a malformed repo string renders no control rather
 * than POSTing to a nonsense path.
 */
export function splitOwnerRepo(repo: string): [string, string] | null {
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash >= repo.length - 1) return null;
  if (repo.indexOf("/", slash + 1) !== -1) return null;
  return [repo.slice(0, slash), repo.slice(slash + 1)];
}
