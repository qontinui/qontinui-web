"use client";

/**
 * SpawnModal — operator authoring surface for `POST /agents/spawn`.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 4 (Wave 4).
 *
 * The modal serves BOTH spawn shapes (plan
 * `2026-08-25-general-purpose-session-spawn-machine-account-prompt`
 * Phase 1):
 *
 *   - **anchored** — opened from a plan row, `planSlug` seeded, work-unit
 *     anchor + phase + intent on the wire;
 *   - **unanchored** — opened from the page's "New session" action with no
 *     plan at all. The anchor keys are then OMITTED from the body, never
 *     sent as `""`; see `buildSpawnRequestBody`.
 *
 * Inputs — only the last three are REQUIRED, because only those three are
 * required by coord (`agents_spawn.rs:228,235`):
 *   - work_unit_slug (OPTIONAL; preset by parent — disabled, contextual).
 *     Sent under the `work_unit_slug` wire key since Stage 4a of plan
 *     `2026-07-28-coord-post-plan-slug-surfaces-rename`; the value always
 *     named a work-unit slug. See the wire-key note on `handleSubmit`.
 *   - plan_phase  (OPTIONAL free-text input; the leading integer is extracted
 *     and sent as `plan_phase`, which coord types `Option<u32>`. A phase with
 *     no digits is omitted from the body rather than sent as a string.)
 *   - intent      (OPTIONAL short free-text description)
 *   - declared_overlap_paths (OPTIONAL newline-delimited list)
 *   - device_id   (REQUIRED; dropdown sourced from /operations/fleet/health,
 *     or typed directly when that roster is empty or unreachable) — sent as
 *     `target_device_id`, the name coord requires. A typed id is validated
 *     against coord's `Uuid` before submit rather than after a 422.
 *   - repos       (REQUIRED, ≥1; multi-select checkbox list of known repos) —
 *     sent as `[{ repo }]` objects, not bare strings. Required even for an
 *     unanchored spawn: coord 400s on an empty list, and the session's TENANT
 *     is derived from `repos[]` (name-normalized `tenant_repos` owners ∩
 *     device bindings) before any worktree is allocated.
 *   - account     (OPTIONAL Claude-account pin, Phase 3 — the config-dir
 *     BASENAME from coord's per-device account feed, never a local path.
 *     Defaults to "let the machine choose", in which case the key is
 *     OMITTED and the runner's own `AccountSelectionMode` decides exactly as
 *     it does today. The roster behind the dropdown is read from
 *     `/operations/claude-accounts` and is a CONVENIENCE: an unreadable
 *     roster never blocks a spawn, it only removes the ability to pin.)
 *   - initial_prompt (REQUIRED; the agent's first-tick prompt body)
 *
 * Submit → POST /api/v1/operations/agents/spawn. On success: toast + the
 * coord-side agent_id is surfaced; the parent decides whether to
 * navigate (we don't auto-route — operators are spawning many agents
 * in sequence during readiness waves).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Rocket } from "lucide-react";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;

/**
 * Canonical repo slug list. Mirrors the set coord uses for
 * `declared_overlap_paths` repo scoping. Operators can still
 * declare repos that aren't in this list by typing them into the
 * "other repos" field — we union both before submit.
 */
const KNOWN_REPOS = [
  "qontinui-web",
  "qontinui-runner",
  "qontinui-coord",
  "qontinui-schemas",
  "qontinui-mobile",
  "qontinui-ui-bridge",
  "qontinui-dev-notes",
] as const;

interface FleetHealthDevice {
  device_id: string;
  hostname?: string;
  /** Coord `DeviceState` (serde-lowercase): healthy | degraded | partitioned | abandoned. */
  state?: string;
}

interface FleetHealthPayload {
  devices?: FleetHealthDevice[];
}

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

