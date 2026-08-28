/**
 * Wire types + honesty vocabularies for the Claude Code Session Repository
 * (Phase 5 of `2026-08-26-claude-code-session-repository-in-qontinui-web`).
 *
 * Mirrors `backend/app/models/session_artifact.py` and the Phase 4 routes at
 * `/api/v1/session-repository`. Hand-written rather than generated, matching
 * the sibling `admin/coord/plan-library/types.ts` — the generated client
 * covers a different slice of the API surface.
 *
 * THREE of the vocabularies here are correctness machinery, not decoration.
 * Each exists to stop the UI collapsing a distinction the corpus paid for:
 *
 * 1. {@link SessionTenantSource} — a GUESSED tenant must never render like a
 *    DECLARED one (plan §3.6 rule 2: "a guessed tenant that renders
 *    identically to a declared one is the defect this column exists to
 *    prevent"). {@link isDeclaredTenant} is the single predicate every
 *    renderer asks; nothing else may re-spell it.
 * 2. {@link SessionBodySource} — a `coord_redacted` body's `content_sha256`
 *    was computed over REDACTED bytes and can never be verified against the
 *    session's original file (plan §5, "Two ingest paths, one digest").
 *    {@link digestClaim} is the only function allowed to say what a digest
 *    means.
 * 3. {@link RelaunchTier} — a relaunch and an account transfer are DIFFERENT
 *    operations (plan §3.5). Claude Code cannot resume another account's
 *    session id, so a transfer is replay-as-context into a NEW session.
 *    {@link resolveRelaunchTier} derives which one a given target implies;
 *    a UI that renders them alike silently loses state.
 */

// ───────────────────────────── tenancy (plan §3.6) ─────────────────────────

export const SESSION_TENANT_SOURCES = [
  "declared",
  "derived_repo",
  "derived_sole_binding",
  "ambiguous",
  "unknown",
] as const;

export type SessionTenantSource = (typeof SESSION_TENANT_SOURCES)[number];

/**
 * Short chip text. Every non-`declared` label states its own weakness in the
 * label itself — "guessed", "ambiguous", "unknown" — so the word survives a
 * screenshot, a colour-blind reader and a monochrome print.
 */
export const TENANT_SOURCE_LABELS: Record<SessionTenantSource, string> = {
  declared: "Tenant declared",
  derived_repo: "Tenant guessed (repo)",
  derived_sole_binding: "Tenant guessed (sole binding)",
  ambiguous: "Tenant ambiguous",
  unknown: "Tenant unknown",
};

/** The long form, for tooltips and the detail header. */
export const TENANT_SOURCE_EXPLANATIONS: Record<SessionTenantSource, string> = {
  declared:
    "The tenant was passed explicitly as spawn input. This is the only source that is an assertion rather than an inference.",
  derived_repo:
    "GUESSED. Nobody declared a tenant; it was derived by matching the session's repo against the device's tenant bindings. It may be wrong.",
  derived_sole_binding:
    "GUESSED. Nobody declared a tenant; the device was bound to exactly one, so that one was recorded. An interactive Claude Code pane never declares a tenant, so this is the normal source for one — it is still a derivation.",
  ambiguous:
    "NOT ESTABLISHED. More than one tenant matched and no rule picks between them. The tenant shown, if any, is one candidate — not a conclusion.",
  unknown:
    "NOT ESTABLISHED. No attribution was attempted, or every source was empty. This is unknown, not 'no tenant'.",
};

/**
 * The single predicate for "is this attribution an assertion?".
 *
 * Everything else — chip variant, icon, whether the tenant id is allowed to
 * render as a plain value — is derived from this one call so the four weak
 * sources can never drift apart into "some of them look declared".
 */
export function isDeclaredTenant(source: string): boolean {
  return source === "declared";
}

/** Render an unrecognised source as itself rather than as blank. */
export function tenantSourceLabel(source: string): string {
  return (
    TENANT_SOURCE_LABELS[source as SessionTenantSource] ??
    `Tenant source: ${source}`
  );
}

export function tenantSourceExplanation(source: string): string {
  return (
    TENANT_SOURCE_EXPLANATIONS[source as SessionTenantSource] ??
    `Unrecognised attribution source "${source}". Treat it as NOT established — this UI does not know what it asserts.`
  );
}

// ──────────────────── body provenance + digest (plan §5) ───────────────────

export const SESSION_BODY_SOURCES = ["disk_verbatim", "coord_redacted"] as const;

