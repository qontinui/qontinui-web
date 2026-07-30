"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  History,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  APPLICABILITY_META,
  CLAUSE_RESOLVED_VIA_LABEL,
  DEFAULT_ENFORCED_CLAUSE_REF,
  MODE_META,
  SESSION_COMPLIANCE_MODES,
  type SessionComplianceConfig,
  type SessionComplianceConfigUpdate,
  type SessionComplianceConfigVersion,
  type SessionComplianceMode,
} from "../compliance-types";
import { ComplianceStateNotice } from "./ComplianceStateNotice";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface EnforcementPanelProps {
  config: SessionComplianceConfig | null;
  loading: boolean;
  saving: boolean;
  versions: SessionComplianceConfigVersion[] | null;
  versionsLoading: boolean;
  /** Coord doesn't serve the config-versions route (404/405). */
  versionsUnavailable: boolean;
  /** Coord answered but its compliance store isn't provisioned. */
  versionsDegraded: string | null;
  /** Coord unreachable or refusing the config-versions read. */
  versionsError: string | null;
  onSave: (patch: SessionComplianceConfigUpdate) => Promise<boolean>;
}

/**
 * The enforcement switch, and the plain statement of what is being enforced.
 *
 * Two things this panel is required to do beyond holding form controls:
 *
 * 1. **Say what the mechanism is**, to someone who has read no plan. A hook
 *    checks that closing sessions emit the POLICY_COMPLIANCE report their
 *    policy requires; coord then reconciles what that report claims against
 *    what coord independently observed; and this is the switch. A control whose
 *    effect is undocumented is not really the operator's to own.
 * 2. **Show applicability as DERIVED.** Whether the check is in force is not a
 *    setting — coord computes it from whether the named clause is actually
 *    present in the active version of the document it names. So it is rendered
 *    as a read-only verdict with its reason, never as another toggle, and
 *    `clause_resolved_via` is shown alongside a `clause_absent` verdict so a
 *    genuinely-absent clause can be told apart from a lookup that simply
 *    didn't resolve — the latter would silently disable the whole mechanism.
 */
