"use client";

/**
 * SpawnModal — operator authoring surface for `POST /agents/spawn`.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 4 (Wave 4).
 *
 * Inputs:
 *   - work_unit_slug (preset by parent — disabled, contextual). Sent under
 *     the `work_unit_slug` wire key since Stage 4a of plan
 *     `2026-07-28-coord-post-plan-slug-surfaces-rename`; the value always
 *     named a work-unit slug. See the wire-key note on `handleSubmit`.
 *   - plan_phase  (free-text input; the leading integer is extracted and sent
 *     as `plan_phase`, which coord types `Option<u32>`. A phase with no
 *     digits is omitted from the body rather than sent as a string.)
 *   - device_id   (dropdown, sourced from /operations/fleet/health) — sent
 *     as `target_device_id`, the name coord requires
 *   - repos       (multi-select checkbox list of known repos) — sent as
 *     `[{ repo }]` objects, not bare strings
 *   - intent      (short free-text description)
 *   - declared_overlap_paths (newline-delimited list, optional)
 *   - initial_prompt (the agent's first-tick prompt body)
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
import { Skeleton } from "@/components/ui/skeleton";
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
 *  `duplicate field` error rather than resolved last-one-wins. */
export function buildSpawnRequestBody(input: {
  workUnitSlug: string;
  phase: string;
  deviceId: string;
  repos: string[];
  intent: string;
  declaredOverlapPaths: string[];
  initialPrompt: string;
}): Record<string, unknown> {
  const planPhase = parsePlanPhase(input.phase);
  return {
    work_unit_slug: input.workUnitSlug,
    // Omitted entirely when the operator's free-text phase carries no
    // digits — the field is optional, and sending a string 422s.
    ...(planPhase === undefined ? {} : { plan_phase: planPhase }),
    target_device_id: input.deviceId,
    repos: input.repos.map((repo) => ({ repo })),
    intent: input.intent.trim(),
    declared_overlap_paths: input.declaredOverlapPaths,
    initial_prompt: input.initialPrompt.trim(),
  };
}

export interface SpawnModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
  /** Plan slug to spawn for (set by the parent page row). */
  planSlug: string;
  /** Plan phase pre-seed; the user can override before submitting. */
  initialPhase?: string;
  /** Called after a successful spawn with the coord response body. */
  onSuccess?: (agent: { agent_id?: string; [k: string]: unknown }) => void;
}

export function SpawnModal({
  open,
  onClose,
  planSlug,
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
  /** Why the roster is unusable, when it is. `null` = the fetch succeeded.
   *
   *  An empty roster and a FAILED roster fetch used to render identically
   *  ("No devices reporting"), because the catch below only reached
   *  `console.warn`. They have opposite fixes — one is a coord-side
   *  liveness question, the other an auth/proxy fault — so the operator
   *  has to be able to tell them apart without opening devtools. */
  const [devicesError, setDevicesError] = useState<string | null>(null);
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
        // A 200 with an empty roster is a real answer, not a failure: coord
        // lists a device only while `last_seen_at` is inside
        // COORD_DEVICE_HEARTBEAT_TTL_SECS (120s) or it advertises a
        // health_url. Say so, rather than leaving a blank dropdown to be
        // read as "the fleet is down".
        if (roster.length === 0) {
          setDevicesError(
            "Coord reported 0 live devices for this tenant. A device is listed " +
              "only while its last heartbeat is inside coord's liveness window, " +
              "so a healthy machine can be absent between heartbeats. Enter the " +
              "device id directly if you know it."
          );
          setManualDevice(true);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const detail = e instanceof Error ? e.message : String(e);
        console.warn("[SpawnModal] fleet/health fetch failed", e);
        setDevices([]);
        setDevicesError(`Could not load the device roster — ${detail}.`);
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
      prev.includes(repo)
        ? prev.filter((r) => r !== repo)
        : [...prev, repo]
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

  const canSubmit =
    !submitting &&
    planSlug.length > 0 &&
    phase.trim().length > 0 &&
    deviceId.length > 0 &&
    allRepos.length > 0 &&
    intent.trim().length > 0 &&
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
      toast.success(
        result.agent_id
          ? `Spawned agent ${result.agent_id}`
          : "Agent spawned"
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
            Spawn agent from plan
          </DialogTitle>
          <DialogDescription>
            Mint a coord agent pinned to a device. Coord acquires
            claims, allocates the device, and delivers your initial
            prompt on first tick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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

          <div className="space-y-1.5">
            <Label htmlFor="spawn-plan-phase">Phase</Label>
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
              <Skeleton className="h-9 w-full" />
            ) : manualDevice ? (
              <Input
                id="spawn-device"
                data-testid="coord-spawn-device-input"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value.trim())}
                placeholder="target device id (uuid)"
                className="font-mono text-xs"
                spellCheck={false}
              />
            ) : (
              <Select value={deviceId} onValueChange={setDeviceId}>
                <SelectTrigger
                  id="spawn-device"
                  data-testid="coord-spawn-device-select"
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
                className="text-xs text-muted-foreground"
                data-testid="coord-spawn-device-notice"
              >
                {devicesError}
              </p>
            )}
            {!devicesLoading && (
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
                  ? `Choose from the roster${
                      devices.length > 0 ? ` (${devices.length})` : ""
                    }`
                  : "Enter a device id instead"}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Repos</Label>
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
            <Label htmlFor="spawn-intent">Intent</Label>
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
              placeholder={"backend/app/api/v1/endpoints/operations.py\nfrontend/src/app/(app)/admin/coord/spawn/page.tsx"}
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
            <p className="text-sm text-destructive" data-testid="coord-spawn-error">
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
            {submitting ? "Spawning..." : "Spawn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
