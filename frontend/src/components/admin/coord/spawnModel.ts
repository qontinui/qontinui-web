/**
 * spawnModel — the pure half of the spawn modal: the wire contract of
 * `POST /agents/spawn`, the account-roster model and the constants both the
 * modal and its roster hook read.
 *
 * Split out of `SpawnModal.tsx` (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 4) so the contract has a module of its own with no React in it.
 * `SpawnModal.test.ts` pins it directly.
 */

import { ApiConfig } from "@/services/api-config";

export const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;

/**
 * Canonical repo slug list. Mirrors the set coord uses for
 * `declared_overlap_paths` repo scoping. Operators can still
 * declare repos that aren't in this list by typing them into the
 * "other repos" field — we union both before submit.
 */
export const KNOWN_REPOS = [
  "qontinui-web",
  "qontinui-runner",
  "qontinui-coord",
  "qontinui-schemas",
  "qontinui-mobile",
  "qontinui-ui-bridge",
  "qontinui-dev-notes",
] as const;

/** One row of coord's per-device Claude account feed, as served by the
 *  qontinui-web proxy `GET /operations/claude-accounts` (plan
 *  `2026-08-25-general-purpose-session-spawn-machine-account-prompt`
 *  Phase 2).
 *
 *  Identity on the wire is `account_label` — the config-dir BASENAME
 *  (`.claude-gmail`), never a local path. That is a deliberate contract of
 *  the runner's ingest side, so nothing here may render or send a path.
 *  Note the read side spells it `account_label`, not `label`.
 *
 *  Every observation-shaped field is `| null` on purpose: coord serves
 *  `is_active` / `account_selection_mode` as null on a deployment whose
 *  `coord.claude_account_usage` predates alembic `coord_claude_acct_usage_02`,
 *  and null there means UNKNOWN — never `false`, and never the
 *  `least_usage` default. */
export interface ClaudeAccountRow {
  device_id: string;
  account_label: string;
  weekly_utilization?: number | null;
  weekly_resets_at?: string | null;
  session_utilization?: number | null;
  session_resets_at?: string | null;
  model_limits?: unknown[];
  exhausted?: boolean | null;
  source?: string | null;
  error?: boolean | null;
  /** Coord's computed freshness verdict (30 min since the device's last
   *  report). `true` means the feed STOPPED — the numbers beside it are a
   *  last-known snapshot, not a current one. */
  stale?: boolean | null;
  /** Which account the machine's rotation actually picked. `null`/absent =
   *  unknown (the reporting runner predates the field). */
  is_active?: boolean | null;
  /** `manual` | `least_usage` | null. Null = unknown, NOT `least_usage`. */
  account_selection_mode?: string | null;
}

export interface ClaudeAccountsPayload {
  accounts?: unknown;
  /** `false` = coord has no `coord.claude_account_usage` table yet;
   *  `null`/absent = coord did not say. Both are UNKNOWN, not "no accounts". */
  table_provisioned?: boolean | null;
  /** `false` = the table predates the `is_active` / `account_selection_mode`
   *  columns, so the SELECTION half of every row is unknown while the usage
   *  half is real. */
  columns_provisioned?: boolean | null;
}

/** The sentinel the account `Select` carries for "no pin".
 *
 *  It is NOT sent: `buildSpawnRequestBody` receives `""` for this state and
 *  omits the key. Radix `SelectItem` rejects `value=""` outright (it reserves
 *  the empty string for "clear the selection"), so the no-pin choice needs a
 *  value of its own rather than the natural one. */
export const ACCOUNT_AUTO = "__machine_chooses__";

/** Device ids reach this component in two spellings — coord's hyphenated
 *  uuid from the roster, and whatever the operator typed, which `UUID_RE`
 *  also accepts in simple 32-hex form. Comparing them raw would silently
 *  filter the account roster down to nothing for a perfectly valid id. */
function normalizeDeviceId(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "");
}

export function filterAccountsForDevice(
  accounts: ClaudeAccountRow[],
  deviceId: string
): ClaudeAccountRow[] {
  const wanted = normalizeDeviceId(deviceId);
  if (wanted === "") return [];
  return accounts.filter((a) => normalizeDeviceId(a.device_id) === wanted);
}

/** What the modal can honestly say about the account roster right now.
 *
 *  The whole point of this type is that "coord has no accounts for this
 *  machine" and "we could not read the roster" are DIFFERENT answers with
 *  different fixes, and rendering them identically is the defect this
 *  mirrors from the device roster (`useSpawnRoster`). `ready` is the only
 *  state that may offer accounts to pin; every other state must SAY which
 *  one it is. */
export type AccountRosterState =
  | { kind: "loading"; message: string }
  | { kind: "no-device"; message: string }
  | { kind: "fault"; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "ready"; accounts: ClaudeAccountRow[] };