export type SessionBodySource = (typeof SESSION_BODY_SOURCES)[number];

/**
 * What a row's `content_sha256` actually claims.
 *
 * `verified` is reserved for a digest that CAN be checked against the
 * session's original on-disk file. A `coord_redacted` body went through
 * coord's unconditional redaction sweep on the way in, so its digest
 * describes the stored bytes and nothing else — presenting it as a verified
 * digest is the defect `body_source` exists to prevent.
 */
export type DigestClaimKind =
  | "verifiable"
  | "unverifiable_redacted"
  | "no_body"
  | "provenance_unknown";

export interface DigestClaim {
  kind: DigestClaimKind;
  /** Chip text. Short, and never the bare word "verified" when it isn't. */
  label: string;
  /** The full sentence a reader needs before trusting the digest. */
  detail: string;
}

/**
 * The ONLY place that decides what a digest means. Both the list row and the
 * detail header call it, so the two can never disagree in the same viewport.
 */
export function digestClaim(
  bodySource: string | null,
  contentSha256: string | null
): DigestClaim {
  if (!contentSha256) {
    return {
      kind: "no_body",
      label: "Metadata only — no archived body",
      detail:
        "This row records that the session existed; its transcript bytes were never uploaded. There is nothing to export and nothing to replay.",
    };
  }
  if (bodySource === "disk_verbatim") {
    return {
      kind: "verifiable",
      label: "sha256 over the verbatim file",
      detail:
        "The archived body is the session's JSONL byte for byte, as the runner read it off disk. This digest verifies against the original file.",
    };
  }
  if (bodySource === "coord_redacted") {
    return {
      kind: "unverifiable_redacted",
      label: "sha256 over REDACTED bytes — NOT verifiable",
      detail:
        "This body was recovered from coord's transcript stream, which redacts unconditionally on the way in. The digest describes the bytes stored here, not the session's original file, and cannot be checked against it. The export below is that redacted copy.",
    };
  }
  return {
    kind: "provenance_unknown",
    label: "sha256 of unknown provenance",
    detail:
      "A digest is recorded but the row does not say where its bytes came from, so this UI cannot say what the digest verifies against. Treat it as unverified.",
  };
}

/**
 * Does this UI's reading of `body_source` agree with the server's own
 * `digest_verifiable` flag?
 *
 * Both are derived from the same rule (`disk_verbatim` + a digest), so they
 * should never differ — and if they do, the honest move is to say so rather
 * than to pick the more reassuring one. Returns `null` when the server did
 * not state a flag.
 */
export function digestClaimAgreesWithServer(
  claim: DigestClaim,
  serverVerifiable: boolean | null | undefined
): boolean | null {
  if (serverVerifiable === null || serverVerifiable === undefined) return null;
  return (claim.kind === "verifiable") === serverVerifiable;
}

// ───────────────────────────── lifecycle ───────────────────────────────────

export const SESSION_STATES = ["open", "closed", "abandoned"] as const;
export type SessionArtifactState = (typeof SESSION_STATES)[number];

export const SESSION_CLOSEOUT_STATES = [
  "clean",
  "unfinished",
  "unknown",
] as const;
export type SessionCloseoutState = (typeof SESSION_CLOSEOUT_STATES)[number];

export const CLOSEOUT_LABELS: Record<SessionCloseoutState, string> = {
  clean: "Closed out",
  unfinished: "Never closed out",
  unknown: "Closeout unknown",
};

export const CLOSEOUT_EXPLANATIONS: Record<SessionCloseoutState, string> = {
  clean: "A compliance footer was emitted and reconciled against observed activity.",
  unfinished:
    "No footer, or an open gate, or an unlanded PR attributable to this session. Derived, never hand-set.",
  unknown:
    "Nobody has evaluated this session's closeout yet. This is unknown — NOT 'finished'.",
};

export function closeoutLabel(state: string): string {
  return CLOSEOUT_LABELS[state as SessionCloseoutState] ?? state;
}

export function closeoutExplanation(state: string): string {
  return (
    CLOSEOUT_EXPLANATIONS[state as SessionCloseoutState] ??
    `Unrecognised closeout state "${state}".`
  );
}

// ───────────────────────────── the head row ────────────────────────────────

/**
 * One archived session as the list route serves it. Every coord-side pointer
 * is nullable AND PERMITTED TO DANGLE — coord GCs closed sessions after 7
 * days, which is the whole reason this archive exists, so a null
 * `coord_session_id` is normal rather than an error.
 */
