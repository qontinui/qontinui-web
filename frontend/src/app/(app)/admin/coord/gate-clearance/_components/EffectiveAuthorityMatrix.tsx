"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  authorityForAudience,
  AUTHORITY_LABELS,
  classesInPlay,
  GATE_CLASS_DESCRIPTIONS,
  nearMissRecommendedClass,
  RECOMMENDED_GATE_CLASSES,
  rawGateClass,
  resolveEffectiveAuthority,
  isGateClearanceRow,
  type EffectiveAuthority,
} from "../gateClearance";

/**
 * The EFFECTIVE clearance authority per gate class — the resolution, not just
 * the rows this workspace happens to own.
 *
 * Computed with the same precedence coord's resolver uses (tenant band beats
 * system band regardless of priority; then `priority ASC, created_at ASC`), so
 * a user can see WHICH BAND decided rather than inferring it. Where no rule
 * matches, both arms of coord's audience-dependent default are shown — the
 * console never picks one, because the answer genuinely depends on the gate.
 */
export function EffectiveAuthorityMatrix({
  rules,
}: {
  rules: readonly CoordPolicyRow[];
}) {
  const classes = classesInPlay(rules);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table data-testid="gate-clearance-matrix">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[16rem]">Gate class</TableHead>
            <TableHead>Effective authority</TableHead>
            <TableHead className="w-[14rem]">Decided by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {classes.map((cls) => (
            <ClassRow key={cls} gateClass={cls} rules={rules} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ClassRow({
  gateClass,
  rules,
}: {
  gateClass: string;
  rules: readonly CoordPolicyRow[];
}) {
  const effective = resolveEffectiveAuthority(rules, gateClass);
  const recommended = (RECOMMENDED_GATE_CLASSES as readonly string[]).includes(
    gateClass
  );
  const nearMiss = nearMissRecommendedClass(gateClass);
  // Rows that name this class but can never match (disabled / repo-scoped /
  // unparseable) — invisible in the resolution, so they must be visible here.
  const inertForClass = rules.filter(
    (r) =>
      isGateClearanceRow(r) &&
      rawGateClass(r.payload) === gateClass &&
      !mentionsInResolution(effective, r.policy_id)
  );

  return (
    <TableRow data-testid={`gate-clearance-matrix-row-${gateClass}`}>
      <TableCell className="align-top">
        <code className="font-mono text-xs">{gateClass}</code>
        {!recommended && (
          <Badge variant="outline" className="ml-2 align-middle">
            custom
          </Badge>
        )}
        {GATE_CLASS_DESCRIPTIONS[gateClass] && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {GATE_CLASS_DESCRIPTIONS[gateClass]}
          </p>
        )}
        {nearMiss && (
          <p
            className="mt-1 flex items-start gap-1 text-[11px] text-warning"
            data-testid="gate-clearance-near-miss"
          >
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              Not the same class as{" "}
              <code className="font-mono">{nearMiss}</code>. Coord compares the
              class string exactly — case, spacing and hyphens all count — so
              these are two separate buckets.
            </span>
          </p>
        )}
      </TableCell>

      <TableCell className="align-top">
        <EffectiveAuthorityCell effective={effective} />
      </TableCell>

      <TableCell className="align-top text-xs">
        <DecidedByCell effective={effective} />
        {inertForClass.length > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {inertForClass.length} rule
            {inertForClass.length === 1 ? "" : "s"} name this class but cannot
            match — see the list below.
          </p>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Is `policyId` the deciding rule, or one of the shadowed candidates? */
function mentionsInResolution(
  effective: EffectiveAuthority,
  policyId: string
): boolean {
  if (effective.kind !== "rule") return false;
  if (effective.rule.policy_id === policyId) return true;
  return effective.shadowed.some((c) => c.row.policy_id === policyId);
}

export function EffectiveAuthorityCell({
  effective,
}: {
  effective: EffectiveAuthority;
}) {
  if (effective.kind === "rule") {
    return (
      <span
        className="text-sm font-medium"
        data-testid="gate-clearance-effective"
      >
        {AUTHORITY_LABELS[effective.authority]}
      </span>
    );
  }
  // No rule matched. Coord's default is audience-dependent, so there is no
  // single answer — show both, and read each through the same
  // `authorityForAudience` the tests pin, so the display cannot drift from the
  // resolution it claims to show.
  return (
    <div className="text-sm" data-testid="gate-clearance-effective">
      <div className="font-medium">Depends on the gate&apos;s audience</div>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <li>
          operator-audience gates →{" "}
          <span className="font-medium text-foreground">
            {AUTHORITY_LABELS[authorityForAudience(effective, "operator")]}
          </span>
        </li>
        <li>
          agent-audience gates →{" "}
          <span className="font-medium text-foreground">
            {AUTHORITY_LABELS[authorityForAudience(effective, "agent")]}
          </span>
        </li>
      </ul>
    </div>
  );
}

export function DecidedByCell({
  effective,
}: {
  effective: EffectiveAuthority;
}) {
  if (effective.kind !== "rule") {
    return (
      <span
        className="text-muted-foreground"
        data-testid="gate-clearance-decided-by"
      >
        No rule — coord&apos;s built-in audience default
      </span>
    );
  }
  return (
    <div data-testid="gate-clearance-decided-by">
      <Badge variant={effective.band === "tenant" ? "info" : "secondary"}>
        {effective.band === "tenant" ? "This workspace" : "System default"}
      </Badge>
      <div className="mt-1 truncate" title={effective.rule.policy_id}>
        {effective.rule.name}{" "}
        <code className="font-mono text-[11px] text-muted-foreground">
          {effective.rule.policy_id.slice(0, 8)}
        </code>
      </div>
      {effective.shadowed.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Outranks {effective.shadowed.length} lower-precedence rule
          {effective.shadowed.length === 1 ? "" : "s"} for this class.
        </p>
      )}
    </div>
  );
}
