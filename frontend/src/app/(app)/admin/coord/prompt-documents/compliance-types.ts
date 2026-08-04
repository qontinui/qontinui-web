/**
 * Session-compliance enforcement — shared types (plan
 * `2026-07-30-session-compliance-report-enforcement.md`, Part B).
 *
 * `policy/session-protocol` Step 3 requires every session to close with a
 * POLICY_COMPLIANCE block: each enumerated item marked landed / in-train /
 * gated / deferred / surfaced, plus the clauses applied and the gaps found.
 *
 * Three components, three homes: **the runner executes** the check (a turn-end
 * hook bundled in the runner binary and installed by it), **coord configures**
 * and reconciles what the block claims against what coord independently
 * observed (PRs landed, gates still open), storing one verdict per session in
 * `coord.session_compliance`, and **qontinui-web controls** — this page is the
 * only operator surface for any of it.
 *
 * Coverage is bounded by who does the executing: the runner sees only the
 * sessions IT spawned. Sessions started by hand in an external terminal, on
 * another machine, or under a different runner instance are outside the check
 * entirely — and are invisible to it rather than counted as uncovered. The UI
 * states that flatly and never derives it from a runner-side metric, which
 * would be computed over the runner's own process subtree and so would report
 * full coverage of a partial world.
 *
 * These mirror the coord `/coord/session-compliance/*` contract, forwarded 1:1
 * by the web backend under `/api/v1/operations/coord/session-compliance/*`:
 * reads are visible to any tenant member; the config PUT is tenant-admin-gated
 * and coord stamps the editor from its own authenticated operator context.
 *
 * Two honest bounds the UI must preserve rather than paper over:
 *   1. Nothing observable proves a session READ the policy. The check proves a
 *      report exists and reconciles — never comprehension.
 *   2. Reconciliation is partial. `deferred`/`surfaced` items are shape-checked
 *      only, and gate attribution may be `none` or `heuristic`. A heuristic
 *      attribution is never rendered as a confirmed one.
 */

/* ------------------------------------------------------------------------- *
 * Enforcement config
 * ------------------------------------------------------------------------- */

/**
 * What the check does when a session ends a turn without a valid report.
 *
 * `nudge` acts inside the still-live session (the runner's turn-end hook feeds
 * the correction back into that same session); `reopen` starts a fresh session
 * against an already-closed one, which outlives the original request and so is
 * opt-in.
 */
export type SessionComplianceMode = "nudge" | "reopen";

export const SESSION_COMPLIANCE_MODES: readonly SessionComplianceMode[] = [
  "nudge",
  "reopen",
] as const;

export const MODE_META: Record<
  SessionComplianceMode,
  { label: string; description: string }
> = {
  nudge: {
    label: "Nudge the session at the end of its turn",
    description:
      "The session is still alive, so it is asked — inside the same session — to produce the missing report, with coord's observations attached so the answer can be reconciled rather than guessed.",
  },
  reopen: {
    label: "Reopen the session afterwards",
    description:
      "The session has already closed, so a new one is started to write the report. This spawns work that outlives your request, and costs tokens on your account.",
  },
};

/**
 * Why enforcement is or is not currently in force. **Derived by coord**, never
 * configured: coord checks whether `enforced_clause_ref` is actually present in
 * the ACTIVE version of the prompt document it names. Edit the clause out and
 * enforcement goes inert on its own, instead of drifting into enforcing a rule
 * the fleet is no longer served.
 */
export type ApplicabilityReason =
  | "applicable"
  | "enforcement_disabled"
  | "clause_absent"
  | "document_missing";

/**
 * The single description of what coord does when the check is NOT applicable —
 * enforcement switched off, or the named clause absent from the active document.
 *
 * It is a shared constant because this page used to state the same behaviour
 * twice, independently: once in {@link APPLICABILITY_META}.`enforcement_disabled`
 * and once in {@link VERDICT_META}.`not_applicable`. They drifted into flatly
 * contradicting each other — one claimed coord "still reconciles", the other
 * that "nothing was checked" — and a reader had no way to tell which was true.
 *
 * Coord's own code settles it. `applicable = !disabled && via.is_some()`, and a
 * false `applicable` short-circuits ahead of reconciliation, writing an empty
 * `items` array with the note "no claim was reconciled". So: the session is
 * recorded, and nothing in it is checked.
 *
 * Both surfaces compose this string, so the next correction lands in one place
 * or not at all.
 */
