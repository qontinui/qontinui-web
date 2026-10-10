"use client";

import { AlertTriangle, Network, RefreshCw } from "lucide-react";
import { useUIComponent } from "@qontinui/ui-bridge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { FleetPolicyView } from "../../_shared/fleetPolicy";
import {
  useEgressPolicies,
  type EgressDial,
} from "../_hooks/useEgressPolicies";
import {
  EGRESS_FLOWS,
  EGRESS_LEVELS,
  type EgressFlowSpec,
  type EgressLevel,
} from "../types";

/**
 * Where the level shown came from, in the operator's words. A failed read is
 * `null` (UNKNOWN), never a guessed source.
 */
export function egressLevelSource(
  policy: FleetPolicyView | null
): string | null {
  if (policy === null) return null;
  switch (policy.resolved_scope) {
    case "tenant":
      return "tenant choice";
    case "repo":
      // The write rules refuse egress repo rows; one can only be legacy.
      return "repo row";
    case "system":
      return "fleet-wide system row";
    case "none":
      if (policy.default_source === "deployment_profile")
        return "deployment default";
      if (policy.default_source === "product") return "product default";
      return "default (source not reported)";
    default:
      return null;
  }
}

function isEgressLevel(level: string): level is EgressLevel {
  return (EGRESS_LEVELS as readonly string[]).includes(level);
}

function EgressRow({ spec, dial }: { spec: EgressFlowSpec; dial: EgressDial }) {
  const { policy, loading, saving, error, readbackError, setLevel } = dial;
  const level = policy?.effective_level ?? null;
  const source = egressLevelSource(policy);
  const canEdit = policy?.can_edit === true;
  // Only `on` lets a flow's bytes leave; the runner reads anything else as off.
  const allowed = level === "on";
  const testId = `egress-${spec.flow}`;

  return (
    <li
      className="flex flex-wrap items-start justify-between gap-3 border-t border-border py-3 first:border-t-0"
      data-testid={testId}
    >
      <div className="min-w-0 max-w-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{spec.label}</span>
          {loading && !policy ? (
            <Skeleton className="h-5 w-12" />
          ) : (
            <Badge
              variant={allowed ? "default" : "outline"}
              data-testid={`${testId}-level`}
            >
              {/* A failed read is UNKNOWN — never rendered as on. */}
              {level === null ? "unknown" : level}
            </Badge>
          )}
          {source !== null && (
            <span
              className="text-xs text-muted-foreground"
              data-testid={`${testId}-source`}
            >
              {source}
            </span>
          )}
          {spec.appliesAtNextStart && (
            <span
              className="text-xs text-muted-foreground"
              data-testid={`${testId}-next-start`}
            >
              · applies at each runner&apos;s next start
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{spec.description}</p>
        {level !== null && !isEgressLevel(level) && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            The resolved level &quot;{level}&quot; is neither on nor off;
            runners treat it as off.
          </p>
        )}
        {error && (
          <p
            className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300"
            data-testid={`${testId}-error`}
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Couldn&apos;t read this switch: {error}.{" "}
              {policy
                ? "Showing the last value read, which may be out of date."
                : "Whether this flow is on is unknown."}
            </span>
          </p>
        )}
        {readbackError && (
          <p
            className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300"
            data-testid={`${testId}-readback-error`}
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              The write was accepted, but reading it back failed (
              {readbackError}). The value shown may be stale.
            </span>
          </p>
        )}
      </div>
      {policy === null ? (
        // A failed or pending read has NO on/off state: rendering a Switch,
        // even an unchecked one, would claim "off". A status, not a control.
        <span
          role="status"
          aria-label={`${spec.label}: unknown`}
          className="inline-flex h-5 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground"
          data-testid={`${testId}-switch`}
        >
          ?
        </span>
      ) : (
        <Switch
          checked={allowed}
          disabled={!canEdit || saving}
          onCheckedChange={(checked) => {
            void setLevel(checked ? "on" : "off");
          }}
          aria-label={`${spec.label}: ${allowed ? "on" : "off"}`}
          data-testid={`${testId}-switch`}
        />
      )}
    </li>
  );
}

/**
 * The per-tenant egress switches (plan
 * `2026-10-10-spec-front-end-phase-9-generic-boundary` Phase 8): one row per
 * outbound data flow, giving what leaves and where it goes, the level runners
 * RESOLVE, where that level came from (tenant choice, deployment default or
 * product default), and a switch.
 *
 * Visible to every member; the switch is enabled only for a tenant admin
 * (`can_edit`), and coord re-checks the write. A row whose read failed renders
 * UNKNOWN with its switch disabled, never "on".
 */
export function EgressPanel() {
  const dials = useEgressPolicies();
  const anyLoading = EGRESS_FLOWS.some((f) => dials[f.flow].loading);
  const anyPolicy = EGRESS_FLOWS.some((f) => dials[f.flow].policy !== null);
  const anyEditable = EGRESS_FLOWS.some(
    (f) => dials[f.flow].policy?.can_edit === true
  );

  useUIComponent({
    id: "coord-tenant-egress",
    name: "Egress switches",
    description:
      "Per-tenant switches for the six outbound data flows a runner can send off its machine. Each action writes one flow's tenant-band level and resolves with whether the write was accepted.",
    actions: EGRESS_FLOWS.map((spec) => ({
      id: `set-egress-${spec.flow}`,
      label: `Set ${spec.label.toLowerCase()}`,
      description: `Write the tenant-band ${spec.domain} level. Params: {"level": "on" | "off"}. Resolves true when coord accepted the write; the panel then shows the level coord resolves.`,
      // A switch flip is a reversible write — declared, not re-derived.
      effect: "write",
      paramSchema: { level: { type: "string", enum: [...EGRESS_LEVELS] } },
      handler: async (params?: unknown) => {
        const level = (params as { level?: unknown } | undefined)?.level;
        if (typeof level !== "string" || !isEgressLevel(level)) {
          throw new Error(`level must be "on" or "off"`);
        }
        return dials[spec.flow].setLevel(level);
      },
    })),
  });

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="coord-tenant-egress"
      data-ui-bridge-id="coord.tenant-egress"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Network className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">
              Data leaving your machines
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Each runner checks these switches before it sends anything, so a
              flow that is off sends nothing. A runner picks up a change on its
              next policy poll.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            for (const f of EGRESS_FLOWS) void dials[f.flow].reload();
          }}
          disabled={anyLoading}
          data-testid="coord-tenant-egress-refresh"
        >
          <RefreshCw className={cn("size-3.5", anyLoading && "animate-spin")} />
        </Button>
      </div>

      {anyPolicy && !anyEditable && (
        <p
          className="mt-3 text-xs text-muted-foreground"
          data-testid="coord-tenant-egress-readonly"
        >
          Read-only: you are not an admin of this tenant, so coord would refuse
          the write (admin_required).
        </p>
      )}

      <ul className="mt-3">
        {EGRESS_FLOWS.map((spec) => (
          <EgressRow key={spec.flow} spec={spec} dial={dials[spec.flow]} />
        ))}
      </ul>
    </section>
  );
}