export interface SessionArtifactSummary {
  id: string;
  organization_id: string | null;
  claude_session_id: string;
  account_label: string | null;

  tenant_id: string | null;
  tenant_source: string;
  device_id: string | null;
  machine_hostname: string | null;

  coord_session_id: string | null;
  work_unit_slug: string | null;
  task_run_id: string | null;

  config_dir: string | null;
  working_dir: string | null;
  repo: string | null;
  git_branch: string | null;
  provider: string | null;
  launch_command: string | null;
  /** The runner's OBSERVED restore capability — `full` | `terminal_only` | … */
  restore_tier: string | null;
  machine_id: string | null;
  permission_mode: string | null;

  body_object_key: string | null;
  content_sha256: string | null;
  byte_count: number | null;
  turn_count: number | null;
  first_prompt: string | null;
  last_prompt: string | null;
  ai_title: string | null;
  session_name: string | null;
  name_source: string | null;
  body_source: string | null;

  started_at: string | null;
  last_activity_at: string | null;
  ended_at: string | null;
  state: string;
  closeout_state: string;

  secret_finding_count: number;
  /**
   * NULL and `[]` mean DIFFERENT things and must never be collapsed: NULL is
   * "the detector never ran over this row", `[]` is "it ran and found
   * nothing". See `session_artifact.py`.
   */
  secret_finding_kinds: string[] | null;

  created_at: string;
  updated_at: string;
}