export const NOT_APPLICABLE_BEHAVIOUR =
  "coord records the session but reconciles none of its claims against what it independently observed";

/** Plain-language rendering of each reason, for an operator who has read no plan. */
export const APPLICABILITY_META: Record<
  ApplicabilityReason,
  { label: string; detail: string }
> = {
  applicable: {
    label: "Enforcing",
    detail:
      "The clause below is present in the active version of its document, so sessions are being checked.",
  },
  enforcement_disabled: {
    label: "Recording only — sessions are logged, their claims are not checked",
    detail:
      `Sessions still reach coord and still appear in the table below, so you can see who ran and read what they reported. What is not happening is the verification: ${NOT_APPLICABLE_BEHAVIOUR}, which is why those rows show "—" for unconfirmed claims rather than a count — there is no count, because nothing was examined. No session is asked for a report it skipped either. Switch this on to start reconciling and asking.`,
  },
  clause_absent: {
    label: "Inert — clause not in the active document",
    detail:
      "Enforcement is on, but the clause it names is not in the active version of that prompt document. Sessions are never asked to follow a rule they aren't served, so the check does nothing until the clause is restored or the setting points at a clause that exists.",
  },
  document_missing: {
    label: "Inert — document not found",
    detail:
      "Enforcement is on, but the prompt document the clause belongs to doesn't exist for this tenant. Nothing is being checked.",
  },
};

/**
 * How coord found (or failed to find) the named clause in the active document.
 *
 * This distinguishes the two things a `clause_absent` verdict can mean, and the
 * difference matters: a genuinely-absent clause SHOULD inert the check, but a
 * lookup that merely failed would silently disable the whole mechanism while
 * looking identical. `registry` = matched a structured `coord.policy_clauses`
 * row; `body_heading` = matched a `## clause: <id>` heading in the document
 * prose; `null` = neither lookup resolved it.
 */
export type ClauseResolvedVia = "registry" | "body_heading" | null;

export const CLAUSE_RESOLVED_VIA_LABEL: Record<
  "registry" | "body_heading" | "unresolved",
  string
> = {
  registry: "matched a structured clause row",
  body_heading: "matched a clause heading in the document body",
  unresolved: "no clause row and no clause heading matched",
};

/**
 * The clause the check enforces out of the box — the operator's "work-to-0"
 * clause. It lives in `policy/planning-and-scope`, which carries the
 * `## clause: finish-to-zero` heading; `policy/session-protocol` Step 3 is the
 * requirement being enforced (emit the POLICY_COMPLIANCE footer) but uses
 * `## Step N` headings, so it is not the applicability anchor.
 */
export const DEFAULT_ENFORCED_CLAUSE_REF =
  "policy/planning-and-scope#finish-to-zero";

/** `GET /coord/session-compliance/config`. */
export interface SessionComplianceConfig {
  /** The switch. */
  enabled: boolean;
  mode: SessionComplianceMode;
  /** How many times one session may be corrected before the check gives up. */
  max_attempts: number;
  /** e.g. `policy/planning-and-scope#finish-to-zero`. `null` ⇒ nothing named. */
  enforced_clause_ref: string | null;
  /** DERIVED — whether the check is actually in force right now. */
  applicable: boolean;
  /** DERIVED — why (see {@link APPLICABILITY_META}). */
  applicability_reason: ApplicabilityReason;
  /** DERIVED — which lookup resolved the clause (see {@link ClauseResolvedVia}). */
  clause_resolved_via?: ClauseResolvedVia;
  /** The prompt-document version the applicability check was made against. */
  prompt_document_version: number | null;
  /** The CONFIG row's own version — bumped on every settings change. */
  current_version: number;
  updated_by?: string | null;
  updated_at?: string | null;
  /**
   * Coord's honest note that the compliance store is not provisioned yet (the
   * window where coord is live ahead of its migration). Present ⇒ absent data
   * means "cannot see", not "nothing happened".
   */
  degraded?: string | null;
}