export function deriveAccountRoster(input: {
  loading: boolean;
  /** Non-null when the fetch failed, returned a non-2xx, or came back in a
   *  shape this surface cannot read. */
  fault: string | null;
  tableProvisioned: boolean | null | undefined;
  /** Whether a device is picked at all — the roster is per-machine. */
  deviceChosen: boolean;
  /** How many rows the tenant-wide roster carried, so "no accounts anywhere"
   *  and "none for THIS machine" can be told apart. */
  tenantRosterSize: number;
  deviceAccounts: ClaudeAccountRow[];
}): AccountRosterState {
  if (input.loading) {
    return { kind: "loading", message: "Loading the account roster…" };
  }
  if (input.fault !== null) {
    return {
      kind: "fault",
      message:
        `Could not read the Claude account roster — ${input.fault} ` +
        "This is UNKNOWN, not “no accounts”: leaving the pin alone still " +
        "works, but what the machine will then pick is not visible here.",
    };
  }
  if (!input.deviceChosen) {
    return {
      kind: "no-device",
      message:
        "No device is named, so coord picks the machine and that machine's " +
        "own rule picks the account. Name a device to pin an account — the " +
        "roster and the selection rule are per-machine.",
    };
  }
  // Rows in hand are rows in hand. `table_provisioned` is load-bearing ONLY
  // for interpreting an EMPTY list, so it is checked below this rather than
  // above it: coord serves the flag as null on any build predating its own
  // read route's flags, and gating `ready` on it would throw a roster we
  // just successfully read on the floor and then call it unreadable.
  if (input.deviceAccounts.length > 0) {
    return { kind: "ready", accounts: input.deviceAccounts };
  }
  // Nothing for this machine. NOW the flag decides whether that is an
  // ANSWER or an unknown: `true` is the only value that licenses reading an
  // empty list as "nothing has reported". `false` (coord has no table) and
  // null/absent (coord did not say) are both unknown, and defaulting either
  // to `true` would assert provisioning nobody observed.
  //
  // A non-empty TENANT roster is its own proof that the table exists and
  // outranks a flag claiming otherwise — rows cannot come from a table that
  // is not there.
  if (input.tableProvisioned !== true && input.tenantRosterSize === 0) {
    return {
      kind: "unknown",
      message:
        (input.tableProvisioned === false
          ? "Coord has no `coord.claude_account_usage` table on this deployment, so no account has ever been observed. "
          : "Coord did not report whether its account table is provisioned, so an empty roster cannot be read as an answer. ") +
        "UNKNOWN, not “no accounts” — spawn without a pin and the machine " +
        "chooses by its own rule.",
    };
  }
  return {
    kind: "empty",
    message:
      input.tenantRosterSize === 0
        ? "Coord's account table is provisioned and holds no rows for this " +
          "tenant: no runner has reported its Claude accounts yet. A device " +
          "reports on its ~10-minute usage refresh, so a machine that just " +
          "started is legitimately absent."
        : "Coord has account rows for this tenant but none for this device: " +
          "that machine's runner has not reported its Claude accounts yet.",
  };
}

const SELECTION_MODE_LABELS: Record<string, string> = {
  least_usage: "least-usage rotation across its accounts",
  manual: "the account pinned in its own settings",
};

/** The *"this machine will use: &lt;mode&gt;"* line.
 *
 *  `known: false` is a first-class answer. `account_selection_mode` is
 *  `#[serde(default)]` on coord's row and null on any deployment whose
 *  columns predate `coord_claude_acct_usage_02`, so the honest rendering of
 *  a missing mode is "unknown" — printing the `least_usage` default would
 *  state a machine-global behaviour we did not observe. */
export function describeSelectionMode(
  deviceAccounts: ClaudeAccountRow[],
  columnsProvisioned: boolean | null | undefined,
  /** Why the roster looks the way it does. Without it this function sees
   *  only an empty array and cannot tell "the machine reported no mode"
   *  from "we never got to ask" — and it would then state a CAUSE it did
   *  not observe, which is the same class of lie as printing the
   *  `least_usage` default. Defaults to `ready`, the only state in which an
   *  empty array really does mean the machine said nothing. */
  rosterKind: AccountRosterState["kind"] = "ready"
): { known: boolean; text: string } {
  const declared = Array.from(
    new Set(
      deviceAccounts
        .map((a) => a.account_selection_mode)
        .filter(
          (m): m is string => typeof m === "string" && m.trim().length > 0
        )
        .map((m) => m.trim())
    )
  );
  const [only] = declared;
  if (declared.length === 1 && only !== undefined) {
    return { known: true, text: SELECTION_MODE_LABELS[only] ?? only };
  }
  if (declared.length > 1) {
    // Rows of different vintages can disagree (the ingest upserts and never
    // deletes). Picking the first would silently resolve a contradiction.
    return {
      known: false,
      text:
        `unknown — this machine's rows disagree about the rule (${declared.join(", ")}), ` +
        "so none of them can be reported as current.",
    };
  }
  const cause =
    rosterKind === "loading"
      ? "unknown — the account roster has not been read yet."
      : rosterKind === "fault"
        ? "unknown — the account roster could not be read, so this machine was never asked."
        : rosterKind === "no-device"
          ? "unknown until a device is chosen — the selection rule is per-machine."
          : rosterKind === "unknown"
            ? "unknown — coord could not say whether it has ever observed this machine's accounts."
            : columnsProvisioned === false
              ? "unknown — coord's account table predates the selection columns, so no mode has been recorded."
              : "unknown — this machine has not reported a selection mode.";
  return {
    known: false,
    // The trailing clause is load-bearing: `least_usage` is the RUNNER's
    // `#[default]`, and an operator who knows that would otherwise fill the
    // blank in with it themselves.
    text:
      rosterKind === "no-device"
        ? cause
        : `${cause} It is not necessarily least-usage.`,
  };
}

