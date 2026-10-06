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
 * Inputs — only repos and the prompt are REQUIRED, because only those are
 * required by coord (`agents_spawn.rs`):
 *   - work_unit_slug (OPTIONAL; preset by parent — disabled, contextual).
 *     Sent under the `work_unit_slug` wire key since Stage 4a of plan
 *     `2026-07-28-coord-post-plan-slug-surfaces-rename`; the value always
 *     named a work-unit slug. See the wire-key note on `handleSubmit`.
 *   - plan_phase  (OPTIONAL free-text input; the leading integer is extracted
 *     and sent as `plan_phase`, which coord types `Option<u32>`. A phase with
 *     no digits is omitted from the body rather than sent as a string.)
 *   - intent      (OPTIONAL short free-text description)
 *   - declared_overlap_paths (OPTIONAL newline-delimited list)
 *   - device_id   (OPTIONAL since coord#2403 — plan
 *     `2026-09-20-runner-selector-drives-a-transport-not-a-target` Phase 5).
 *     Left blank, the spawn is AUTOMATIC: `target_device_id` is omitted and
 *     coord places the session (fresh heartbeat, capabilities, not drained,
 *     under its session cap). A device picked from /operations/fleet/health,
 *     or typed when that roster is empty or unreachable, is sent as
 *     `target_device_id` and is a CHECKED PIN: coord refuses an ineligible one
 *     (409 `pin_ineligible`) rather than moving the session. A typed id is
 *     validated against coord's `Uuid` before submit rather than after a 422.
 *   - required_capabilities (OPTIONAL; comma/space-separated) — sent only
 *     when non-empty. Applies to both arms: coord filters its pick by it, and
 *     checks a pin against it.
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
 * coord-side agent_id, the device it landed on and WHO chose that device
 * (`placed_by`: coord, or your pin) are surfaced; the parent decides whether to
 * navigate (we don't auto-route — operators are spawning many agents
 * in sequence during readiness waves).
 *
 * ## The body guard (plan `2026-09-02-bodyless-work-units-…`, Phase 3)
 *
 * An anchored spawn points a session at a coord work unit, and a work unit is
 * a slug with no body. Nothing on this path used to ask whether a plan
 * document exists; an operator one-clicked Spawn on a bodyless row, wrote
 * "implement this plan", and a machine account burned a session discovering
 * there was none.
 *
 * The optional {@link SpawnModalProps.workUnit} prop closes that. When the
 * opener hands it a row whose signals say the document is missing (or cannot
 * be confirmed), the modal states the cost, requires one acknowledgement
 * before Spawn enables, and SEEDS the prompt to say *author the plan* instead
 * of leaving it blank for "implement this plan" to be typed into.
 *
 * Three properties, each load-bearing:
 *
 *   - **It is not a block.** Spawning a session to AUTHOR the plan from good
 *     metadata is a legitimate and common move — it is how the originating
 *     incident was resolved. One checkbox, no dead end (§9).
 *   - **It is not a second modal.** This surface's idiom for "here is
 *     something you should know" is an inline notice panel
 *     (`coord-spawn-unanchored-notice`, `coord-spawn-device-notice`,
 *     `coord-spawn-account-notice`), and a Dialog on top of a Dialog is not
 *     that. The hue comes from the shared body-signal chip rather than being
 *     minted here, so an `unknown` never borrows a `false`'s colour.
 *   - **Absent means absent.** A caller that passes no `workUnit` — every
 *     caller before this change, and any build whose backend predates the
 *     fields — gets exactly today's modal. "Not told" is silence about a
 *     document, not evidence of one, and it must not mint a new interruption
 *     on a path that never had one.
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
// The guard's PREDICATE and its COPY are shared with `/plans`' row action, so
// the two entry points cannot answer "does this deserve a confirm?"
// differently. Only the layout below is this file's.
import {
  describeHasBody,
  deriveSpawnBodyConfirm,
  seedSpawnPrompt,
  type SpawnBodySubject,
} from "@/components/admin/coord/planBodySignal";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { DevicePicker } from "@/components/operations/DevicePicker";
import {
  describeSpawnPlacement,
  describeSpawnRefusal,
  outcomeUnknownRefusal,
  parseRequiredCapabilities,
  type SpawnRefusal,
} from "@/components/admin/coord/spawnPlacement";
import {
  ACCOUNT_AUTO,
  API,
  KNOWN_REPOS,
  UUID_RE,
  buildSpawnRequestBody,
  canSubmitSpawn,
  formatUtilization,
} from "@/components/admin/coord/spawnModel";
import { useSpawnRoster } from "@/components/admin/coord/useSpawnRoster";

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
  /**
   * The anchored work unit's row, for the body guard and the seeded prompt.
   *
   * `planSlug` above stays the anchor that reaches the wire; this carries only
   * what the guard reads plus the title it puts in the seeded prompt. Optional
   * by design: absent changes nothing at all (see the module doc), so an
   * unanchored spawn simply omits it.
   */
  workUnit?: SpawnBodySubject & Pick<CoordPlanRow, "title">;
  /** Plan phase pre-seed; the user can override before submitting. */
  initialPhase?: string;
  /** Called after a successful spawn with the coord response body. */
  onSuccess?: (agent: { agent_id?: string; [k: string]: unknown }) => void;
}

