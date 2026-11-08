"use client";

/**
 * ContinueDialog — spawn a session to continue a subproject, at a chosen
 * effort, on the next available runner or a pinned device (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * D8, Phase 6).
 *
 * Submit is `POST /api/v1/operations/subprojects/{id}/spawn`. coord composes
 * the brief from the subproject's next steps, writes the PENDING membership
 * before it publishes the launch, and places the session through
 * `/agents/spawn`'s own placement — a hard pin when a device is named, its
 * pool otherwise — so this dialog states placement the way the spawn modal
 * does and reuses its roster (`useSpawnRoster`, `DevicePicker`).
 *
 * The action acknowledges itself (served policy `ux-priorities`
 * `an-action-must-acknowledge-itself`): on success the dialog stays open on
 * what coord answered — the allocation id, where the session went and who
 * chose it, and "effort requested <x> · applied: not reported" — until the
 * operator closes it. A refusal is coord's typed answer, worded
 * (`continueModel.ts` `describeContinueRefusal`); a request that may have
 * landed without an answer says so rather than "failed".
 *
 * Every rule lives in `continueModel.ts`, which has no React and is pinned by
 * its own test; this file is the layout.
 */

import { useCallback, useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Rocket } from "lucide-react";
import {
  DevicePicker,
  pickableDevices,
} from "@/components/operations/DevicePicker";
import { useSpawnRoster } from "@/components/admin/coord/useSpawnRoster";
import { outcomeUnknownRefusal } from "@/components/admin/coord/spawnPlacement";
import { fetchPromptDocument } from "@/lib/api/operations/coordPromptDocuments";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import {
  continueSubproject,
  type SubprojectEffort,
  type SubprojectSpawnResponse,
} from "@/lib/api/operations/coordSubprojects";
import {
  APPLIED_EFFORT_NOT_REPORTED,
  EFFORTS,
  EFFORT_PROFILES_DOCUMENT,
  FALLBACK_EFFORT,
  buildContinueRequestBody,
  canSubmitContinue,
  describeContinuePlacement,
  describeContinueRefusal,
  describeEffortDefault,
  describeEffortOutcome,
  effortDefaultAfterReadFailure,
  effortDefaultFromProfiles,
  isDeviceId,
  isEffort,
  parseRepoList,
  readContinueResponse,
  type ContinueRefusal,
  type EffortDefault,
} from "./continueModel";

export interface ContinueDialogProps {
  open: boolean;
  onClose: () => void;
  subprojectId: string;
  subprojectTitle: string;
  /** The repos the Repos field opens with (`defaultContinueRepos`). */
  defaultRepos: readonly string[];
  /** Called after coord accepted the spawn, so the page can re-read. */
  onContinued?: () => void;
}