/** Render a 0..1 utilization as a percentage, or `null` when there is no
 *  number to render. A missing utilization is unknown, not 0%. */
export function formatUtilization(
  value: number | null | undefined
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/** Extract the `plan_phase` value coord will accept from the free-text
 *  Phase input.
 *
 *  The input is deliberately free text ("the plan owns phase
 *  nomenclature") but coord types the field `Option<u32>`. So: take the
 *  leading integer, and return `undefined` when there is none so the
 *  caller OMITS the key rather than sending a string.
 *
 *  The range check is not paranoia: `u32` is the constraint, so a phase
 *  like "99999999999" parses fine in JS and then 422s on coord for the
 *  very reason this exists. Out of range → omit, same as no digits. */
const U32_MAX = 4294967295;

export function parsePlanPhase(phase: string): number | undefined {
  const digits = phase.trim().match(/\d+/)?.[0];
  if (digits === undefined) return undefined;
  const n = Number(digits);
  if (!Number.isInteger(n) || n < 0 || n > U32_MAX) return undefined;
  return n;
}

/** Build the `POST /agents/spawn` body.
 *
 *  Extracted from `handleSubmit` purely to give the wire contract a test
 *  seam — this body must match coord's `SpawnRequest`
 *  (`agents_spawn.rs:86-104`), which axum extracts with
 *  `Json(req): Json<SpawnRequest>`, i.e. strict serde, so a mismatch is a
 *  hard 422 BEFORE any handler logic runs. This modal previously sent
 *  `device_id` (a key coord does not read, leaving the REQUIRED
 *  `target_device_id` absent), `repos` as bare strings, and `plan_phase`
 *  as free text, so every submit 422'd. Do not "simplify" these back:
 *    - target_device_id: `Option<Uuid>` since coord#2403. OMITTED — never
 *                        `""`, which is not a Uuid and 422s — for an
 *                        automatic spawn; present, it is a checked pin.
 *    - required_capabilities: `Vec<String>`, omitted when empty.
 *    - override_drain:   sent ONLY with a named device. Coord 400s it
 *                        without one (`override_drain_requires_target`), and
 *                        a coord-placed device is never knowingly drained.
 *    - repos:            Vec<AllocateRepoSpec> = [{ repo, parent_sha? }],
 *                        NOT string[]
 *    - plan_phase:       Option<u32>, so a non-numeric phase must be
 *                        OMITTED rather than sent as a string
 *
 *  Stage 4a of plan `2026-07-28-coord-post-plan-slug-surfaces-rename`
 *  moved this writer from `plan_slug` to `work_unit_slug`. Coord's
 *  `SpawnRequest` opened the dual-accept window in Stage 2
 *  (`#[serde(alias = "plan_slug")]`, coord#1332, serving since
 *  `651c4e78`). Send exactly ONE of the two spellings, never both:
 *  serde's derive treats an alias as the SAME field, so a body carrying
 *  `plan_slug` AND `work_unit_slug` is rejected outright as a
 *  `duplicate field` error rather than resolved last-one-wins.
 *
 *  ⚠️ **Empty string is ABSENCE only if we omit the key — coord will not
 *  save us.** `work_unit_slug`, `intent` and `declared_overlap_paths` are
 *  `Option<…>` on `SpawnRequest`, so `""` deserializes as `Some("")`, not
 *  `None`. An empty slug then flows into `derive_intent`
 *  (`agents_spawn.rs:830-834`), which matches `Some(slug)` and synthesizes
 *  the literal intent `"plan:"`; into the prompt-injection audit as
 *  `trigger_text: "spawn for plan "`; and into `LaunchPayload.work_unit_slug`
 *  and on to the runner's session registration — manufacturing a phantom
 *  work-unit row on the plans page for a session that has no plan. So every
 *  optional is TRIMMED FIRST and then OMITTED when empty, exactly as
 *  `plan_phase` already was. */
export function buildSpawnRequestBody(input: {
  /** Optional — omitted from the body when blank (an unanchored spawn). */
  workUnitSlug?: string;
  /** Optional free text; only its leading integer reaches the wire. */
  phase?: string;
  /** `""` (or blank) = automatic placement: the key is OMITTED and coord
   *  picks. Anything else is the pin. */
  deviceId: string;
  /** Optional — omitted from the body when empty. */
  requiredCapabilities?: string[];
  /** Override a KNOWN drain on the named device. Ignored — never sent — when
   *  no device is named. */
  overrideDrain?: boolean;
  repos: string[];
  /** Optional — omitted from the body when blank. */
  intent?: string;
  /** Optional — omitted from the body when empty. */
  declaredOverlapPaths?: string[];
  /** Optional Claude-account pin — the config-dir BASENAME
   *  (`.claude-gmail`), never a local path. Omitted from the body when
   *  absent or blank, which IS "let the machine choose": coord types it
   *  `Option<String>` with `#[serde(default)]`, so absence restores today's
   *  unchanged rotation, while `""` would deserialize as `Some("")` — a pin
   *  on an account no machine has. */
  account?: string;
  initialPrompt: string;
}): Record<string, unknown> {
  const planPhase = parsePlanPhase(input.phase ?? "");
  const workUnitSlug = (input.workUnitSlug ?? "").trim();
  const intent = (input.intent ?? "").trim();
  const overlapPaths = input.declaredOverlapPaths ?? [];
  const account = (input.account ?? "").trim();
  const deviceId = input.deviceId.trim();
  const capabilities = input.requiredCapabilities ?? [];
  return {
    // Omitted — never `""` — when the spawn is unanchored. See the
    // empty-string note above: `""` here manufactures a phantom plan.
    ...(workUnitSlug === "" ? {} : { work_unit_slug: workUnitSlug }),
    // Omitted entirely when the operator's free-text phase carries no
    // digits — the field is optional, and sending a string 422s.
    ...(planPhase === undefined ? {} : { plan_phase: planPhase }),
    // Omitted — never `""` — for automatic placement: coord places it.
    ...(deviceId === "" ? {} : { target_device_id: deviceId }),
    ...(capabilities.length === 0
      ? {}
      : { required_capabilities: capabilities }),
    // Only a NAMED device can have its drain overridden.
    ...(deviceId !== "" && input.overrideDrain === true
      ? { override_drain: true }
      : {}),
    // Omitted — never `""` — when the operator left the machine to choose.
    ...(account === "" ? {} : { account }),
    repos: input.repos.map((repo) => ({ repo })),
    ...(intent === "" ? {} : { intent }),
    ...(overlapPaths.length === 0
      ? {}
      : { declared_overlap_paths: overlapPaths }),
    initial_prompt: input.initialPrompt.trim(),
  };
}

/** Coord types `target_device_id` as `Uuid`, whose deserializer accepts the
 *  hyphenated form AND the simple 32-hex form — so a hyphens-only guard would
 *  reject input coord would happily take. */
export const UUID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

/** Exactly what coord requires — nothing more.
 *
 *  A non-empty `repos[]` and `initial_prompt` are the fields
 *  `POST /agents/spawn` rejects the body without; `target_device_id` has
 *  been optional since coord#2403 (blank = automatic placement). Slug / phase / intent / overlap paths are
 *  all `Option<…>` there, so requiring them here was a frontend
 *  invention that made "run this prompt on that machine" inexpressible
 *  without inventing a plan to carry it.
 *
 *  The device predicate is "blank OR a valid uuid", NOT "anything": coord
 *  types a present `target_device_id` as `Uuid`, so a typed non-uuid is a
 *  422 either way — catching it here is strictly cheaper.
 *
 *  The body guard is the ONE frontend-invented predicate here, and it is
 *  deliberate: it costs a single click on the rows that earn it and nothing
 *  at all on every other spawn. It gates the button rather than the request
 *  — coord would accept this body — because the point is that the operator
 *  reads what the session will have to do, not that the spawn is refused. */
export function canSubmitSpawn(input: {
  submitting: boolean;
  /** No device named — coord places the session. */
  automatic: boolean;
  deviceIdValid: boolean;
  repoCount: number;
  initialPrompt: string;
  /** No body guard on this spawn, or the operator acknowledged it. */
  bodyCleared: boolean;
}): boolean {
  return (
    !input.submitting &&
    (input.automatic || input.deviceIdValid) &&
    input.repoCount > 0 &&
    input.initialPrompt.trim().length > 0 &&
    input.bodyCleared
  );
}