export function SpawnModal({
  open,
  onClose,
  planSlug = "",
  workUnit,
  initialPhase,
  onSuccess,
}: SpawnModalProps) {
  /** An unanchored spawn is one with no work-unit slug. It is a normal
   *  state, not an error: `coord.sessions.work_unit_slug` is nullable and
   *  the sessions list carries no work-unit predicate. What it gives up is
   *  the advance declared-overlap signal, not claims or tenant scoping.
   *
   *  Moved up from beside `canSubmit` because the body guard now reads it,
   *  and the guard's answer has to exist before the reset effect that seeds
   *  the prompt from it. */
  const anchored = planSlug.trim().length > 0;

  /** Whether this spawn needs a confirm first, and on which arm — `null` for
   *  every case that must behave exactly as it always did. An unanchored
   *  spawn is anchored to no work unit, so there is nothing to guard. */
  const bodyConfirm = useMemo(
    () => (anchored ? deriveSpawnBodyConfirm(workUnit) : null),
    [anchored, workUnit]
  );
  /** The ARM, as a primitive. The reset effect below depends on this rather
   *  than on `bodyConfirm` or `workUnit`: an object identity that changes on
   *  a parent re-render would re-run the reset and silently discard whatever
   *  the operator had typed. */
  const bodyRisk = bodyConfirm?.risk ?? null;
  const workUnitTitle = workUnit?.title;
  /** The registry's own chip for this row's verdict, reused verbatim so the
   *  modal and `/plans` cannot describe the same work unit differently.
   *  `null` only in the cases {@link bodyConfirm} is null too. */
  const bodyMarker = useMemo(
    () =>
      bodyConfirm === null
        ? null
        : describeHasBody(workUnit?.has_body, workUnit?.body_unknown_reason),
    [bodyConfirm, workUnit?.has_body, workUnit?.body_unknown_reason]
  );

  const [phase, setPhase] = useState(initialPhase ?? "");
  const [deviceId, setDeviceId] = useState("");
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [otherRepos, setOtherRepos] = useState("");
  const [intent, setIntent] = useState("");
  const [overlapPaths, setOverlapPaths] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** The last refusal, derived by `describeSpawnRefusal` so each coord code
   *  reads as what happened and what to do — never a raw `HTTP 409: {…}`. */
  const [refusal, setRefusal] = useState<SpawnRefusal | null>(null);
  /** The trimmed device id the REFUSED request was sent for (`""` for an
   *  automatic spawn). The drain override is offered — and sent — only while
   *  this still equals the device on screen, so a response that lands after
   *  the operator switched devices can never override a drain on a machine
   *  nobody was told is drained. */
  const [refusalDevice, setRefusalDevice] = useState("");
  /** Free-text `required_capabilities`. */
  const [capabilities, setCapabilities] = useState("");
  /** Has the operator acknowledged the body guard? Only consulted when
   *  {@link bodyConfirm} is non-null, so it never gates a spawn that was
   *  never flagged. */
  const [bodyAcknowledged, setBodyAcknowledged] = useState(false);

  /** The typed value, normalized the same way the wire body normalizes it. */
  const deviceIdValue = deviceId.trim();
  /** A roster pick is a uuid by construction; a TYPED one is not. Guard here
   *  so an obviously-bad id costs a hint rather than a round trip to a 422. */
  const deviceIdValid = UUID_RE.test(deviceIdValue);
  const {
    devices,
    devicesLoading,
    devicesError,
    manualDevice,
    setManualDevice,
    unreadableAccountRows,
    columnsProvisioned,
    accountRoster,
    selectionMode,
    account,
    setAccount,
    accountPin,
    pinnedRow,
    deviceLabel,
    deviceHeadlineName,
    resetRoster,
  } = useSpawnRoster(open, deviceIdValue);

  // Reset form state on every open so a fresh spawn doesn't inherit
  // the previous one.
  useEffect(() => {
    if (!open) return;
    setPhase(initialPhase ?? "");
    setDeviceId("");
    resetRoster();
    setSelectedRepos([]);
    setOtherRepos("");
    setIntent("");
    setOverlapPaths("");
    setCapabilities("");
    // The one field that is NOT always blanked. When the work unit may have
    // no plan, the blank prompt is the hazard: it is what "implement this
    // plan" got typed into. Seed the honest instruction instead — the
    // operator can still edit or clear it, and every unflagged spawn opens
    // empty exactly as before.
    setInitialPrompt(
      bodyRisk === null
        ? ""
        : seedSpawnPrompt(bodyRisk, {
            slug: planSlug.trim(),
            ...(workUnitTitle === undefined ? {} : { title: workUnitTitle }),
          })
    );
    setBodyAcknowledged(false);
    setRefusal(null);
    setSubmitting(false);
  }, [open, initialPhase, bodyRisk, planSlug, workUnitTitle, resetRoster]);

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

  /** No device named = coord places the session. The DEFAULT. */
  const automatic = deviceIdValue === "";
  const parsedCapabilities = useMemo(
    () => parseRequiredCapabilities(capabilities),
    [capabilities]
  );

  /** A refusal is about what was sent. Changing the device — including back
   *  to automatic — or the capability list drops it, and with it any offer
   *  to override that device's drain. */
  useEffect(() => {
    setRefusal(null);
  }, [deviceIdValue, capabilities]);

  const canSubmit = canSubmitSpawn({
    submitting,
    automatic,
    deviceIdValid,
    repoCount: allRepos.length,
    initialPrompt,
    bodyCleared: bodyConfirm === null || bodyAcknowledged,
  });

  const handleSubmit = useCallback(
    /** `overrideFor` — the device whose drain the operator chose to
     *  override. Honoured only when it is still the device being sent. */
    async (overrideFor?: string) => {
      setRefusal(null);
      setSubmitting(true);
      const sentDevice = deviceId.trim();
      const pinned = sentDevice !== "";
      const overrideDrain = pinned && overrideFor === sentDevice;
      try {
        // Shape is dictated by coord's `SpawnRequest` and pinned by
        // `SpawnModal.test.ts` — see `buildSpawnRequestBody` in `spawnModel.ts`.
        const body = buildSpawnRequestBody({
          workUnitSlug: planSlug,
          phase,
          deviceId,
          requiredCapabilities: parsedCapabilities,
          overrideDrain,
          repos: allRepos,
          intent,
          declaredOverlapPaths: parsedOverlapPaths,
          account: accountPin,
          initialPrompt,
        });
        /** No readable answer came back from a request that may have been
         *  acted on: say so, never "failed" — a blind retry could make two. */
        const outcomeUnknown = (detail: string) => {
          const derived = outcomeUnknownRefusal(detail);
          setRefusalDevice(sentDevice);
          setRefusal(derived);
          toast.error(derived.headline);
        };
        let res: Response;
        try {
          res = await fetch(`${API}/agents/spawn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {
          outcomeUnknown(e instanceof Error ? e.message : String(e));
          return;
        }
        if (!res.ok) {
          let text = "";
          try {
            text = await res.text();
          } catch {
            // An unreadable refusal body still has a status to go on.
          }
          const derived = describeSpawnRefusal(res.status, text, {
            pinned,
            deviceName: pinned ? deviceHeadlineName(sentDevice) : "",
            deviceId: sentDevice,
          });
          setRefusal(derived);
          setRefusalDevice(sentDevice);
          toast.error(derived.headline);
          return;
        }
        let result: {
          agent_id?: string;
          target_device_id?: string;
          placed_by?: string;
          [k: string]: unknown;
        };
        try {
          result = (await res.json()) as typeof result;
        } catch (e) {
          // A 2xx IS coord accepting the spawn — but with no readable body we
          // cannot say where it went, or even confirm it.
          outcomeUnknown(
            `coord answered HTTP ${res.status} but the body could not be read (${
              e instanceof Error ? e.message : String(e)
            })`
          );
          return;
        }
        // Where it went and who chose it: "coord placed it" and "your pin"
        // are different spawns, and the operator should never have to guess.
        const placement = describeSpawnPlacement(
          result,
          deviceLabel,
          parsedCapabilities.length > 0
        );
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
        const summary = result.agent_id
          ? `Spawned agent ${result.agent_id} ${label} ${placement.text}${accountLabel}`
          : `Agent spawned ${label} ${placement.text}${accountLabel}`;
        // Capabilities sent to a coord that ignored them is not a plain
        // success: the session may be on a machine that lacks them.
        if (placement.capabilitiesUnchecked) {
          toast.warning(summary);
        } else {
          toast.success(summary);
        }
        onSuccess?.(result);
        onClose();
      } finally {
        setSubmitting(false);
      }
    },
    [
      planSlug,
      anchored,
      phase,
      deviceId,
      deviceLabel,
      deviceHeadlineName,
      parsedCapabilities,
      allRepos,
      intent,
      parsedOverlapPaths,
      accountPin,
      initialPrompt,
      onSuccess,
      onClose,
    ]
  );

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
            Mint a coord agent on a device coord picks, or on one you name.
            Coord acquires claims, allocates the worktree, and delivers your
            initial prompt on first tick.
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

          {bodyConfirm && (
            /* Directly under the Plan field, because it is a statement ABOUT
               that plan. Neutral container, shared chip: the hue comes from
               `describeHasBody` so an `unknown` cannot borrow a `false`'s
               colour, and nothing here mints a red or an amber of its own
               (style guide §4.1). `data-risk` carries the arm so a page spec
               or a test can tell the two apart without reading the prose. */
            <div
              className="space-y-2 rounded-md border border-border bg-muted/40 p-2"
              data-testid="coord-spawn-body-confirm"
              data-risk={bodyConfirm.risk}
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center gap-2">
                {bodyMarker && (
                  <span
                    data-testid={`${bodyMarker.testId}-spawn`}
                    title={bodyMarker.title}
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ${bodyMarker.className}`}
                  >
                    {bodyMarker.label}
                  </span>
                )}
                <span
                  className="text-xs font-medium text-foreground"
                  data-testid={bodyConfirm.testId}
                >
                  {bodyConfirm.headline}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {bodyConfirm.detail}
              </p>
              {/* One checkbox, never a refusal: authoring the plan from the
                  work unit's metadata is a legitimate spawn and the reason
                  this is a confirm rather than a block (§9). */}
              <label
                htmlFor="spawn-body-ack"
                className="flex cursor-pointer items-start gap-2 text-xs text-foreground"
              >
                <Checkbox
                  id="spawn-body-ack"
                  checked={bodyAcknowledged}
                  onCheckedChange={(v) => setBodyAcknowledged(v === true)}
                  data-testid="coord-spawn-body-ack"
                />
                <span>{bodyConfirm.acknowledge}</span>
              </label>
            </div>
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
            <Label htmlFor="spawn-device">
              Device{" "}
              <span className="text-xs text-muted-foreground">
                (optional — blank lets coord pick)
              </span>
            </Label>
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
                disabled={submitting}
                placeholder="blank = automatic, or a device id (uuid) to pin"
                className="font-mono text-xs"
                spellCheck={false}
                aria-invalid={deviceIdValue.length > 0 && !deviceIdValid}
                aria-describedby={
                  devicesError ? "spawn-device-notice" : undefined
                }
              />
            ) : (
              <DevicePicker
                id="spawn-device"
                devices={devices}
                value={deviceId}
                onChange={setDeviceId}
                disabled={submitting}
                placeholder="Automatic — coord picks a device"
                data-testid="coord-spawn-device-select"
                aria-describedby={
                  devicesError ? "spawn-device-notice" : undefined
                }
              />
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
                disabled={submitting}
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
            {/* Say which arm this spawn is on BEFORE submit. Calm hue on both:
                neither is waiting on anyone (style guide R3); the difference
                is stated in words. `data-placement` carries the arm for a
                spec or test without reading the prose. */}
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
              data-testid="coord-spawn-placement-mode"
              data-placement={automatic ? "automatic" : "pin"}
              role="status"
              aria-live="polite"
            >
              {automatic ? (
                <span>
                  <span className="font-medium text-foreground">Automatic</span>{" "}
                  — coord picks an online, undrained device of this tenant that
                  has the required capabilities and room under its session cap.
                </span>
              ) : (
                <>
                  <span>
                    <span className="font-medium text-foreground">Pinned</span>{" "}
                    to{" "}
                    <span className="font-mono">
                      {deviceIdValid
                        ? deviceLabel(deviceIdValue)
                        : deviceIdValue}
                    </span>
                    . Coord checks it and refuses — it never moves the session —
                    if this device is offline, lacks a required capability, is
                    not an agent host, or is drained.
                  </span>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    data-testid="coord-spawn-device-automatic"
                    disabled={submitting}
                    onClick={() => setDeviceId("")}
                  >
                    Use automatic placement
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="spawn-capabilities">
              Required capabilities{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="spawn-capabilities"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              disabled={submitting}
              placeholder="e.g. os:linux, docker"
              className="font-mono text-xs"
              spellCheck={false}
              data-testid="coord-spawn-capabilities"
            />
            <p className="text-xs text-muted-foreground">
              {automatic
                ? "Coord only picks a device that advertises every one of these."
                : "Coord refuses the named device if it lacks any of these — " +
                  "where coord supports capability checks. If it does not, " +
                  "the spawn confirmation says the list was not checked."}
            </p>
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
            {/* A pre-filled field with no explanation reads as one the
                operator must not touch, and this one they should. */}
            {bodyConfirm && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="coord-spawn-prompt-seed-notice"
              >
                {bodyConfirm.promptNote}
              </p>
            )}
          </div>

          {refusal && (
            /* A refusal is the operator's move now, so it takes the
               destructive hue on the headline only (R3); the detail and the
               remedy are words. `coord-spawn-error` is the frozen testid the
               plain error line carried; `data-refusal` names the arm. */
            <div
              className="space-y-1 rounded-md border border-border p-2"
              data-testid="coord-spawn-refusal"
              data-refusal={refusal.kind}
              role="alert"
            >
              <p
                className="text-sm font-medium text-destructive"
                data-testid="coord-spawn-error"
              >
                {refusal.headline}
              </p>
              {refusal.detail && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="coord-spawn-refusal-detail"
                >
                  {refusal.detail}
                </p>
              )}
              {refusal.remedy && (
                <p
                  className="text-xs text-foreground"
                  data-testid="coord-spawn-refusal-remedy"
                >
                  {refusal.remedy}
                </p>
              )}
              {/* Only for a drained device the operator NAMED — see
                  `SpawnRefusal.offerOverride` — and only while that device is
                  still the one on screen (`refusalDevice`), so a stale
                  refusal can never override a drain on another device or on
                  an automatic spawn. */}
              {refusal.offerOverride &&
                !automatic &&
                refusalDevice === deviceIdValue && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canSubmit}
                    onClick={() => void handleSubmit(refusalDevice)}
                    data-testid="coord-spawn-override-drain"
                  >
                    Spawn on this drained device anyway
                  </Button>
                )}
            </div>
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
            onClick={() => void handleSubmit()}
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