export function ContinueDialog({
  open,
  onClose,
  subprojectId,
  subprojectTitle,
  defaultRepos,
  onContinued,
}: ContinueDialogProps) {
  const [effortDefault, setEffortDefault] = useState<EffortDefault | null>(
    null
  );
  /** The operator's own choice; `null` until they make one, so the served
   *  default — which lands after the dialog opens — is what shows until then. */
  const [effortChoice, setEffortChoice] = useState<SubprojectEffort | null>(
    null
  );
  const [ultracodeChoice, setUltracodeChoice] = useState<boolean | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [reposText, setReposText] = useState(() => defaultRepos.join(", "));
  const [addendum, setAddendum] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<ContinueRefusal | null>(null);
  const [result, setResult] = useState<Partial<SubprojectSpawnResponse> | null>(
    null
  );

  const device = deviceId.trim();
  const roster = useSpawnRoster(open, device);

  // Read the effort profiles afresh on every open — the page mounts this
  // dialog only while it is open, so every field above starts from scratch
  // and a re-read of the page never resets one under the operator — and an
  // operator who edits the playbook and opens Continue again gets the edit.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchPromptDocument(
      EFFORT_PROFILES_DOCUMENT.kind,
      EFFORT_PROFILES_DOCUMENT.name
    )
      .then((doc) => {
        if (!cancelled) setEffortDefault(effortDefaultFromProfiles(doc));
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setEffortDefault(
            effortDefaultAfterReadFailure(operationsErrorMessage(err))
          );
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const effort: SubprojectEffort =
    effortChoice ?? effortDefault?.effort ?? FALLBACK_EFFORT;
  const ultracode = ultracodeChoice ?? effortDefault?.ultracode ?? false;

  const repos = parseRepoList(reposText);
  const automatic = device === "";
  const canSubmit = canSubmitContinue({ submitting, deviceId });

  const handleSubmit = useCallback(async () => {
    setRefusal(null);
    setSubmitting(true);
    const pinned = device !== "";
    try {
      const body = buildContinueRequestBody({
        effort,
        ultracode,
        deviceId: device,
        repos,
        addendum,
      });
      const unknownOutcome = (detail: string) => {
        const u = outcomeUnknownRefusal(detail);
        setRefusal({
          kind: u.kind,
          headline: u.headline,
          detail: u.detail,
          remedy: u.remedy,
        });
        toast.error(u.headline);
      };
      let res: Response;
      try {
        res = await continueSubproject(subprojectId, body);
      } catch (e) {
        unknownOutcome(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!res.ok) {
        let text = "";
        try {
          text = await res.text();
        } catch {
          // An unreadable refusal body still has a status to go on.
        }
        const derived = describeContinueRefusal(res.status, text, {
          pinned,
          deviceName: pinned ? roster.deviceHeadlineName(device) : "",
          deviceId: device,
        });
        setRefusal(derived);
        toast.error(derived.headline);
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch (e) {
        unknownOutcome(
          `coord answered HTTP ${res.status} but the body could not be read (${
            e instanceof Error ? e.message : String(e)
          })`
        );
        return;
      }
      const read = readContinueResponse(json) ?? {};
      setResult(read);
      toast.success(
        `Continue sent ${describeContinuePlacement(read, roster.deviceLabel)} — ${describeEffortOutcome(read)}`
      );
      onContinued?.();
    } finally {
      setSubmitting(false);
    }
  }, [
    device,
    effort,
    ultracode,
    repos,
    addendum,
    subprojectId,
    roster,
    onContinued,
  ]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="subproject-continue-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Continue “{subprojectTitle}”
          </DialogTitle>
          <DialogDescription>
            Spawns one session to keep this subproject moving. coord writes its
            brief from the subproject&apos;s next steps; anything you add below
            is appended to it.
          </DialogDescription>
        </DialogHeader>

        {result !== null ? (
          <ContinueAcknowledgement
            result={result}
            deviceLabel={roster.deviceLabel}
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="subproject-continue-effort">Effort</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={effort}
                  onValueChange={(v) => {
                    if (isEffort(v)) setEffortChoice(v);
                  }}
                  disabled={submitting}
                >
                  <SelectTrigger
                    id="subproject-continue-effort"
                    className="w-[140px]"
                    data-testid="subproject-continue-effort"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EFFORTS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={ultracode}
                    onCheckedChange={(c) => setUltracodeChoice(c === true)}
                    disabled={submitting}
                    data-testid="subproject-continue-ultracode"
                  />
                  ultracode
                </label>
              </div>
              <p
                className="text-xs text-muted-foreground"
                data-testid="subproject-continue-effort-source"
              >
                {effortDefault === null
                  ? "Reading the effort profiles (agent_playbook/spawn-effort-profiles)…"
                  : describeEffortDefault(effortDefault)}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="subproject-continue-device">Runner</Label>
              {roster.devicesLoading ? (
                <Input
                  id="subproject-continue-device"
                  disabled
                  placeholder="Loading devices…"
                  className="font-mono text-xs"
                />
              ) : roster.manualDevice ? (
                <Input
                  id="subproject-continue-device"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  disabled={submitting}
                  placeholder="blank = next available runner, or a device id (uuid) to pin"
                  className="font-mono text-xs"
                  spellCheck={false}
                  aria-invalid={device !== "" && !isDeviceId(device)}
                  data-testid="subproject-continue-device-input"
                />
              ) : (
                <DevicePicker
                  id="subproject-continue-device"
                  devices={roster.devices}
                  value={deviceId}
                  onChange={setDeviceId}
                  disabled={submitting}
                  placeholder="Next available runner"
                  data-testid="subproject-continue-device-select"
                />
              )}
              {roster.devicesError && (
                <p
                  className={
                    roster.devicesError.kind === "fault"
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                  role="status"
                  data-testid="subproject-continue-device-notice"
                >
                  {roster.devicesError.message}
                </p>
              )}
              {device !== "" && !isDeviceId(device) && (
                <p className="text-xs text-destructive">
                  Not a device id — coord pins only a device uuid.
                </p>
              )}
              <div
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
                data-testid="subproject-continue-placement"
                data-placement={automatic ? "pool" : "pinned"}
                role="status"
                aria-live="polite"
              >
                {automatic ? (
                  <span>
                    <span className="font-medium text-foreground">
                      Next available runner
                    </span>{" "}
                    — coord picks an online, undrained device of this tenant
                    with room under its session cap.
                  </span>
                ) : (
                  <>
                    <span>
                      <span className="font-medium text-foreground">
                        Pinned
                      </span>{" "}
                      to{" "}
                      <span className="font-mono">
                        {isDeviceId(device)
                          ? roster.deviceLabel(device)
                          : device}
                      </span>
                      . coord refuses — never moves the session — if it is
                      offline, drained or at its cap.
                    </span>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      disabled={submitting}
                      onClick={() => setDeviceId("")}
                      data-testid="subproject-continue-automatic"
                    >
                      Use the next available runner
                    </button>
                  </>
                )}
              </div>
              {!roster.devicesLoading &&
                (!roster.manualDevice ||
                  pickableDevices(roster.devices).shown.length > 0) && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    disabled={submitting}
                    onClick={() => {
                      roster.setManualDevice((v) => !v);
                      setDeviceId("");
                    }}
                  >
                    {roster.manualDevice
                      ? `Choose from the roster (${pickableDevices(roster.devices).shown.length})`
                      : "Enter a device id instead"}
                  </button>
                )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="subproject-continue-repos">
                Repos{" "}
                <span className="text-xs text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="subproject-continue-repos"
                value={reposText}
                onChange={(e) => setReposText(e.target.value)}
                disabled={submitting}
                placeholder="empty = coord derives them from the members"
                className="font-mono text-xs"
                spellCheck={false}
                data-testid="subproject-continue-repos"
              />
              <p className="text-xs text-muted-foreground">
                {defaultRepos.length > 0
                  ? "Filled from this subproject's pull requests. Clear it to let coord derive the repos from its work units and worktrees."
                  : "Left empty, coord derives the repos from the subproject's work units and worktrees, and says so if it finds none."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="subproject-continue-addendum">
                Add to the brief{" "}
                <span className="text-xs text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="subproject-continue-addendum"
                value={addendum}
                onChange={(e) => setAddendum(e.target.value)}
                disabled={submitting}
                rows={4}
                placeholder="Anything the session should know beyond the subproject's next steps."
                data-testid="subproject-continue-addendum"
              />
            </div>

            {refusal && (
              <div
                className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
                role="alert"
                data-testid="subproject-continue-refusal"
                data-refusal-kind={refusal.kind}
              >
                <p className="m-0 font-medium text-destructive">
                  {refusal.headline}
                </p>
                {refusal.detail && (
                  <p className="m-0 text-muted-foreground">{refusal.detail}</p>
                )}
                {refusal.remedy && <p className="m-0">{refusal.remedy}</p>}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result !== null ? (
            <Button onClick={onClose} data-testid="subproject-continue-close">
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                data-testid="subproject-continue-submit"
              >
                {submitting ? "Continuing…" : `Continue at ${effort}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What coord answered, kept on screen until the operator closes it. */
function ContinueAcknowledgement({
  result,
  deviceLabel,
}: {
  result: Partial<SubprojectSpawnResponse>;
  deviceLabel: (deviceId: string) => string;
}) {
  return (
    <div
      className="space-y-2 text-sm"
      role="status"
      data-testid="subproject-continue-result"
    >
      <p className="m-0 font-medium">✓ Continue sent.</p>
      <p className="m-0" data-testid="subproject-continue-allocation">
        Allocation{" "}
        {result.allocation_agent_id ? (
          <span className="font-mono text-xs">
            {result.allocation_agent_id}
          </span>
        ) : (
          <span className="text-muted-foreground">
            — coord returned no allocation id
          </span>
        )}
      </p>
      <p className="m-0" data-testid="subproject-continue-placement-result">
        Placed {describeContinuePlacement(result, deviceLabel)}.
      </p>
      <p
        className="m-0"
        title={APPLIED_EFFORT_NOT_REPORTED}
        data-testid="subproject-continue-effort-result"
      >
        {describeEffortOutcome(result)}
      </p>
      <p className="m-0 text-xs text-muted-foreground">
        Repos:{" "}
        {result.repos && result.repos.length > 0
          ? result.repos.join(", ")
          : "coord did not echo them"}
        . The session is a pending member of this subproject until its runner
        reports it.
      </p>
      {result.brief_preview && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            The brief coord composed
          </summary>
          <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-muted/30 p-2 font-mono text-[11px]">
            {result.brief_preview}
          </pre>
        </details>
      )}
    </div>
  );
}
