"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { RecordDetail } from "@/components/console";
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
 *
 * ## Console style (Phase 3 Wave 5) — D2, exactly as written
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` keeps the
 * table (a three-column comparison is a legitimate dense form; rewriting it
 * into a row list would fight the job the page exists for) and adds what it
 * lacked: **a clickable row that expands a full-width `<tr><td colspan={3}>`
 * carrying the same `<RecordDetail>` the row lists use.** Not a slide-over —
 * clicking a record must do the same thing on every page of the console.
 *
 * What moved into that detail: the per-class description and the near-miss
 * warning, both of which were stacked inside the first cell and made every
 * row three lines tall whether or not you cared. The near-miss keeps its
 * `gate-clearance-near-miss` testid (D4a) and — because it is a warning about
 * a class that will silently never match — is ALSO summarised on the collapsed
 * row by a glyph, so folding it away cannot hide it (R7's rule, applied to a
 * table cell).
 */
export function EffectiveAuthorityMatrix({
  rules,
}: {
  rules: readonly CoordPolicyRow[];
}) {
  const classes = classesInPlay(rules);
  const [openClass, setOpenClass] = useState<string | null>(null);
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
            <ClassRow
              key={cls}
              gateClass={cls}
              rules={rules}
              expanded={openClass === cls}
              // One open at a time (R5) — the same model `<RecordList>` holds
              // for a row list, spelled out here because a `<TableBody>`
              // cannot host that primitive.
              onToggle={() => setOpenClass(openClass === cls ? null : cls)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ClassRow({
  gateClass,
  rules,
  expanded,
  onToggle,
}: {
  gateClass: string;
  rules: readonly CoordPolicyRow[];
  expanded: boolean;
  onToggle: () => void;
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

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <Fragment>
      <TableRow
        data-testid={`gate-clearance-matrix-row-${gateClass}`}
        data-expanded={expanded ? "true" : "false"}
        onClick={onToggle}
        className="cursor-pointer"
      >
        <TableCell className="align-top">
          <span className="inline-flex items-center gap-1.5">
            <Chevron
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <code className="font-mono text-xs">{gateClass}</code>
          </span>
          {!recommended && (
            <Badge variant="outline" className="ml-2 align-middle">
              custom
            </Badge>
          )}
          {/* R7 — the detail folds, its SIGNAL does not. A near miss means
              this class will silently never match the one it looks like, so
              the warning is summarised here and spelled out in the expansion.
              `gate-clearance-near-miss` stays on the full sentence (D4a). */}
          {nearMiss && !expanded && (
            <AlertTriangle
              className="ml-2 inline size-3 align-middle text-warning"
              aria-label={`Not the same class as ${nearMiss}`}
            />
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

      {expanded && (
        // D2 — the detail is a full-width cell beneath the row it belongs to,
        // spanning every column so it hosts everything a fixed-width sheet
        // could and keeps its width as columns grow.
        <TableRow
          data-testid={`gate-clearance-matrix-detail-${gateClass}`}
          className="hover:bg-transparent"
        >
          <TableCell colSpan={3} className="p-0">
            <RecordDetail
              className="rounded-none border-x-0 border-b-0"
              why={
                GATE_CLASS_DESCRIPTIONS[gateClass] ? (
                  <p className="text-xs text-muted-foreground">
                    {GATE_CLASS_DESCRIPTIONS[gateClass]}
                  </p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    No description shipped for this class — it is one this
                    workspace invented, which is legitimate.
                  </p>
                )
              }
              problems={
                nearMiss ? (
                  <p
                    className="flex items-start gap-1 text-[11px] text-warning"
                    data-testid="gate-clearance-near-miss"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-3 shrink-0"
                      aria-hidden
                    />
                    <span>
                      Not the same class as{" "}
                      <code className="font-mono">{nearMiss}</code>. Coord
                      compares the class string exactly — case, spacing and
                      hyphens all count — so these are two separate buckets.
                    </span>
                  </p>
                ) : undefined
              }
              history={
                inertForClass.length > 0 ? (
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {inertForClass.map((r) => (
                      <li key={r.policy_id}>
                        <span className="font-medium">{r.name}</span> names this
                        class but cannot match.
                      </li>
                    ))}
                  </ul>
                ) : undefined
              }
              raw={
                <div className="break-all font-mono text-[10px] text-muted-foreground/60">
                  gate_class: {gateClass}
                  {recommended ? " · shipped class" : " · workspace-defined"}
                </div>
              }
            />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
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
