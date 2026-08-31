"use client";

/**
 * Coord dispatch on a Dev Ops machine row — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 1.
 *
 * Coord has shipped `POST /coord/fleet/drain` / `/undrain` since
 * `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §D2, with a mandatory
 * expiry and a four-way audit trail — and until this phase qontinui-web had no
 * proxy for either, so the console could not reach the one reversible, audited
 * lever the fleet already owns. This is that exposure. No new coord code is
 * involved and no new state is invented: the write lands in
 * `coord.fleet_runtime_policy.drain` JSONB, zero new columns.
 *
 * ## Shape: a per-row disclosure, not a page-level panel
 *
 * Modelled on `CiCapacityDisclosure`, which already wraps a write-bearing
 * control as a collapsed per-machine disclosure on these same rows, on the Dev
 * Ops page's own stated principle that "the knob and the telemetry that says
 * what to set it to belong in one viewport". Like that one it carries **no
 * `storageKey`**: this is a consent surface, not a preference, and the
 * persisted-open behaviour every other console panel has would put a
 * fleet-mutating control under a scrolling cursor on the next visit. Collapsed
 * also means UNMOUNTED, so a closed row holds no draft reason.
 *
 * ## Interaction: `EmergencyStopControl`'s, deliberately
 *
 * A typed reason refused locally when blank (coord requires it and the audit
 * row is the point), a `window.confirm` carrying scope-specific blast-radius
 * copy, and explanatory text that TRACKS the selected action so the reassuring
 * sentence and the real effect can never be on screen disagreeing. Never
 * batched into a Save button — this fires on its own click or not at all.
 *
 * ## Naming: read `coordDrain.ts` before renaming anything here
 *
 * The control is "Pause coord dispatch", not "Disable". The three things a
 * drain does NOT do — GitHub routing, session spawning, the slot clamp — are
 * in `drainScopeSentences` and are rendered in the same viewport as the
 * button, because a control that overstates its reach is worse than no control.
 */

import { useCallback, useState } from "react";
import { AlertTriangle, HelpCircle, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollapsiblePanel } from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import {
  DEFAULT_DRAIN_WINDOW_ID,
  DRAIN_WINDOWS,
  describeDrainResult,
  drainConfirmText,
  drainScopeSentences,
  drainUntilIso,
  reasonRefusal,
  resolveDrainWindow,
  undrainConfirmText,
  type DrainResponse,
} from "./coordDrain";

const log = createLogger("CoordDispatchDisclosure");

export interface CoordDispatchDisclosureProps {
  /**
   * The coord device this row resolved to, or `undefined` when it resolved to
   * none. The drain map is keyed by `device_id` and nothing else — a hostname
   * cannot address it — so a row with no device carries no control, and says
   * that rather than rendering a disabled button (a disabled button reads as
   * "dispatch is off here", which is a claim about the machine rather than
   * about the join).
   */
  deviceId?: string;
  /** For the confirm copy and the result line. Never used to address coord. */
  hostname: string;
  /**
   * True when this row reached the machine list ONLY because coord's CI-runner
   * mirror named it — a GitHub Actions runner rather than a workstation.
   *
   * It adds one sentence to the scope note and changes nothing else. **It does
   * NOT withhold the control**, and an earlier cut of this file that did was
   * wrong on its premise: `ci_runner_registrar` does bind these devices to
   * their repo's owning tenants, in `bind_runners_to_repo_tenants` — a separate
   * INSERT into `coord.tenant_devices` run after `register_device`, which is
   * why `register_device`'s own empty `tenant_ids` proves nothing. That binding
   * is also the JOIN `list_ci_runners` selects on, so a row can only reach this
   * page BECAUSE it exists, and `fleet_drain`'s Gate 2 — which checks that same
   * binding — passes for these devices. Telling the operator the host cannot be
   * paused would have been false where coord would have accepted the pause.
   */
  ciInfrastructure?: boolean;
}

/**
 * The scope block — the same three sentences the confirm dialog shows.
 *
 * Rendered FROM `drainScopeSentences`, not retyped beside it. The plan's
 * requirement is that the explanatory text tracks the control; that only holds
 * while both read one source, and a second hand-formatted copy here is exactly
 * how the reassuring sentence and the real blast radius end up on screen
 * together, disagreeing.
 */
