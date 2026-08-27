"use client";

/**
 * /admin/coord/policies — coordination + design policy surface.
 *
 * Two parts:
 *  - Design Policies (EDITABLE): tenant-scoped, user-authored UX/design
 *    policies backed by `project.design_policies` and read tool-agnostically
 *    by AI agents over `GET /api/v1/design-policies`. Writes gated server-side
 *    by tenant admin.
 *  - Autonomous next-step state (READ-ONLY): platform master-flag
 *    (master_enabled) + fleet table of tenants with non-default
 *    autonomy_level opt-ins. Plan `2026-05-30-decision-engine-tenant-ui.md`
 *    Phase 2 (§6.4).
 *
 * Page gated by is_superuser via the coord admin layout.
 *
 * ## Console style (Phase 3 Wave 4) — D2, on a shadcn `<Table>`
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` files this
 * route as Family C and keeps the table. What it gains:
 *
 * - **R1** — the master-flag `<Card>` becomes a `<HealthStrip>`: one derived
 *   traffic-light row answering "will coord dispatch for anyone?" plus the
 *   count cluster the tenant table's header badge used to carry. Derived from
 *   the SAME `/next-step-settings/fleet` response the table renders — no
 *   second fetch (R1's load-bearing clause).
 * - **R5** — tenant rows had no detail at all, so the raw `tenant_id` sat on
 *   every row as a permanent second line. Clicking a row now expands a
 *   full-width `<tr><td colSpan={4}>` `<RecordDetail>` that carries it.
 * - **R3** — `policyAutonomyStatus.ts` folds the two independent badges
 *   ("Autonomy" + a green "Yes"/outline "No" for Effective) into one audited
 *   status, so the state worth naming — *opted in, and coord will not
 *   dispatch* — is one badge instead of a cross-reference the reader assembles.
 * - **R9** — the `<h2>` + blurb sub-header and all three `<Card>` wrappers are
 *   gone; the console shell already supplies the title bar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Fragment } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { DesignPoliciesSection } from "./_components/DesignPoliciesSection";
import {
  HealthStrip,
  RecordDetail,
  StatusBadge,
  rowAccentClass,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import {
  derivePolicyAutonomyStatus,
  POLICY_STATUS_PALETTE,
} from "./policyAutonomyStatus";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────────────────

// The level union lives with the derivation that reads it (R8), so the page
// and its palette can never disagree about what coord's vocabulary is.
import type { AutonomyLevel } from "./policyAutonomyStatus";

interface TenantPolicySetting {
  tenant_id: string;
  slug: string;
  autonomy_level: AutonomyLevel;
  effective: boolean;
  updated_at: string;
}

interface FleetResponse {
  master_enabled: boolean;
  tenants: TenantPolicySetting[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The tenant's CHOSEN level, verbatim. Kept as its own chip (and keeping its
 * `autonomy-*` testids, D4a) beside the derived status badge: the level is the
 * configuration the operator edits, while the status badge answers what coord
 * will actually do with it. Collapsing the two would lose the first.
 *
 * The green fill is gone — R3 §4.1 reserves the colour families for attention,
 * and "which of three settings is this" is not a severity. It reads as an
 * outline chip in the same weight as the others.
 */