/** `PUT /coord/session-compliance/config` body. Every field optional. */
export interface SessionComplianceConfigUpdate {
  enabled?: boolean;
  mode?: SessionComplianceMode;
  enforced_clause_ref?: string | null;
  max_attempts?: number;
  /** Recorded on the new config version — "why did this change". */
  change_note?: string;
}

/** One immutable config-version row (`GET …/config/versions`). */
export interface SessionComplianceConfigVersion {
  version_number: number;
  enabled: boolean;
  mode: SessionComplianceMode;
  max_attempts: number;
  enforced_clause_ref: string | null;
  /** The note recorded at change time. */
  change_note: string | null;
  edited_by: string | null;
  created_at: string;
}

/** `GET /coord/session-compliance/config/versions` response. */
export interface ListConfigVersionsResponse {
  versions: SessionComplianceConfigVersion[];
  current_version?: number;
  total?: number;
  degraded?: string | null;
}

/* ------------------------------------------------------------------------- *
 * Per-session verdicts
 * ------------------------------------------------------------------------- */

/**
 * **Three verdicts, never two — and never four.**
 *
 * A session that emitted no report at all is `unverified` carrying reason
 * `absent`, NOT a separate "no report" state: the UI should never have to
 * explain the difference between "no report" and "bad report" as different
 * kinds of thing.
 */
export type ComplianceVerdict = "verified" | "unverified" | "not_applicable";

export const COMPLIANCE_VERDICTS: readonly ComplianceVerdict[] = [
  "verified",
  "unverified",
  "not_applicable",
] as const;

export const VERDICT_META: Record<
  ComplianceVerdict,
  {
    label: string;
    variant: "success" | "warning" | "secondary";
    detail: string;
  }
> = {
  verified: {
    label: "Verified",
    variant: "success",
    detail:
      "A report was emitted and every claim coord can check was confirmed against what coord independently observed.",
  },
  unverified: {
    label: "Unverified",
    variant: "warning",
    detail:
      "Either no report was emitted, or at least one claim in it could not be confirmed — or was contradicted by what coord observed.",
  },
  not_applicable: {
    label: "Not applicable",
    variant: "secondary",
    detail:
      `Enforcement was off for this session, or the clause it names was absent from the active document, so ${NOT_APPLICABLE_BEHAVIOUR}. This is the absence of a check, not a clean result.`,
  },
};

/** The lifecycle state a report claims for one enumerated item. */
export type ComplianceItemState =
  | "landed"
  | "in_train"
  | "gated"
  | "deferred"
  | "surfaced";

export const ITEM_STATE_LABEL: Record<ComplianceItemState, string> = {
  landed: "Landed",
  in_train: "In train",
  gated: "Gated",
  deferred: "Deferred",
  surfaced: "Surfaced",
};

/**
 * What coord's reconciliation could actually establish about one claim.
 *
 * `shape_checked` is the load-bearing honest one: `deferred` and `surfaced`
 * items are not machine-checkable, so coord only confirms a non-empty reason
 * was given. That is NOT the same as confirming the claim, and the UI says so.
 */
export type ReconcileResult =
  | "confirmed"
  | "unconfirmed"
  | "contradicted"
  | "shape_checked";

export const RECONCILE_RESULT_META: Record<
  ReconcileResult,
  { label: string; variant: "success" | "warning" | "destructive" | "outline" }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  unconfirmed: { label: "Unconfirmed", variant: "warning" },
  contradicted: { label: "Contradicted", variant: "destructive" },
  shape_checked: { label: "Shape-checked only", variant: "outline" },
};

/**
 * How a gate claim was tied back to the session that made it.
 *
 * `session` is a real captured session id. `heuristic` is coord's
 * most-recent-active-session bridge, which attributes the wrong parent under
 * concurrent sessions — this fleet's normal state — so it must never be
 * displayed as a confirmed attribution, and never promotes a claim to
 * `verified`. `none` means the gate exists but nothing ties it to this session.
 */
export type GateAttribution = "session" | "heuristic" | "none";

export const ATTRIBUTION_META: Record<
  GateAttribution,
  { label: string; detail: string }