function ScopeNote({
  hostname,
  ciInfrastructure,
}: {
  hostname: string;
  ciInfrastructure: boolean;
}) {
  return (
    <div
      className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2"
      data-testid="coord-dispatch-scope"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
        What pausing dispatch does — and does not do
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
        {drainScopeSentences(hostname).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
        {ciInfrastructure && (
          <li data-testid="coord-dispatch-ci-note">
            This host is a <strong>GitHub Actions runner</strong>. Pausing coord
            dispatch is a legal write for it, but the lever that takes it out of
            GitHub&apos;s routing is its <code>qontinui</code> label, shown
            above &mdash; not this.
          </li>
        )}
      </ul>
    </div>
  );
}

/** The shared shell for a row that has no control to offer. */
function DispatchNotice({
  state,
  headline,
  children,
}: {
  state: string;
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5"
      role="status"
      data-testid="coord-dispatch-unavailable"
      data-coord-dispatch={state}
    >
      <div className="flex items-center gap-1.5">
        <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {headline}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{children}</p>
    </div>
  );
}

function DispatchControl({
  deviceId,
  hostname,
  ciInfrastructure,
}: {
  deviceId: string;
  hostname: string;
  ciInfrastructure: boolean;
}) {
  const [reason, setReason] = useState("");
  const [windowId, setWindowId] = useState(DEFAULT_DRAIN_WINDOW_ID);
  const [submitting, setSubmitting] = useState<null | "drain" | "undrain">(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DrainResponse | null>(null);

  const selected = resolveDrainWindow(windowId);

  const fire = useCallback(
    async (action: "drain" | "undrain") => {
      setError(null);
      const refusal = reasonRefusal(reason);
      if (refusal) {
        setError(refusal);
        return;
      }
      const trimmed = reason.trim();
      // Computed at click time, not at render time: a tab left open for an
      // hour would otherwise post an expiry an hour closer than the one the
      // operator read, and a short window could post one already in the past.
      const until = drainUntilIso(Date.now(), selected.hours);
      const ok = window.confirm(
        action === "drain"
          ? drainConfirmText(hostname, until)
          : undrainConfirmText(hostname)
      );
      if (!ok) return;
      setSubmitting(action);
      try {
        const body =
          action === "drain"
            ? { device_id: deviceId, until, reason: trimmed }
            : { device_id: deviceId, reason: trimmed };
        const data = await httpClient.post<DrainResponse>(
          `${OPERATIONS_API}/fleet/${action}`,
          body
        );
        setResult(data);
        setReason("");
      } catch (err) {
        log.warn("coord dispatch write failed", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(null);
      }
    },
    [reason, selected.hours, deviceId, hostname]
  );

  return (
    <div className="space-y-2" data-testid={`coord-dispatch-${hostname}`}>
      <ScopeNote hostname={hostname} ciInfrastructure={ciInfrastructure} />

      {/* Current state, stated as UNKNOWN rather than as "not paused".
          Coord exposes no read of the drain map — `fleet_drain.rs` has no GET
          handler and no other route carries the map — so the only thing this
          page can honestly say on load is that it does not know. What THIS
          session wrote is known and appears below. */}
      <p
        className="text-[11px] text-muted-foreground"
        data-testid="coord-dispatch-state-unknown"
      >
        {result ? (
          <>
            Coord serves no read of the drain map, so the line below is what{" "}
            <em>this page&apos;s own write</em> returned — not a fresh reading.
            A pause set elsewhere, or one that has since expired, would not show
            here.
          </>
        ) : (
          <>
            <strong>Current state: unknown.</strong> Coord serves no read of the
            drain map, so this page cannot tell you whether this machine is
            paused right now — which is not the same as saying it is not. The
            durable record of who paused what, when and why is the operator
            audit feed below the machine list.
          </>
        )}
      </p>

      <div className="space-y-1">
        <Label
          htmlFor={`coord-dispatch-reason-${hostname}`}
          className="text-xs"
        >
          Reason (required)
        </Label>
        <Input
          id={`coord-dispatch-reason-${hostname}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. clippy failing 2/2 on this host; investigating"
          data-testid={`coord-dispatch-reason-${hostname}`}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`coord-dispatch-until-${hostname}`} className="text-xs">
          Expires after (required)
        </Label>
        {/* A plain <select>: the console's `Select` primitive is a portal-based
            popover, and this control lives inside a collapsed disclosure on a
            card grid where a native control is both smaller and keyboard-
            correct without extra wiring. */}
        <select
          id={`coord-dispatch-until-${hostname}`}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          value={windowId}
          onChange={(e) => setWindowId(e.target.value)}
          data-testid={`coord-dispatch-until-${hostname}`}
        >
          {DRAIN_WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          Coord requires an expiry and offers no open-ended form: a pause with
          no deadline is a permanent removal nobody remembers making. It lifts
          itself at the deadline; re-pausing is one click.
        </p>
      </div>

      {error && (
        <p
          className="flex items-center gap-1 text-xs text-red-500 dark:text-red-300"
          data-testid={`coord-dispatch-error-${hostname}`}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <p
          className="text-xs text-amber-600 dark:text-amber-300"
          data-testid={`coord-dispatch-result-${hostname}`}
        >
          {describeDrainResult(result)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={submitting !== null}
          onClick={() => void fire("drain")}
          data-testid={`coord-dispatch-pause-${hostname}`}
        >
          <Pause className="mr-1 h-3 w-3" />
          {submitting === "drain" ? "Pausing…" : "Pause coord dispatch"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={submitting !== null}
          onClick={() => void fire("undrain")}
          data-testid={`coord-dispatch-resume-${hostname}`}
        >
          <Play className="mr-1 h-3 w-3" />
          {submitting === "undrain" ? "Resuming…" : "Resume coord dispatch"}
        </Button>
      </div>
    </div>
  );
}

export function CoordDispatchDisclosure({
  deviceId,
  hostname,
  ciInfrastructure = false,
}: CoordDispatchDisclosureProps) {
  return (
    <div data-coord-dispatch-row={deviceId ? "device" : "no_device"}>
      <CollapsiblePanel
        data-testid="coord-dispatch-disclosure"
        // No `storageKey`, deliberately — see the module doc.
        defaultOpen={false}
        titleAs="div"
        icon={<Pause className="h-3.5 w-3.5" />}
        title="Coord dispatch"
        className="border-dashed p-3"
      >
        {deviceId ? (
          <CoordAdminOnly
            fallback={
              <ReadOnlyNotice label="Administrator only — coord requires an operator admin to drain a machine" />
            }
          >
            <DispatchControl
              deviceId={deviceId}
              hostname={hostname}
              ciInfrastructure={ciInfrastructure}
            />
          </CoordAdminOnly>
        ) : (
          <DispatchNotice
            state="no_device"
            headline="No coord device to address"
          >
            Coord&apos;s drain map is keyed by <code>device_id</code> and this
            row carries none — it reached the list through the runner inventory
            and coord&apos;s device read has no row for it. Nothing here says
            whether coord is dispatching to this machine; there is simply no id
            to match a machine record against.
          </DispatchNotice>
        )}
      </CollapsiblePanel>
    </div>
  );
}