export interface SessionArtifactListResponse {
  items: SessionArtifactSummary[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * `GET /unfinished`.
 *
 * `unknown_count` is reported BESIDE the results and never merged into them:
 * `closeout_state` defaults to `unknown` — "nobody has evaluated this
 * session" — so an empty `items` next to a large `unknown_count` means the
 * derivation has not run, which is a different fact from "everything was
 * closed out" and must not read like it.
 */
export interface SessionUnfinishedResponse extends SessionArtifactListResponse {
  unknown_count: number;
  clean_count: number;
  coord_outstanding: CoordSignal;
}

/**
 * A coord-owned signal, or an explicit statement that it is UNKNOWN.
 * "coord is down" and "coord says there is nothing" are different answers.
 */
export interface CoordSignal {
  available: boolean;
  unavailable_reason?: string | null;
  payload?: unknown;
}

/** Why the detail read's turn index is (or is not) there. */
export type TurnIndexState =
  | "present"
  | "truncated"
  | "not_requested"
  | "unavailable";

export interface SessionTurnIndexEntry {
  index: number;
  line_number: number;
  type?: string | null;
  role?: string | null;
  timestamp?: string | null;
  preview?: string | null;
  parse_error?: string | null;
}

/** `GET /{id}` — the head row plus a bounded turn index. */
export interface SessionArtifactDetailResponse extends SessionArtifactSummary {
  turn_index?: SessionTurnIndexEntry[] | null;
  turn_index_state: TurnIndexState;
  turn_index_unavailable_reason?: string | null;
  /**
   * Turns actually decoded from the stored body. May differ from
   * `turn_count` (a metadata-only writer's estimate); both are reported
   * rather than reconciled behind the reader's back.
   */
  decoded_turn_count?: number | null;
  /** The server's own answer to "can this digest be checked?" — see §5. */
  digest_verifiable: boolean;
}

// ───────────────────────────── turns ───────────────────────────────────────

/**
 * One decoded turn from `GET /{id}/turns`.
 *
 * `parse_error` is the field that matters most here: a malformed line is
 * RETURNED as an error turn rather than skipped, because a reader of an
 * archive has to be able to see the gap. A silently dropped line is
 * indistinguishable from a session that said nothing there, so this UI
 * renders the error in place.
 */
export interface SessionTurn {
  index: number;
  line_number: number;
  type?: string | null;
  role?: string | null;
  uuid?: string | null;
  parent_uuid?: string | null;
  timestamp?: string | null;
  text?: string | null;
  parse_error?: string | null;
  /** The parsed record, only when the caller asked for it. */
  raw?: Record<string, unknown> | null;
}

export interface SessionTurnsResponse {
  session_artifact_id: string;
  claude_session_id: string;
  items: SessionTurn[];
  total: number;
  offset: number;
  limit: number;
  body_source?: string | null;
  digest_verifiable: boolean;
}

// ───────────────────────── relaunch vs transfer (§3.5) ─────────────────────

/**
 * The two operations the server accepts as `mode`. They are NOT two labels
 * for one thing (plan §3.5): `resume` dispatches through the shipped handoff
 * subject and restores the conversation; `transfer` cannot, because a Claude
 * Code transcript is account-scoped and no other account can
 * `claude --resume` it.
 */
export type RelaunchOperation = "resume" | "transfer";

/**
 * The server's honest tier vocabulary — exactly two values, because there are
 * exactly two mechanisms.
 */
export type ServerRestoreTier = "full" | "replay_as_context";

/**
 * The UI's PREVIEW tier: what the chosen operation will mean for THIS row,
 * before it is dispatched.
 *
 * It is finer-grained than {@link ServerRestoreTier} on purpose, and every
 * extra value is a way the answer can be WEAKER than the server's `full`:
 *
 * * `full_after_restore` — the target coord device is not the one the archive
 *   recorded, so the transcript has to reach that machine before the resume
 *   means anything (plan §3.5, row 2).
 * * `terminal_only` — the runner itself recorded this session as
 *   terminal-only restorable. The working directory and command come back;
 *   the conversation does not. This preserves the shipped `ResumePanel`
 *   pattern, where the recorded `restore_tier` is the honest ceiling.
 * * `unknown` — the archive never recorded which coord device owned the
 *   session, so "is this its own machine?" cannot be answered. Guessing
 *   `full` there is exactly the silent state loss this type exists to stop.
 */
export type RelaunchTier =
  | "full"
  | "full_after_restore"
  | "terminal_only"
  | "replay_as_context"
  | "unknown";

export interface RelaunchTierCopy {
  /** The operation word an operator reads first. Never "resume" for a transfer. */
  action: string;
  /** The tier chip. */
  badge: string;
  /** What will actually happen, in the operator's terms. */
  detail: string;
  /** The confirm-button label. */
  confirm: string;
}

export const RELAUNCH_TIER_COPY: Record<RelaunchTier, RelaunchTierCopy> = {
  full: {
    action: "Resume",
    badge: "full — conversation restored",
    detail:
      "The session's own machine. Dispatched through the shipped handoff subject: the target runner materializes the session under the recorded config dir and working dir and replays its scrollback. The conversation comes back.",
    confirm: "Resume session",
  },
  full_after_restore: {
    action: "Resume on another machine",
    badge: "full — after the archive reaches that machine",
    detail:
      "A DIFFERENT machine from the one the archive recorded. The handoff still dispatches, but that machine's account home does not hold this transcript, so the conversation is only restored once the archived JSONL is there. Until then the resume gives you the working directory and command, not the conversation.",
    confirm: "Hand off to that machine",
  },
  terminal_only: {
    action: "Resume (terminal only)",
    badge: "terminal only — fresh conversation",
    detail:
      "The runner recorded this session as terminal-only restorable. The working directory, launch command and terminal come back; the AI conversation does NOT. A resume here starts a fresh conversation.",
    confirm: "Resume terminal",
  },
  replay_as_context: {
    action: "Transfer as context",
    badge: "replay as context — NOT a resume",
    detail:
      "Claude Code cannot resume another account's session id — the transcript is account-scoped — so a transfer returns the trailing turns as CONTEXT for a NEW session. Nothing is dispatched and no conversation is restored; it is retold.",
    confirm: "Get the replay context",
  },
  unknown: {
    action: "Resume (target machine unverified)",
    badge: "tier unknown",
    detail:
      "The archive did not record which coord device owned this session, so whether the machine you pick is its own cannot be established. The handoff will still dispatch, but do not assume the conversation is there until you see it.",
    confirm: "Hand off anyway",
  },
};

/**
 * What the operator is choosing between. Explicit rather than inferred: the
 * server takes `mode` as a required decision, and inferring it from a guessed
 * account comparison would put a UI guess in front of an operator's intent.
 */
export function relaunchOperation(tier: RelaunchTier): RelaunchOperation {
  return tier === "replay_as_context" ? "transfer" : "resume";
}

export interface RelaunchTarget {
  mode: RelaunchOperation;
  /** The coord device to hand the session to. "" = not chosen. */
  targetDeviceId: string;
}

/**
 * The preview tier for a (session, target) pair — plan §3.5's table, mapped
 * onto the mechanism the server actually uses.
 *
 * `transfer` short-circuits: it is a different operation, so the runner's
 * observed `restore_tier` has nothing to say about it. For a resume, the
 * answer is the WEAKEST of what the archive can establish — the recorded
 * `restore_tier` caps it, an unrecorded owning device makes it unknown, and
 * only a target that IS the recorded device earns `full`.
 */
export function resolveRelaunchTier(
  artifact: Pick<SessionArtifactSummary, "device_id" | "restore_tier">,
  target: RelaunchTarget
): RelaunchTier {
  if (target.mode === "transfer") {
    return "replay_as_context";
  }
  // The runner's own observation is the ceiling: a terminal-only session is
  // terminal-only wherever it lands.
  if (artifact.restore_tier === "terminal_only") {
    return "terminal_only";
  }
  const recordedDevice = artifact.device_id?.trim() ?? "";
  const targetDevice = target.targetDeviceId.trim();
  if (!recordedDevice || !targetDevice) {
    // Sameness cannot be established. Not "probably the same".
    return "unknown";
  }
  return targetDevice === recordedDevice ? "full" : "full_after_restore";
}

/** Request body for `POST /{id}/relaunch`. */
export interface RelaunchRequest {
  /**
   * Required by the server and by this UI's own logic: a transfer and a
   * resume are different operations, and the mode is what says which.
   */
  mode: RelaunchOperation;
  /** REQUIRED for `resume` — the handoff subject is scoped to a machine. */
  target_device_id?: string;
  /** Trailing turns to render as replay context. `transfer` only, 1–200. */
  context_turns?: number;
  /** Recorded on coord's durable `handoff_request` event. */
  reason?: string;
}

export interface RelaunchResponse {
  mode: RelaunchOperation;
  /** The SERVER's tier. Its answer wins over the preview above. */
  restore_tier: ServerRestoreTier;
  /** False for every transfer — nothing was dispatched, and it says so. */
  dispatched: boolean;
  session_artifact_id: string;
  claude_session_id: string;
  coord_session_id?: string | null;
  target_device_id?: string | null;
  account_label?: string | null;
  config_dir?: string | null;
  working_dir?: string | null;
  launch_command?: string | null;
  coord_response?: unknown;
  /** The replay context for a transfer, oldest→newest. */
  context_turns?: SessionTurn[] | null;
  /** The seam, in the server's own words. Rendered verbatim. */
  notices: string[];
}

/**
 * `409 no_coord_session` — the EXPECTED state for any session coord has
 * already pruned. The archive outlives the coordination record by design, so
 * the server hands back everything needed to relaunch by hand rather than a
 * bare failure, and this UI shows exactly that.
 */
export interface NoCoordSessionDetail {
  error: "no_coord_session";
  message: string;
  claude_session_id?: string | null;
  account_label?: string | null;
  config_dir?: string | null;
  working_dir?: string | null;
  launch_command?: string | null;
}

/** Parse a 409 body into the manual-relaunch card, or null if it isn't one. */
export function parseNoCoordSession(
  body: unknown
): NoCoordSessionDetail | null {
  if (typeof body !== "object" || body === null) return null;
  const outer = body as Record<string, unknown>;
  const detail =
    typeof outer.detail === "object" && outer.detail !== null
      ? (outer.detail as Record<string, unknown>)
      : outer;
  if (detail.error !== "no_coord_session") return null;
  const str = (key: string): string | null =>
    typeof detail[key] === "string" ? (detail[key] as string) : null;
  return {
    error: "no_coord_session",
    message: str("message") ?? "This session has no live coord session id.",
    claude_session_id: str("claude_session_id"),
    account_label: str("account_label"),
    config_dir: str("config_dir"),
    working_dir: str("working_dir"),
    launch_command: str("launch_command"),
  };
}

// ───────────────────────────── formatting ──────────────────────────────────

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit] ?? "TB"}`;
}

/** Short digest for a chip; the full value stays available in a tooltip. */
export function shortDigest(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "—";
}

/**
 * The display name for a row, with its own provenance never invented: an
 * unnamed session says so rather than borrowing the first prompt silently.
 */
export function displayName(item: SessionArtifactSummary): string {
  const named = item.session_name?.trim();
  if (named) return named;
  const ai = item.ai_title?.trim();
  if (ai) return ai;
  const first = item.first_prompt?.trim();
  if (first) return first.length > 120 ? `${first.slice(0, 120)}…` : first;
  return "(unnamed session)";
}

/** Where {@link displayName} got its text — rendered beside it, not hidden. */
export function displayNameSource(item: SessionArtifactSummary): string {
  if (item.session_name?.trim()) return item.name_source?.trim() || "named";
  if (item.ai_title?.trim()) return "ai title";
  if (item.first_prompt?.trim()) return "first prompt";
  return "no name recorded";
}