> = {
  session: {
    label: "Session-attributed",
    detail: "The gate records the session that registered it.",
  },
  heuristic: {
    label: "Guessed, not proven",
    detail:
      "Coord matched this gate to the session by recency, not by a recorded link. Under concurrent sessions that can name the wrong one, so it is not treated as proof.",
  },
  none: {
    label: "Not attributed",
    detail:
      "The gate exists, but nothing links it to this session — gates did not record an originating session when it was registered.",
  },
};

/** One item as the session REPORTED it. */
export interface ComplianceReportItem {
  ref: string;
  state: ComplianceItemState;
  /** Free-form, e.g. `{pr, sha, gate_id}`. */
  evidence?: Record<string, unknown> | null;
  /** The stated reason — required for `deferred`/`surfaced`. */
  reason?: string | null;
}

/** The parsed POLICY_COMPLIANCE block. */
export interface ComplianceReport {
  schema?: string;
  items?: ComplianceReportItem[];
  clauses_applied?: { id: string; for?: string }[];
  policy_gaps?: unknown[];
  escalations?: unknown[];
  declined?: unknown[];
  [key: string]: unknown;
}

/** Coord's verdict on one reported item. */
export interface ReconciliationItem {
  ref: string;
  state: ComplianceItemState;
  result: ReconcileResult;
  /** Present for gate claims. */
  attribution?: GateAttribution | null;
  gate_id?: string | null;
  /** Prose detail from coord, e.g. "PR landed 2026-07-29; sha on main". */
  detail?: string | null;
  /** The independent signals coord matched, when it names them. */
  signals?: string[] | null;
}

/** Coord's reconciliation of one report. */
export interface Reconciliation {
  items?: ReconciliationItem[];
  /** Coord's own count, preferred over the client-side derivation when present. */
  unreconciled_count?: number;
  /** `absent` when no block was emitted at all. */
  reason?: string | null;
}

/**
 * One `coord.session_compliance` row.
 *
 * A verdict is written at **turn end** and rewritten as the session goes on
 * (last-write-wins), then finalized when the session closes. So a row is a
 * running snapshot until `finalized` is true — an unverified mid-session
 * verdict may simply mean the session hasn't got to that work yet, which is a
 * very different thing from a session that closed without doing it.
 */
export interface SessionComplianceRow {
  id: string;
  claude_session_id: string;
  verdict: ComplianceVerdict;
  /** e.g. `absent` — why the verdict is what it is. */
  reason?: string | null;
  report?: ComplianceReport | null;
  reconciliation?: Reconciliation | null;
  prompt_document_version?: number | null;
  checked_at: string;
  /**
   * True once the session closed and this verdict stopped moving. Absent ⇒
   * coord isn't carrying the distinction, and the UI says nothing either way
   * rather than guessing "final".
   */
  finalized?: boolean | null;
}

/** `GET /coord/session-compliance/sessions` response. */
export interface ListComplianceSessionsResponse {
  sessions: SessionComplianceRow[];
  next_cursor?: string | null;
  total?: number;
  degraded?: string | null;
}

/* ------------------------------------------------------------------------- *
 * Outstanding-work ledger
 * ------------------------------------------------------------------------- */

/** The two states that mean "not finished": everything the ledger collects. */
export type OutstandingState = Extract<
  ComplianceItemState,
  "deferred" | "gated"
>;

export const OUTSTANDING_STATES: readonly OutstandingState[] = [
  "deferred",
  "gated",
] as const;

/**
 * One unfinished item, as reported by some session.
 *
 * The ledger is the first place the fleet's unfinished work is queryable at
 * all — today it lives scattered across plan files. It is a ledger of what
 * sessions REPORTED, not an independent inventory of everything undone, and the
 * surface says so.
 */
export interface OutstandingItem {
  claude_session_id: string;
  /** When the session's report was checked — the ledger's sort key. */
  checked_at: string;
  ref: string;
  state: OutstandingState;
  /** The stated reason (deferred items) — coord shape-checks it is non-empty. */
  reason?: string | null;
  /** The gate this item is parked behind (gated items). */
  gate_id?: string | null;
  /** Coord's gate lookup, e.g. `open` / `closed` / `unknown`. */
  gate_status?: string | null;
  /** Whether the gate is tied to this session, guessed, or not tied at all. */
  attribution?: GateAttribution | null;
  /** Coord's reconciliation verdict for this item, when it reconciled one. */
  result?: ReconcileResult | null;
  /** Free-form detail from coord. */
  detail?: string | null;
}