function autonomyChip(level: AutonomyLevel) {
  const testId =
    level === "auto_decide"
      ? "autonomy-auto-decide"
      : level === "guidance_only"
        ? "autonomy-guidance-only"
        : level === "always_escalate"
          ? "autonomy-always-escalate"
          : undefined;
  return (
    <Badge variant="outline" className="font-mono text-[11px]" data-testid={testId}>
      {level}
    </Badge>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CoordPoliciesPage() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTenant, setOpenTenant] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const body = await httpClient.get<FleetResponse>(
        `${API}/coord/next-step-settings/fleet`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const tenants = useMemo(() => data?.tenants ?? [], [data]);

  // R1 — the health verdict, derived from the response already on the page.
  // The question it answers is the one the master-flag card asked in 72px of
  // chrome: will coord dispatch a next step for anybody right now?
  const health = useMemo((): {
    level: HealthStripLevel;
    headline: string;
    detail: string;
    badges: HealthBadge[];
  } | null => {
    if (!data) return null;
    const optedIn = tenants.filter(
      (t) =>
        t.autonomy_level === "auto_decide" ||
        t.autonomy_level === "guidance_only"
    );
    const inert = optedIn.filter((t) => !t.effective).length;
    // The flag is a deliberate operator control, so its OFF position is amber
    // ("nothing is dispatching") and never red: nothing is broken and nobody
    // must act. Amber here is honest for the reason R3 allows — the state is
    // known and self-clearing the moment the flag is turned back on.
    const level: HealthStripLevel = data.master_enabled ? "green" : "amber";
    return {
      level,
      headline: data.master_enabled
        ? "Platform autonomous dispatch is ENABLED"
        : "Platform autonomous dispatch is DISABLED",
      detail: data.master_enabled
        ? "coord dispatches next steps for tenants that opted in."
        : "No tenant opt-in takes effect while the master flag is off.",
      badges: [
        { key: "tenants", label: `tenants ${tenants.length}` },
        { key: "opted-in", label: `opted in ${optedIn.length}` },
        {
          key: "inert",
          label: `not in effect ${inert}`,
          tone: "muted",
          title:
            "Tenants that opted in while the master flag is off. Nothing is broken — coord simply will not dispatch for them.",
        },
      ],
    };
  }, [data, tenants]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-policies-page">
      {/* R9 — the console shell owns the title bar, so the page keeps one
          chrome line: the refresh control and nothing else. The `<h2>` +
          blurb it replaces cost ~56px above the fold on every visit. */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          data-testid="coord-policies-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="coord-policies-error">
          Failed to load: {error}
        </p>
      )}

      {/* R1 — health strip first. Replaces the master-flag Card; the testids
          that named the two flag states ride the strip's badge. */}
      {loading && !data ? (
        <Skeleton className="h-11 w-full" />
      ) : health ? (
        <div data-testid="coord-policies-master-flag">
          <HealthStrip
            level={health.level}
            headline={
              <span
                data-testid={
                  data?.master_enabled
                    ? "master-flag-enabled"
                    : "master-flag-disabled"
                }
              >
                {health.headline}
              </span>
            }
            detail={
              <>
                {health.detail} Controlled by the{" "}
                <code className="rounded bg-muted px-1 font-mono">
                  COORD_NEXT_STEP_AUTODISPATCH_ENABLED
                </code>{" "}
                env flag — not editable here.
              </>
            }
            badges={health.badges}
          />
        </div>
      ) : null}

      {/* Design policies — user-editable, tool-agnostic source of truth */}
      <DesignPoliciesSection />

      {/* Fleet table — R9: no Card wrapper. The count the CardTitle carried is
          on the health strip's badge cluster above. */}
      <div data-testid="coord-policies-fleet-table">
        {loading && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : tenants.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>coord will</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => (
                  <TenantRow
                    key={t.tenant_id}
                    tenant={t}
                    expanded={openTenant === t.tenant_id}
                    // R5 — one open at a time, the same model `<RecordList>`
                    // holds for a row list, spelled out here because a
                    // `<TableBody>` cannot host that primitive.
                    onToggle={() =>
                      setOpenTenant(
                        openTenant === t.tenant_id ? null : t.tenant_id
                      )
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-policies-empty"
          >
            No tenants have opted into autonomous next-step.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One tenant, plus the D2 detail beneath it.
 *
 * The raw `tenant_id` moves off the row and into `raw` — R8's rule that raw
 * ids appear in the expanded detail and nowhere else, and the reason this row
 * is one line where it used to be two.
 */
function TenantRow({
  tenant,
  expanded,
  onToggle,
}: {
  tenant: TenantPolicySetting;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = derivePolicyAutonomyStatus(tenant);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <Fragment>
      <TableRow
        data-testid={`policy-row-${tenant.slug}`}
        data-expanded={expanded ? "true" : "false"}
        onClick={onToggle}
        className={`cursor-pointer ${rowAccentClass(status)}`}
      >
        <TableCell>
          <span className="inline-flex items-center gap-1.5">
            <Chevron
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="font-medium">{tenant.slug}</span>
          </span>
        </TableCell>
        <TableCell>{autonomyChip(tenant.autonomy_level)}</TableCell>
        <TableCell>
          <StatusBadge status={status} palette={POLICY_STATUS_PALETTE} />
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(tenant.updated_at).toLocaleString()}
        </TableCell>
      </TableRow>
      {expanded && (
        // D2 — a full-width cell spanning every column, so it hosts everything
        // a fixed-width sheet could and keeps its width as columns grow.
        <TableRow
          data-testid={`policy-row-detail-${tenant.slug}`}
          className="hover:bg-transparent"
        >
          <TableCell colSpan={4} className="p-0">
            <RecordDetail
              className="rounded-none border-x-0 border-b-0"
              why={
                <p className="text-xs text-muted-foreground">
                  {/* §4.2 clause 4 — a calm kind that is nonetheless owed
                      something says so HERE, in words, never by borrowing
                      amber. */}
                  {status.reason ??
                    `coord treats this tenant as \`${tenant.autonomy_level}\` and the setting is in effect.`}
                </p>
              }
              raw={
                <div className="break-all font-mono text-[10px] text-muted-foreground/60">
                  tenant_id: {tenant.tenant_id} · autonomy_level:{" "}
                  {tenant.autonomy_level} · effective:{" "}
                  {String(tenant.effective)}
                </div>
              }
            />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
