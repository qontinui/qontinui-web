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
  initialPrompt: string;
}): Record<string, unknown> {
  const planPhase = parsePlanPhase(input.phase ?? "");
  const workUnitSlug = (input.workUnitSlug ?? "").trim();
  const intent = (input.intent ?? "").trim();
  const overlapPaths = input.declaredOverlapPaths ?? [];
  return {
    // Omitted — never `""` — when the spawn is unanchored. See the
    // empty-string note above: `""` here manufactures a phantom plan.
    ...(workUnitSlug === "" ? {} : { work_unit_slug: workUnitSlug }),
    // Omitted entirely when the operator's free-text phase carries no
    // digits — the field is optional, and sending a string 422s.
    ...(planPhase === undefined ? {} : { plan_phase: planPhase }),
    target_device_id: input.deviceId.trim(),
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

  // Reset form state on every open so a fresh spawn doesn't inherit
  // the previous one.
  useEffect(() => {
    if (!open) return;
    setPhase(initialPhase ?? "");
    setDeviceId("");
    setManualDevice(false);
    setDevicesError(null);
    setDevices([]);
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
          : Promise.reject(new Error(`fleet/health returned HTTP ${res.status}`))
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
      toast.success(
        result.agent_id
          ? `Spawned agent ${result.agent_id} ${label}`
          : `Agent spawned ${label}`
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