/** `GET /coord/session-compliance/outstanding` response. */
export interface ListOutstandingResponse {
  items: OutstandingItem[];
  total?: number;
  degraded?: string | null;
}

/* ------------------------------------------------------------------------- *
 * Derivations
 * ------------------------------------------------------------------------- */

/**
 * How many claims in a session's report coord could NOT confirm.
 *
 * Prefers coord's own count. Falling back, it counts only `unconfirmed` and
 * `contradicted` — a `shape_checked` item is not an unreconciled claim, it is a
 * claim that was never machine-checkable, and inflating the count with those
 * would make every honest report look broken.
 */
export function unreconciledCount(row: SessionComplianceRow): number {
  const rec = row.reconciliation;
  if (typeof rec?.unreconciled_count === "number") {
    return rec.unreconciled_count;
  }
  return (rec?.items ?? []).filter(
    (i) => i.result === "unconfirmed" || i.result === "contradicted"
  ).length;
}

/** Items coord could only shape-check — surfaced separately, never as proof. */
export function shapeCheckedCount(row: SessionComplianceRow): number {
  return (row.reconciliation?.items ?? []).filter(
    (i) => i.result === "shape_checked"
  ).length;
}

/**
 * True when the session emitted no POLICY_COMPLIANCE block at all.
 *
 * Deliberately keyed ONLY on coord's explicit `absent` reason. A missing
 * `report` field is NOT evidence of a missing report: these rows come from the
 * list route, and a list projection that omits the report JSONB (exactly what
 * the sibling prompt-document list does with bodies) would otherwise make every
 * unverified session render "no report emitted". Fabricating absence is the
 * failure this whole feature exists to prevent, so absence must be asserted by
 * coord, never inferred from a field the projection may simply not carry.
 */
export function isReportAbsent(row: SessionComplianceRow): boolean {
  return row.reason === "absent" || row.reconciliation?.reason === "absent";
}

/**
 * True when coord filed a verdict without examining a single claim.
 *
 * These rows carry an empty `items` array, so {@link unreconciledCount} derives
 * `0` from them — and `0` is exactly what a perfectly clean reconciliation
 * looks like. Rendering the numeral would make an unexamined session
 * indistinguishable from a verified one, which is the same failure as
 * fabricating absence and is worse here, because it errs toward reassurance.
 *
 * Keyed on the verdict coord explicitly wrote, never inferred from an empty
 * `items` array — a list projection that omits `reconciliation` would otherwise
 * mark every row unexamined. See {@link NOT_APPLICABLE_BEHAVIOUR} for what
 * coord actually did.
 */
export function isUnexamined(row: SessionComplianceRow): boolean {
  return row.verdict === "not_applicable";
}

/**
 * How to badge one reconciled claim, given how it was attributed.
 *
 * A `heuristic` attribution is coord's most-recent-active-session guess, which
 * names the wrong parent under concurrent sessions; `none` means nothing ties
 * the evidence to this session at all. Neither may wear the green "Confirmed"
 * chip — that is the difference between evidence and a plausible story. The
 * result coord reported is still shown, qualified, rather than silently
 * downgraded to something coord did not say.
 *
 * Also the single place an unrecognised result is handled: it renders as
 * itself, never collapsing into "Not checked", which is a different claim.
 */
export function resultBadge(
  result: ReconcileResult,
  attribution?: GateAttribution | null
): { label: string; variant: "success" | "warning" | "destructive" | "outline" } {
  const meta = RECONCILE_RESULT_META[result] ?? {
    label: result,
    variant: "outline" as const,
  };
  if (meta.variant !== "success") return meta;
  if (attribution === "heuristic") {
    return { label: "Confirmed — attribution guessed", variant: "outline" };
  }
  if (attribution === "none") {
    return { label: "Confirmed — not attributed", variant: "outline" };
  }
  return meta;
}