export function SessionComplianceEnforcementPanel({
  config,
  loading,
  saving,
  versions,
  versionsLoading,
  versionsUnavailable,
  versionsDegraded,
  versionsError,
  onSave,
}: EnforcementPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<SessionComplianceMode>("nudge");
  const [clauseRef, setClauseRef] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [changeNote, setChangeNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  /**
   * The config the form was last seeded from. Used to tell "the operator hasn't
   * touched anything" from "the operator is mid-edit" without lifting the
   * whole form into a reducer.
   */
  const seededFrom = useRef<SessionComplianceConfig | null>(null);

  // Re-seed the form from coord's view — but NOT over unsaved edits. A refetch
  // (the Refresh button, or a poll) that silently replaced a half-typed clause
  // ref with the stored one would destroy work the operator can't get back and
  // never told them it happened.
  useEffect(() => {
    if (!config) return;
    const prev = seededFrom.current;
    const matches = (c: SessionComplianceConfig) =>
      enabled === c.enabled &&
      mode === c.mode &&
      clauseRef === (c.enforced_clause_ref ?? "") &&
      maxAttempts === String(c.max_attempts ?? 1) &&
      changeNote === "";
    // Untouched relative to what it was seeded from — or already equal to the
    // incoming config (the post-save case), where re-seeding is a no-op but
    // must still refresh the baseline or it would go stale forever.
    const untouched = prev === null || matches(prev) || matches(config);
    if (!untouched) return;
    seededFrom.current = config;
    setEnabled(config.enabled);
    setMode(config.mode);
    setClauseRef(config.enforced_clause_ref ?? "");
    setMaxAttempts(String(config.max_attempts ?? 1));
    setChangeNote("");
    // Intentionally keyed on `config` only: the form fields are read to decide
    // whether re-seeding is safe, but a keystroke must not itself re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (loading && !config) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Loading enforcement settings…
      </div>
    );
  }
  if (!config) return null;

  const attemptsNumber = Number.parseInt(maxAttempts, 10);
  const attemptsValid = Number.isFinite(attemptsNumber) && attemptsNumber >= 1;
  const dirty =
    enabled !== config.enabled ||
    mode !== config.mode ||
    clauseRef !== (config.enforced_clause_ref ?? "") ||
    (attemptsValid && attemptsNumber !== config.max_attempts);

  const applicability = APPLICABILITY_META[config.applicability_reason] ?? {
    label: config.applicability_reason,
    detail: "Coord returned a reason this page doesn't have wording for yet.",
  };

  const resolvedViaKey =
    config.clause_resolved_via === "registry" ||
    config.clause_resolved_via === "body_heading"
      ? config.clause_resolved_via
      : "unresolved";

  const save = async () => {
    const ok = await onSave({
      enabled,
      mode,
      enforced_clause_ref: clauseRef.trim() === "" ? null : clauseRef.trim(),
      max_attempts: attemptsValid ? attemptsNumber : config.max_attempts,
      ...(changeNote.trim() ? { change_note: changeNote.trim() } : {}),
    });
    if (ok) setChangeNote("");
  };

  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      data-testid="compliance-enforcement-panel"
    >
      {/* ---- What this is ---------------------------------------------- */}
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-semibold">
            Session compliance check
          </h3>
          <p className="text-sm text-muted-foreground">
            At the end of every turn, your runner checks the session for the{" "}
            <strong>POLICY_COMPLIANCE report</strong> your session policy
            requires — the closing list of every piece of work the session took
            on, marked landed, in&nbsp;train, gated, deferred or surfaced. If the
            report is missing, the session is asked to produce it.
          </p>
          <p className="text-sm text-muted-foreground">
            Coord then <strong>reconciles what the report claims</strong> against
            what it independently observed — which pull requests actually landed,
            which gates are actually open — and records a verdict per session
            below. That reconciliation is the point: a report that merely says
            the right words is not evidence, and this is what makes the claims
            checkable rather than believed.
          </p>
          <p className="text-sm text-muted-foreground">
            The three parts sit in different places, which is why the switch is
            here: <strong>the runner runs the check</strong> (a turn-end hook
            shipped inside the runner binary and installed by it — you don&apos;t
            wire anything up), <strong>coord reconciles and stores</strong> the
            verdicts, and <strong>this page controls it</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            Two things it deliberately does <em>not</em> claim: it cannot prove a
            session read your policy, only that a report exists and holds up; and
            deferred or surfaced items are checked for shape only, because
            nothing observable can confirm them.
          </p>
        </div>
      </div>

      {/*
        Coverage bound. Stated flatly, and deliberately NOT derived from any
        runner-side tracking metric: the runner counts over its own process
        subtree, so a session started in a foreign terminal is structurally
        invisible to it — not counted, not flagged. A number sourced from that
        would read as coverage while being confidently wrong, so the honest
        surface is this static statement of scope.
      */}
      <div
        className="rounded-lg border border-border bg-muted/40 px-3 py-2.5"
        data-testid="compliance-coverage-bound"
      >
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">What this covers.</strong>{" "}
          Compliance is checked for sessions started from this runner. Sessions
          started by hand in an external terminal, on another machine, or under a
          different runner instance are not covered — and, because the runner can
          only see its own sessions, they do not appear below as uncovered
          either. Switching this on does not make them checked.
        </p>
      </div>

      {/* ---- Derived applicability ------------------------------------- */}
      <div
        className={cn(
          "rounded-lg border px-3 py-3",
          config.applicable
            ? "border-success/40 bg-success/5"
            : "border-border bg-muted/40"
        )}
        data-testid="compliance-applicability"
      >
        <div className="flex items-center gap-2">
          {config.applicable ? (
            <CircleCheck className="size-4 shrink-0 text-success" />
          ) : (
            <CircleSlash className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            Currently applicable: {config.applicable ? "yes" : "no"}
          </span>
          <Badge variant={config.applicable ? "success" : "secondary"}>
            {applicability.label}
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {applicability.detail}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          This is worked out by coord, not set here: it checks whether the clause
          named below is present in the active version of its prompt document
          {config.prompt_document_version != null
            ? ` (version ${config.prompt_document_version})`
            : ""}
          . Edit that clause out and the check goes inert on its own — there is
          no separate switch to forget.
        </p>
        {config.clause_resolved_via !== undefined && (
          <p
            className="mt-1 text-xs text-muted-foreground"
            data-testid="clause-resolved-via"
          >
            Clause lookup: {CLAUSE_RESOLVED_VIA_LABEL[resolvedViaKey]}.
            {resolvedViaKey === "unresolved" &&
              config.applicability_reason === "clause_absent" &&
              " If you expect this clause to exist, check the reference below before assuming the clause was removed — an unresolved lookup switches the whole check off just as quietly as a deleted clause."}
          </p>
        )}
      </div>

      {/* ---- Controls --------------------------------------------------- */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <Label htmlFor="compliance-enabled" className="text-sm">
              Check this runner&apos;s sessions for their compliance report
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Off means those sessions run unchecked and no verdicts are
              recorded. Nothing else changes.
            </p>
          </div>
          <Switch
            id="compliance-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            data-testid="compliance-enabled"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="compliance-mode">
              What happens when the report is missing
            </Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as SessionComplianceMode)}
            >
              <SelectTrigger id="compliance-mode" data-testid="compliance-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SESSION_COMPLIANCE_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODE_META[m].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {MODE_META[mode].description}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="compliance-max-attempts">
              Most corrections per session
            </Label>
            <Input
              id="compliance-max-attempts"
              type="number"
              min={1}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
              data-testid="compliance-max-attempts"
            />
            <p
              className={cn(
                "text-xs",
                attemptsValid ? "text-muted-foreground" : "text-destructive"
              )}
            >
              {attemptsValid
                ? "A session is asked at most this many times, then left alone — a correction loop spends your tokens."
                : "Must be a whole number of at least 1."}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="compliance-clause-ref">Clause being enforced</Label>
          <Input
            id="compliance-clause-ref"
            value={clauseRef}
            onChange={(e) => setClauseRef(e.target.value)}
            placeholder={DEFAULT_ENFORCED_CLAUSE_REF}
            spellCheck={false}
            className="font-mono text-xs"
            data-testid="compliance-clause-ref"
          />
          <p className="text-xs text-muted-foreground">
            A <code>document#clause-id</code> reference, e.g.{" "}
            <code>{DEFAULT_ENFORCED_CLAUSE_REF}</code>. This is the rule the
            check exists to hold sessions to, and it is also what decides whether
            the check applies at all.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="compliance-change-note">
            Note for the change history (optional)
          </Label>
          <Input
            id="compliance-change-note"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="Why you're changing this"
            data-testid="compliance-change-note"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Settings version {config.current_version}
            {config.updated_by ? ` · last changed by ${config.updated_by}` : ""}
            {config.updated_at ? ` · ${formatWhen(config.updated_at)}` : ""}
          </p>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || !dirty || !attemptsValid}
            data-testid="compliance-save"
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save settings
          </Button>
        </div>
      </div>

      {/* ---- Config version history ------------------------------------ */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="compliance-config-history-toggle"
        >
          {historyOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <History className="size-4" />
          Change history
          {versions ? ` (${versions.length})` : ""}
        </button>
        {historyOpen && (
          <div className="mt-2 space-y-2" data-testid="compliance-config-history">
            {/* Read failures get their own sentence. "No recorded changes yet"
                is a positive claim about this tenant's settings, and must never
                be rendered off a route we could not read — a single-route 404
                during coord's staged rollout would otherwise assert that the
                settings have never been touched. */}
            <ComplianceStateNotice
              unavailable={versionsUnavailable}
              degraded={versionsDegraded}
              error={versionsError}
              what="setting changes"
            />
            {versionsLoading && !versions ? (
              <p className="py-3 text-sm text-muted-foreground">
                Loading change history…
              </p>
            ) : !versions ? null : versions.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                No recorded changes yet — these are still the defaults.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {versions.map((v) => (
                  <li
                    key={v.version_number}
                    className="rounded-md border border-border px-2.5 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">v{v.version_number}</span>
                      <Badge variant={v.enabled ? "success" : "secondary"}>
                        {v.enabled ? "on" : "off"}
                      </Badge>
                      <span className="text-muted-foreground">{v.mode}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {v.enforced_clause_ref ?? "no clause"}
                      </code>
                      <span className="text-muted-foreground">
                        max {v.max_attempts}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {v.edited_by ?? "unknown editor"} ·{" "}
                      {formatWhen(v.created_at)}
                      {v.change_note ? ` · ${v.change_note}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