interface ClaudeAccountsPayload {
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
 *  mirrors from the device roster above. `ready` is the only state that may
 *  offer accounts to pin; every other state must SAY which one it is. */
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
        "Choose a device first — the account roster and the selection rule " +
        "are per-machine.",
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
 *    - target_device_id: required Uuid, no serde(default)
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
  deviceId: string;
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
  return {
    // Omitted — never `""` — when the spawn is unanchored. See the
    // empty-string note above: `""` here manufactures a phantom plan.
    ...(workUnitSlug === "" ? {} : { work_unit_slug: workUnitSlug }),
    // Omitted entirely when the operator's free-text phase carries no
    // digits — the field is optional, and sending a string 422s.
    ...(planPhase === undefined ? {} : { plan_phase: planPhase }),
    target_device_id: input.deviceId.trim(),
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
const UUID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

export interface SpawnModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
  /**
   * Work-unit slug to anchor the spawn to, set by the parent page row.
   *
   * OPTIONAL: the "New session" entry point opens the modal with no plan
   * seeded, which is a supported (unanchored) spawn — coord requires only
   * a device, one repo and a prompt.
   */
  planSlug?: string;
  /** Plan phase pre-seed; the user can override before submitting. */
  initialPhase?: string;
  /** Called after a successful spawn with the coord response body. */
  onSuccess?: (agent: { agent_id?: string; [k: string]: unknown }) => void;
}

export function SpawnModal({
  open,
  onClose,
  planSlug = "",
  initialPhase,
  onSuccess,
}: SpawnModalProps) {
  const [phase, setPhase] = useState(initialPhase ?? "");
  const [deviceId, setDeviceId] = useState("");
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [otherRepos, setOtherRepos] = useState("");
  const [intent, setIntent] = useState("");
  const [overlapPaths, setOverlapPaths] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [devices, setDevices] = useState<FleetHealthDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  /** Why the roster is unusable, when it is. `null` = a usable roster.
   *
   *  An empty roster and a FAILED roster fetch used to render identically
   *  ("No devices reporting"), because the catch below only reached
   *  `console.warn`. They have opposite fixes — one is a coord-side
   *  liveness question, the other an auth/proxy fault — so the operator
   *  has to be able to tell them apart without opening devtools.
   *
   *  `kind` is carried as DATA rather than inferred from the message text:
   *  `empty` is information (coord answered, honestly, with nothing), while
   *  `fault` is an error, and they are styled differently. Sniffing the
   *  prose to tell them apart later is exactly the bug this shape avoids. */
  const [devicesError, setDevicesError] = useState<{
    kind: "empty" | "fault";
    message: string;
  } | null>(null);
  /** Type a device id instead of picking one. Auto-armed whenever the
   *  roster comes back unusable, so an empty dropdown is never a dead end
   *  (the roster is a CONVENIENCE — `target_device_id` is just a uuid). */
  const [manualDevice, setManualDevice] = useState(false);

  /** The operator's account pin. `ACCOUNT_AUTO` — the default — means NO
   *  pin: the key is omitted from the body and the machine's own
   *  `AccountSelectionMode` decides, exactly as it does today. */
  const [account, setAccount] = useState(ACCOUNT_AUTO);
  /** The TENANT-wide roster; the per-device view is derived below. Kept
   *  whole so "no rows anywhere" and "no rows for this machine" stay
   *  distinguishable. */
  const [accounts, setAccounts] = useState<ClaudeAccountRow[]>([]);
  /** Starts TRUE. The fetch effect below runs after the first commit, so
   *  an initial `false` would paint one frame of "coord did not report
   *  whether its table is provisioned" before the request is even issued —
   *  an unknown asserted about a read that has not happened. */
  const [accountsLoading, setAccountsLoading] = useState(true);
  /** Why the account roster is unreadable, when it is: a transport failure,
   *  a non-2xx, or a body this surface cannot parse. `null` = the fetch
   *  answered; it does NOT mean the answer was non-empty. */
  const [accountsFault, setAccountsFault] = useState<string | null>(null);
  /** Rows coord served that carried no usable `device_id`/`account_label`.
   *  Dropped rather than guessed at, and then SAID — a roster you can only
   *  partly parse is not one to pin a spawn from silently. */
  const [unreadableAccountRows, setUnreadableAccountRows] = useState(0);
  const [tableProvisioned, setTableProvisioned] = useState<boolean | null>(
    null
  );
  const [columnsProvisioned, setColumnsProvisioned] = useState<boolean | null>(
    null
  );

  // Reset form state on every open so a fresh spawn doesn't inherit
  // the previous one.
  useEffect(() => {
    if (!open) return;
    setPhase(initialPhase ?? "");
    setDeviceId("");
    setManualDevice(false);
    setDevicesError(null);
    setDevices([]);
    setAccount(ACCOUNT_AUTO);
    setAccounts([]);
    setAccountsFault(null);
    setUnreadableAccountRows(0);
    setTableProvisioned(null);
    setColumnsProvisioned(null);
    setSelectedRepos([]);
    setOtherRepos("");
    setIntent("");
    setOverlapPaths("");
    setInitialPrompt("");
    setError(null);
    setSubmitting(false);
  }, [open, initialPhase]);

  // Populate device dropdown from coord fleet health.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDevicesLoading(true);
    setDevicesError(null);
    fetch(`${API}/fleet/health`)
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(
              new Error(`fleet/health returned HTTP ${res.status}`)
            )
      )
      .then((body: FleetHealthPayload) => {
        if (cancelled) return;
        const roster = body.devices ?? [];
        setDevices(roster);
        // A 200 with an empty roster is a real answer, not a failure. Coord
        // lists a device only when it is BOTH bound to the reading
        // principal's tenant (an INNER JOIN on `coord.tenant_devices`) and
        // inside the liveness window. Say so, rather than leaving a blank
        // dropdown to be read as "the fleet is down".
        //
        // Deliberately does NOT name a cause: an empty roster has several,
        // and this surface cannot tell them apart. An earlier draft asserted
        // a specific one (a heartbeat-cadence gap) that was later falsified —
        // wrong prose in a user-facing string is worse than none.
        if (roster.length === 0) {
          setDevicesError({
            kind: "empty",
            message:
              "Coord reported 0 live devices for this tenant. A device is " +
              "listed only if it is bound to this tenant and its last heartbeat " +
              "is recent, so a healthy machine can still be absent. Enter the " +
              "device id directly if you know it.",
          });
          setManualDevice(true);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const detail = e instanceof Error ? e.message : String(e);
        console.warn("[SpawnModal] fleet/health fetch failed", e);
        setDevices([]);
        setDevicesError({
          kind: "fault",
          message: `Could not load the device roster — ${detail}.`,
        });
        setManualDevice(true);
      })
      .finally(() => {
        if (cancelled) return;
        setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Populate the Claude account roster from coord's per-device usage feed.
  //
  // Same discipline as the device roster above, for the same reason: a
  // failed read and an honestly-empty one have opposite fixes, so they are
  // carried as different STATES rather than collapsed into a blank list.
  // The roster is a CONVENIENCE — it never gates submit, because a spawn
  // with no pin is the unchanged default behaviour.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAccountsLoading(true);
    setAccountsFault(null);
    fetch(`${API}/claude-accounts`)
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(
              new Error(`claude-accounts returned HTTP ${res.status}`)
            )
      )
      .then((body: ClaudeAccountsPayload) => {
        if (cancelled) return;
        const raw = body?.accounts;
        if (!Array.isArray(raw)) {
          // Our own proxy always emits an `accounts` array, so a body
          // without one is a contract break, not an empty roster.
          setAccounts([]);
          setTableProvisioned(null);
          setColumnsProvisioned(null);
          setUnreadableAccountRows(0);
          setAccountsFault(
            "coord returned no `accounts` array, so the roster could not be read."
          );
          return;
        }
        // A row without a NON-EMPTY device id and label is unusable: the
        // label is both the pin's wire value and the `SelectItem` value, and
        // Radix rejects `value=""` outright.
        const rows = raw.filter((r): r is ClaudeAccountRow => {
          if (typeof r !== "object" || r === null) return false;
          const row = r as ClaudeAccountRow;
          return (
            typeof row.device_id === "string" &&
            row.device_id.trim().length > 0 &&
            typeof row.account_label === "string" &&
            row.account_label.trim().length > 0
          );
        });
        setAccounts(rows);
        setUnreadableAccountRows(raw.length - rows.length);
        // `?? null` and never `?? true`: an absent flag is coord declining
        // to say, which is unknown. Defaulting it to `true` would let an
        // empty list be read as "this machine has no Claude accounts".
        setTableProvisioned(body.table_provisioned ?? null);
        setColumnsProvisioned(body.columns_provisioned ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const detail = e instanceof Error ? e.message : String(e);
        console.warn("[SpawnModal] claude-accounts fetch failed", e);
        setAccounts([]);
        setUnreadableAccountRows(0);
        setTableProvisioned(null);
        setColumnsProvisioned(null);
        setAccountsFault(`${detail}.`);
      })
      .finally(() => {
        if (cancelled) return;
        setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleRepo = useCallback((repo: string) => {
    setSelectedRepos((prev) =>
      prev.includes(repo) ? prev.filter((r) => r !== repo) : [...prev, repo]
    );
  }, []);

  const allRepos = useMemo(() => {
    const extras = otherRepos
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set([...selectedRepos, ...extras]));
  }, [selectedRepos, otherRepos]);

  const parsedOverlapPaths = useMemo(
    () =>
      overlapPaths
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [overlapPaths]
  );

  /** The typed value, normalized the same way the wire body normalizes it. */
  const deviceIdValue = deviceId.trim();
  /** A roster pick is a uuid by construction; a TYPED one is not. Guard here
   *  so an obviously-bad id costs a hint rather than a round trip to a 422. */
  const deviceIdValid = UUID_RE.test(deviceIdValue);

  /** The chosen machine's accounts, out of the tenant-wide roster. */
  const deviceAccounts = useMemo(
    () =>
      deviceIdValid ? filterAccountsForDevice(accounts, deviceIdValue) : [],
    [accounts, deviceIdValue, deviceIdValid]
  );

  const accountRoster = useMemo(
    () =>
      deriveAccountRoster({
        loading: accountsLoading,
        fault: accountsFault,
        tableProvisioned,
        deviceChosen: deviceIdValid,
        tenantRosterSize: accounts.length,
        deviceAccounts,
      }),
    [
      accountsLoading,
      accountsFault,
      tableProvisioned,
      deviceIdValid,
      accounts.length,
      deviceAccounts,
    ]
  );

  const selectionMode = useMemo(
    () =>
      describeSelectionMode(
        deviceAccounts,
        columnsProvisioned,
        accountRoster.kind
      ),
    [deviceAccounts, columnsProvisioned, accountRoster.kind]
  );

  /** An account label only means something on the machine that reported it,
   *  so changing the device drops the pin rather than carrying a stale label
   *  onto a machine that has never heard of it. */
  useEffect(() => {
    setAccount(ACCOUNT_AUTO);
  }, [deviceIdValue]);

  /** `""` — i.e. "no pin", the key omitted — unless a real label is chosen. */
  const accountPin = account === ACCOUNT_AUTO ? "" : account;
  const pinnedRow = deviceAccounts.find((a) => a.account_label === accountPin);

  /** An unanchored spawn is one with no work-unit slug. It is a normal
   *  state, not an error: `coord.sessions.work_unit_slug` is nullable and
   *  the sessions list carries no work-unit predicate. What it gives up is
   *  the advance declared-overlap signal, not claims or tenant scoping. */
  const anchored = planSlug.trim().length > 0;

  /** Exactly what coord requires — nothing more.
   *
   *  `target_device_id`, a non-empty `repos[]` and `initial_prompt` are the
   *  three fields `POST /agents/spawn` rejects the body without
   *  (`agents_spawn.rs:228,235`). Slug / phase / intent / overlap paths are
   *  all `Option<…>` there, so requiring them here was a frontend
   *  invention that made "run this prompt on that machine" inexpressible
   *  without inventing a plan to carry it.
   *
   *  The device predicate stays `deviceIdValid`, NOT `length > 0`: coord
   *  types `target_device_id` as `Uuid`, so a typed non-uuid is a 422 either
   *  way — catching it here is strictly cheaper, and relaxing the anchor
   *  fields is no reason to give that back. */
  const canSubmit =
    !submitting &&
    deviceIdValid &&
    allRepos.length > 0 &&
    initialPrompt.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Shape is dictated by coord's `SpawnRequest` and pinned by
      // `SpawnModal.test.ts` — see `buildSpawnRequestBody` above.
      const body = buildSpawnRequestBody({
        workUnitSlug: planSlug,
        phase,
        deviceId,
        repos: allRepos,
        intent,
        declaredOverlapPaths: parsedOverlapPaths,
        account: accountPin,
        initialPrompt,
      });
      const res = await fetch(`${API}/agents/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const result = (await res.json()) as {
        agent_id?: string;
        [k: string]: unknown;
      };
      // Label the spawn shape in the confirmation: an unanchored session
      // is legitimate, but the operator should never have to guess which
      // one they just created.
      const label = anchored
        ? `for ${planSlug}`
        : "(unanchored — no plan anchor)";
      // Name the account outcome too: "the machine chose" and "you pinned
      // one" are different spawns, and the operator should not have to
      // guess which one they just got.
      const accountLabel =
        accountPin === ""
          ? " — account chosen by the machine"
          : ` — pinned to ${accountPin}`;
      toast.success(
        result.agent_id
          ? `Spawned agent ${result.agent_id} ${label}${accountLabel}`
          : `Agent spawned ${label}${accountLabel}`
      );
      onSuccess?.(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    planSlug,
    anchored,
    phase,
    deviceId,
    allRepos,
    intent,
    parsedOverlapPaths,
    accountPin,
    initialPrompt,
    onSuccess,
    onClose,
  ]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="coord-spawn-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            {anchored ? "Spawn agent from plan" : "New session"}
          </DialogTitle>
          <DialogDescription>
            Mint a coord agent pinned to a device. Coord acquires claims,
            allocates the device, and delivers your initial prompt on first
            tick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {anchored ? (
            <div className="space-y-1.5">
              <Label htmlFor="spawn-plan-slug">Plan</Label>
              <Input
                id="spawn-plan-slug"
                value={planSlug}
                readOnly
                disabled
                className="font-mono text-xs"
                data-testid="coord-spawn-plan-slug"
              />
            </div>
          ) : (
            <p
              className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
              data-testid="coord-spawn-unanchored-notice"
            >
              <span className="font-medium text-foreground">
                Unanchored session
              </span>{" "}
              — no plan, phase or intent. The session is listed on{" "}
              <span className="font-mono">/sessions</span> like any other and
              appears under no plan. What it gives up is the <em>advance</em>{" "}
              overlap signal from declared paths; file claims, tenant scoping
              and worktree allocation are unchanged.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="spawn-plan-phase">
              Phase{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="spawn-plan-phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              placeholder='e.g. "Phase 4" or "Wave 4 — spawn UI"'
              data-testid="coord-spawn-phase"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-device">Device</Label>
            {devicesLoading ? (
              // Not a Skeleton: <Label htmlFor="spawn-device"> needs a real
              // labelable control in EVERY branch, and a <div> cannot be one.
              <Input
                id="spawn-device"
                disabled
                placeholder="Loading devices…"
                className="font-mono text-xs"
                data-testid="coord-spawn-device-loading"
              />
            ) : manualDevice ? (
              <Input
                id="spawn-device"
                data-testid="coord-spawn-device-input"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="target device id (uuid)"
                className="font-mono text-xs"
                spellCheck={false}
                aria-invalid={deviceIdValue.length > 0 && !deviceIdValid}
                aria-describedby={
                  devicesError ? "spawn-device-notice" : undefined
                }
              />
            ) : (
              <Select value={deviceId} onValueChange={setDeviceId}>
                <SelectTrigger
                  id="spawn-device"
                  data-testid="coord-spawn-device-select"
                  aria-describedby={
                    devicesError ? "spawn-device-notice" : undefined
                  }
                >
                  <SelectValue placeholder="Choose a device" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d) => (
                    <SelectItem key={d.device_id} value={d.device_id}>
                      <span className="font-mono text-xs">
                        {d.hostname || d.device_id}
                      </span>
                      {d.state && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({d.state})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {devicesError && (
              <p
                id="spawn-device-notice"
                role="status"
                aria-live="polite"
                className={
                  devicesError.kind === "fault"
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
                data-testid="coord-spawn-device-notice"
              >
                {devicesError.message}
              </p>
            )}
            {manualDevice && deviceIdValue.length > 0 && !deviceIdValid && (
              <p
                className="text-xs text-destructive"
                data-testid="coord-spawn-device-invalid"
              >
                Not a uuid — coord types `target_device_id` as `Uuid` and
                rejects the body with 422.
              </p>
            )}
            {/* Only offer the return trip when there is something to return
                to: switching back to a zero-item Select is the dead end this
                change exists to remove. */}
            {!devicesLoading && (!manualDevice || devices.length > 0) && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                data-testid="coord-spawn-device-toggle"
                onClick={() => {
                  setManualDevice((v) => !v);
                  setDeviceId("");
                }}
              >
                {manualDevice
                  ? `Choose from the roster (${devices.length})`
                  : "Enter a device id instead"}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-account">
              Claude account{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>

            {/* Phase 2: say what the machine will do BEFORE offering to
                override it. `known: false` is rendered as an emphasised
                unknown rather than the `least_usage` default, because the
                default is what the runner does — not what we observed. */}
            <p
              id="spawn-account-mode"
              className={
                selectionMode.known
                  ? "text-xs text-muted-foreground"
                  : "text-xs font-medium text-foreground"
              }
              data-testid="coord-spawn-account-mode"
            >
              {selectionMode.known
                ? `Left unpinned, this machine will use: ${selectionMode.text}`
                : `Left unpinned, what this machine will use is ${selectionMode.text}`}
            </p>

            {accountRoster.kind === "ready" ? (
              <ul
                className="divide-y divide-border rounded-md border border-border"
                data-testid="coord-spawn-account-roster"
              >
                {accountRoster.accounts.map((a) => {
                  const weekly = formatUtilization(a.weekly_utilization);
                  const session = formatUtilization(a.session_utilization);
                  return (
                    <li
                      key={a.account_label}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 p-2 text-xs"
                      data-testid={`coord-spawn-account-row-${a.account_label}`}
                    >
                      <span className="font-mono">{a.account_label}</span>
                      {a.is_active === true && (
                        <span className="font-medium text-foreground">
                          active now
                        </span>
                      )}
                      {typeof a.is_active !== "boolean" && (
                        <span className="text-muted-foreground">
                          active: unknown
                        </span>
                      )}
                      {a.exhausted === true && (
                        <span className="text-destructive">
                          exhausted — will not serve
                        </span>
                      )}
                      {a.stale === true && (
                        <span className="text-destructive">
                          stale — this device stopped reporting, so the numbers
                          beside it are last-known, not current
                        </span>
                      )}
                      {a.error === true && (
                        <span className="text-destructive">
                          the device reported an error reading this account
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        weekly {weekly ?? "unknown"} · session{" "}
                        {session ?? "unknown"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p
                id="spawn-account-notice"
                role="status"
                aria-live="polite"
                className={
                  accountRoster.kind === "fault"
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
                data-testid="coord-spawn-account-notice"
              >
                {accountRoster.message}
              </p>
            )}

            {unreadableAccountRows > 0 && (
              <p
                className="text-xs text-destructive"
                data-testid="coord-spawn-account-unreadable"
              >
                {unreadableAccountRows} row(s) in coord&apos;s account roster
                carried no usable device id or account label and were dropped.
                They cannot be attributed to any machine, so the list above may
                be incomplete.
              </p>
            )}

            {columnsProvisioned === false && accountRoster.kind === "ready" && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="coord-spawn-account-columns-notice"
              >
                Coord&apos;s account table predates the{" "}
                <span className="font-mono">is_active</span> /{" "}
                <span className="font-mono">account_selection_mode</span>{" "}
                columns, so the usage numbers are real but which account is
                active, and by what rule, is unknown.
              </p>
            )}

            {/* Phase 3: the pin itself. Defaulting to "let the machine
                choose" keeps today's rotation EXACTLY unchanged — the key is
                omitted from the body, not sent empty. */}
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger
                id="spawn-account"
                data-testid="coord-spawn-account-select"
                aria-describedby={
                  accountRoster.kind === "ready"
                    ? "spawn-account-mode"
                    : "spawn-account-mode spawn-account-notice"
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ACCOUNT_AUTO}>
                  Let the machine choose
                </SelectItem>
                {accountRoster.kind === "ready" &&
                  accountRoster.accounts.map((a) => (
                    <SelectItem
                      key={a.account_label}
                      value={a.account_label}
                      textValue={a.account_label}
                    >
                      <span className="font-mono text-xs">
                        {a.account_label}
                      </span>
                      {a.is_active === true && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (active now)
                        </span>
                      )}
                      {a.exhausted === true && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (exhausted)
                        </span>
                      )}
                      {a.stale === true && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (stale)
                        </span>
                      )}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {/* Flagged accounts stay SELECTABLE on purpose: `exhausted` and
                `stale` are observations, and a stale row's `exhausted:false`
                is exactly as out of date as its `exhausted:true`. Disabling
                a choice on a snapshot that stopped updating would be a
                stronger claim than the data supports — so the operator is
                warned, not overruled. */}
            {pinnedRow &&
              (pinnedRow.exhausted === true || pinnedRow.stale === true) && (
                <p
                  className="text-xs text-destructive"
                  data-testid="coord-spawn-account-pin-warning"
                >
                  {pinnedRow.exhausted === true
                    ? `${pinnedRow.account_label} last reported as exhausted, so this spawn may not get a usable session.`
                    : `${pinnedRow.account_label} is stale — this device stopped reporting, so its usage is last-known rather than current.`}
                </p>
              )}
          </div>

          <div className="space-y-1.5">
            <Label>Repos</Label>
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-spawn-repos-rationale"
            >
              At least one is required even without a plan: coord derives the
              session&apos;s tenant from the repo list before anything else, and
              allocates the agent&apos;s worktree from it.
            </p>
            <div
              className="grid grid-cols-2 gap-1.5 rounded-md border border-border p-2"
              data-testid="coord-spawn-repos"
            >
              {KNOWN_REPOS.map((repo) => {
                const id = `spawn-repo-${repo}`;
                const checked = selectedRepos.includes(repo);
                return (
                  <label
                    key={repo}
                    htmlFor={id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={() => toggleRepo(repo)}
                      data-testid={`coord-spawn-repo-${repo}`}
                    />
                    <span className="font-mono text-xs">{repo}</span>
                  </label>
                );
              })}
            </div>
            <Input
              value={otherRepos}
              onChange={(e) => setOtherRepos(e.target.value)}
              placeholder="other repos (comma-separated)"
              className="text-xs"
              data-testid="coord-spawn-other-repos"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-intent">
              Intent{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="spawn-intent"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="One-liner describing what this agent will do"
              data-testid="coord-spawn-intent"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-overlap">
              Declared overlap paths (one per line, optional)
            </Label>
            <Textarea
              id="spawn-overlap"
              rows={3}
              value={overlapPaths}
              onChange={(e) => setOverlapPaths(e.target.value)}
              placeholder={
                "backend/app/api/v1/endpoints/operations.py\nfrontend/src/app/(app)/admin/coord/spawn/page.tsx"
              }
              className="font-mono text-xs"
              data-testid="coord-spawn-overlap-paths"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-prompt">Initial prompt</Label>
            <Textarea
              id="spawn-prompt"
              rows={6}
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="You are Wave N of plan X. Your scope: ..."
              data-testid="coord-spawn-initial-prompt"
            />
          </div>

          {error && (
            <p
              className="text-sm text-destructive"
              data-testid="coord-spawn-error"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            data-testid="coord-spawn-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="coord-spawn-submit"
          >
            {submitting
              ? "Spawning..."
              : anchored
                ? "Spawn"
                : "Spawn unanchored"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
