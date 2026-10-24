"use client";

/**
 * Repository tenant bindings — the onboarding page's view and controls for
 * per-repo tenant bindings.
 *
 * A binding makes one repository governed by a tenant other than its GitHub
 * org's tenant (plan
 * `2026-10-17-per-repo-tenant-binding-overrides-the-org-tenant`, Phase 7,
 * D8). The connected-orgs read lists a tenant's repos only under that tenant's
 * own org logins, so a repo bound to a tenant that owns no org would otherwise
 * be invisible on its own tenant's page. This card reads coord's ONE list door
 * (`GET /api/v1/operations/pr-merge/onboarding/repo-bindings` → coord
 * `GET /coord/onboarding/repo-bindings`), which returns every binding where
 * the active tenant is either party, and renders both sides of it:
 *
 * - **Bound to this tenant** (`caller_side: "bound"`) — repo, the org's tenant
 *   it came from, who bound it, when and why, and an Unbind (release).
 * - **Bound away from this tenant** (`caller_side: "org"`) — this tenant owns
 *   the repo's org and the repo is governed elsewhere; Unbind here reclaims it
 *   (D4 rule 2: the org's tenant controls the App installation, so reclaim
 *   grants no new power).
 *
 * A "Bind a repository" form binds `owner/name` to a tenant chosen from the
 * operator's admin tenants. Coord re-checks admin in BOTH tenants (D4 O4); the
 * tenant list here is a convenience, not the authorization.
 *
 * Who sees what: all three routes are gated web-side by
 * `require_coord_tenant_admin_target` — admin IN THE ACTIVE TENANT. The card
 * asks that same question ({@link isActiveTenantCoordAdmin}), never the
 * any-tenant union `CoordAdminOnly` reads (`lib/coord-admin.ts` names the
 * trap): a viewer who is not admin of the active tenant gets an
 * "Administrator only" notice, no list read (it could only 403) and no forms
 * (every submit would be refused).
 *
 * Status honesty (served policy `ux-priorities`
 * `a-status-signal-must-observe-the-state-it-names`): a failed list read
 * renders UNKNOWN with coord's code and message, never an empty list; an empty
 * MEASURED list says so with the time coord measured it. Every action
 * acknowledges itself (disabled + spinner) and ends in a terminal state that
 * names coord's error code on failure (`an-action-must-acknowledge-itself`).
 * A write answered 2xx is a success whatever its body says. A failed write is
 * followed by a re-read, because a write that timed out may still have landed
 * (the web's `coord_write_timeout` refusal says so, and is rendered with its
 * next action).
 *
 * Rows compose the console primitives (`RecordList` / `RecordRow` /
 * `RecordDetail`, style guide R2/R5): one line per binding, detail and the
 * Unbind form expand in place.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadOnlyNotice } from "@/components/admin/coord/CoordAdminOnly";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  BackendErrorMessage,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  UNKNOWN_AMBER,
  absoluteTime,
} from "@/components/console";
import { useAuth } from "@/contexts/auth-context";
import { useTenant, type Tenant } from "@/contexts/tenant-context";
import {
  operationsErrorMessage,
  operationsErrorReading,
} from "@/lib/api/operations/base";
import {
  bindRepoTenant,
  fetchRepoTenantBindings,
  unbindRepoTenant,
  type RepoBindingResult,
  type RepoBindingsResponse,
  type RepoTenantBinding,
} from "@/lib/api/operations/prMergeOnboarding";
import { isActiveTenantCoordAdmin } from "@/lib/coord-admin";
import type { BackendErrorReading } from "@/lib/errors/backend-error-message";

/**
 * `owner/name` — one slash, both halves non-empty, GitHub's own character set.
 * The same shape the web backend's restore proxy accepts; coord normalizes
 * case and answers `400 invalid_repo` for anything it still refuses.
 */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Input caps — the SAME bounds `RepoBindRequest` / `RepoUnbindRequest` put on
 * the web backend's body (`operations/__init__.py`), so a value the browser
 * lets through is never a 422 there. `repo` is GitHub's 39-char login + `/` +
 * its 100-char name.
 */
const REPO_MAX = 140;
const REASON_MAX = 2000;
const DECISION_REF_MAX = 1000;

/** A coord refusal as this card renders it: status, typed code, sentence. */
export interface CoordRefusal {
  status: number | null;
  code: string | null;
  message: string;
}

/**
 * Read a rejected client call back into coord's typed error. Coord's body is
 * `{"error": "<code>", "message": "<text>", ...}` and the proxy passes it
 * through verbatim; anything else (a transport failure, the web gate's own
 * refusal) keeps the shared operations sentence and whatever code it has.
 */
export function coordRefusalOf(err: unknown): CoordRefusal {
  const status = httpStatusOf(err);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(httpBodyOf(err) ?? "");
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — fall through to the shared sentence
  }
  const code =
    typeof body.error === "string"
      ? body.error
      : typeof body.detail === "string"
        ? body.detail
        : null;
  const message =
    typeof body.message === "string" && body.message.trim() !== ""
      ? body.message
      : operationsErrorMessage(err);
  return { status, code, message };
}

/** "403 not_admin_in_both_tenants — <message>", omitting what is absent. */
export function refusalText(r: CoordRefusal): string {
  const head = [r.status !== null ? String(r.status) : null, r.code]
    .filter(Boolean)
    .join(" ");
  return head ? `${head} — ${r.message}` : r.message;
}

/**
 * A failed read or write as this card renders it. `envelope` is set when the
 * rejected body carried the web's refusal envelope (`body.refusal`) — the
 * write timeout's `coord_write_timeout` above all, whose next action says to
 * check whether the change landed before retrying. That reading is rendered by
 * `BackendErrorMessage` with its next action; anything else is coord's typed
 * `{error, message}` and renders as {@link refusalText}.
 */
export interface CardFailure {
  refusal: CoordRefusal;
  envelope: BackendErrorReading | null;
}

export function failureOf(err: unknown): CardFailure {
  const reading = operationsErrorReading(err);
  return {
    refusal: coordRefusalOf(err),
    envelope: reading.kind === "refusal" ? reading : null,
  };
}

/** One failure's text: the envelope with its next action, else coord's code. */
function FailureText({ failure }: { failure: CardFailure }) {
  if (failure.envelope !== null) {
    return (
      <>
        {failure.refusal.status !== null && `${failure.refusal.status} — `}
        <BackendErrorMessage error={failure.envelope} />
      </>
    );
  }
  return <>{refusalText(failure.refusal)}</>;
}

export interface BindFormValues {
  repo: string;
  targetTenant: string;
  reason: string;
}

/** Field-level validation errors for the bind form; empty object = valid. */
export function validateBindForm(
  v: BindFormValues
): Partial<Record<keyof BindFormValues, string>> {
  const errors: Partial<Record<keyof BindFormValues, string>> = {};
  const repo = v.repo.trim();
  if (repo === "") errors.repo = "Enter a repository as owner/name.";
  else if (!REPO_RE.test(repo))
    errors.repo = "Repository must be owner/name (one slash, no spaces).";
  if (v.targetTenant === "")
    errors.targetTenant = "Choose the tenant to bind to.";
  if (v.reason.trim() === "") errors.reason = "A reason is required.";
  return errors;
}

/**
 * The tenants a bind may target: the operator's tenants whose per-tenant
 * roles include `admin`. A tenant whose `roles` are absent (a web backend
 * that predates per-tenant roles) is offered but labelled — its admin role is
 * UNKNOWN here, and coord decides.
 */
export function bindTargetOptions(
  tenants: readonly Tenant[]
): { id: string; label: string }[] {
  return tenants
    .filter((t) => !Array.isArray(t.roles) || t.roles.includes("admin"))
    .map((t) => ({
      id: t.id,
      label: Array.isArray(t.roles)
        ? `${t.name} (${t.slug})`
        : `${t.name} (${t.slug}) — admin role unknown`,
    }));
}

function countText(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "?";
}

/**
 * One-line summary of a successful bind or unbind, from coord's answer.
 *
 * The write's 2xx is the success; the body only describes it. So every field
 * is read defensively — a body that is `null` (did not parse), or that lacks
 * `moved` / `audit_ids` / `notified`, still summarises as a success and says
 * which details were not reported, rather than throwing and rendering a
 * landed write as failed. `repo` is the repo the operator asked for, used when
 * coord's answer does not name one.
 */
export function resultSummary(
  verb: "Bound" | "Unbound",
  r: RepoBindingResult | null,
  repo: string
): string {
  const res: Partial<RepoBindingResult> | null =
    r && typeof r === "object" ? r : null;
  const name =
    typeof res?.repo === "string" && res.repo.trim() !== "" ? res.repo : repo;
  if (res === null) {
    return `${verb} ${name} — coord confirmed the change but sent no readable details.`;
  }
  if (res.idempotent === true) {
    return `${name}: already in that state — nothing changed.`;
  }
  const m: Partial<RepoBindingResult["moved"]> =
    res.moved && typeof res.moved === "object" ? res.moved : {};
  const moved = `moved tenant_repos ${countText(m.tenant_repos)}, profile ${countText(m.profile)}, canonical ${countText(m.canonical)}`;
  const audit = Array.isArray(res.audit_ids)
    ? `${res.audit_ids.length} audit ${res.audit_ids.length === 1 ? "row" : "rows"}`
    : "audit rows not reported";
  const notified =
    res.notified === true
      ? "operator notified"
      : res.notified === false
        ? "operator NOT notified"
        : "notification not reported";
  return `${verb} ${name} — ${moved}; ${audit}; ${notified}.`;
}

type ListRead =
  | { state: "loading" }
  | { state: "loaded"; data: RepoBindingsResponse }
  | { state: "unknown"; failure: CardFailure };

type ActionOutcome =
  | { kind: "ok"; text: string }
  | { kind: "error"; failure: CardFailure };

/** An unbind's in-flight state, kept per repo at CARD level (see UnbindForm). */
export interface UnbindState {
  busy: boolean;
  error: CardFailure | null;
}

const IDLE_UNBIND: UnbindState = { busy: false, error: null };

function slugOrUnknown(slug: string | null | undefined): string {
  return slug && slug.trim() !== "" ? slug : "unknown tenant";
}

/**
 * The Unbind / Reclaim control inside a row's detail.
 *
 * It owns only the reason being typed. `busy` and the failure live at CARD
 * level, keyed by repo, and are passed in: the row collapses whenever another
 * row opens (one open at a time, R5), which unmounts this form, and state kept
 * here would then lose a failure that arrives later and re-enable a second
 * DELETE while the first is still in flight. A success is reported at card
 * level too, because the re-read that follows removes this row.
 */
function UnbindForm({
  binding,
  state,
  onUnbind,
}: {
  binding: RepoTenantBinding;
  state: UnbindState;
  onUnbind: (repo: string, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const { busy, error } = state;
  const reasonMissing = reason.trim() === "";
  const verb = binding.caller_side === "org" ? "Reclaim" : "Unbind";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busy || reasonMissing) return;
    await onUnbind(binding.repo, reason.trim());
  };

  return (
    <form
      className="space-y-2"
      onSubmit={onSubmit}
      noValidate
      data-testid={`repo-binding-unbind-form-${binding.repo}`}
      data-ui-bridge-id="operations.repo-binding-unbind-form"
    >
      <label className="form-label" htmlFor={`unbind-reason-${binding.repo}`}>
        Reason for {verb === "Reclaim" ? "reclaiming" : "unbinding"}{" "}
        <span className="text-muted-foreground">(required)</span>
      </label>
      <input
        id={`unbind-reason-${binding.repo}`}
        className="input"
        value={reason}
        disabled={busy}
        maxLength={REASON_MAX}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why governance returns to the org's tenant"
        data-testid={`repo-binding-unbind-reason-${binding.repo}`}
        data-ui-bridge-id="operations.repo-binding-unbind-reason"
      />
      {touched && reasonMissing && (
        <p
          className="form-error"
          data-testid={`repo-binding-unbind-reason-error-${binding.repo}`}
          data-ui-bridge-id="operations.repo-binding-unbind-reason-error"
        >
          A reason is required.
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={busy}
        aria-busy={busy}
        data-testid={`repo-binding-unbind-${binding.repo}`}
        data-ui-bridge-id="operations.repo-binding-unbind"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
        {busy ? `${verb === "Reclaim" ? "Reclaiming" : "Unbinding"}…` : verb}
      </Button>
      {error && (
        <p
          className="text-xs text-destructive"
          role="alert"
          data-testid={`repo-binding-unbind-error-${binding.repo}`}
          data-ui-bridge-id="operations.repo-binding-unbind-error"
        >
          <FailureText failure={error} />
        </p>
      )}
    </form>
  );
}

function BindingRow({
  binding,
  expanded,
  onToggle,
  unbindState,
  onUnbind,
}: {
  binding: RepoTenantBinding;
  expanded: boolean;
  onToggle: () => void;
  unbindState: UnbindState;
  onUnbind: (repo: string, reason: string) => Promise<void>;
}) {
  const label =
    binding.caller_side === "bound"
      ? `from ${slugOrUnknown(binding.org_tenant_slug)}`
      : `bound to ${slugOrUnknown(binding.tenant_slug)}`;
  return (
    <div
      data-ui-bridge-id="operations.repo-binding-row"
      data-caller-side={binding.caller_side}
      data-unbind-busy={unbindState.busy ? "true" : undefined}
    >
      <RecordRow
        identity={binding.repo}
        label={<span title={label}>{label}</span>}
        reason={binding.reason}
        reasonTestId={`repo-binding-reason-${binding.repo}`}
        time={<RowTime at={binding.created_at} verb="Bound" />}
        expanded={expanded}
        onToggle={onToggle}
        data-testid={`repo-binding-row-${binding.repo}`}
      >
        <RecordDetail
          data-testid={`repo-binding-detail-${binding.repo}`}
          why={
            <dl
              className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs"
              data-ui-bridge-id="operations.repo-binding-detail"
            >
              <dt className="text-muted-foreground">Bound to</dt>
              <dd>{slugOrUnknown(binding.tenant_slug)}</dd>
              <dt className="text-muted-foreground">Org&apos;s tenant</dt>
              <dd>{slugOrUnknown(binding.org_tenant_slug)}</dd>
              <dt className="text-muted-foreground">Bound by</dt>
              <dd className="font-mono">{binding.bound_by}</dd>
              <dt className="text-muted-foreground">When</dt>
              <dd>{absoluteTime(binding.created_at)}</dd>
              <dt className="text-muted-foreground">Why</dt>
              <dd>{binding.reason}</dd>
              {binding.decision_ref && (
                <>
                  <dt className="text-muted-foreground">Decision</dt>
                  <dd className="font-mono break-all">
                    {binding.decision_ref}
                  </dd>
                </>
              )}
            </dl>
          }
          actions={
            <UnbindForm
              binding={binding}
              state={unbindState}
              onUnbind={onUnbind}
            />
          }
        />
      </RecordRow>
    </div>
  );
}

function BindForm({ afterWrite }: { afterWrite: () => Promise<void> }) {
  const { tenants, loading: tenantsLoading, error: tenantsError } = useTenant();
  const options = useMemo(() => bindTargetOptions(tenants), [tenants]);
  const [values, setValues] = useState<BindFormValues>({
    repo: "",
    targetTenant: "",
    reason: "",
  });
  const [decisionRef, setDecisionRef] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  // The re-entry guard reads a ref: two submits inside one render would both
  // see a stale `busy === false` and send two POSTs.
  const busyRef = useRef(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const errors = validateBindForm(values);
  const shown = touched ? errors : {};

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busyRef.current || Object.keys(errors).length > 0) return;
    busyRef.current = true;
    setBusy(true);
    setOutcome(null);
    const repo = values.repo.trim();
    const ref = decisionRef.trim();
    let result: RepoBindingResult | null;
    try {
      result = await bindRepoTenant({
        repo,
        target_tenant: values.targetTenant,
        reason: values.reason.trim(),
        ...(ref ? { decision_ref: ref } : {}),
      });
    } catch (err) {
      // Bind stays disabled until the re-read lands: a timed-out write may
      // already have been applied, and the list is what says so.
      setOutcome({ kind: "error", failure: failureOf(err) });
      await afterWrite();
      busyRef.current = false;
      setBusy(false);
      return;
    }
    // Any 2xx is the success — the summary and the re-read sit outside the
    // failure path so neither can turn a landed bind into a reported failure.
    setOutcome({ kind: "ok", text: resultSummary("Bound", result, repo) });
    setValues({ repo: "", targetTenant: "", reason: "" });
    setDecisionRef("");
    setTouched(false);
    await afterWrite();
    busyRef.current = false;
    setBusy(false);
  };

  const set = (k: keyof BindFormValues) => (v: string) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  return (
    <form
      className="space-y-3 border-t border-border pt-3"
      onSubmit={onSubmit}
      noValidate
      data-testid="repo-binding-bind-form"
      data-ui-bridge-id="operations.repo-binding-bind-form"
    >
      <p className="text-sm font-medium">Bind a repository</p>
      <div className="form-group">
        <label className="form-label" htmlFor="repo-binding-bind-repo">
          Repository (owner/name)
        </label>
        <input
          id="repo-binding-bind-repo"
          className="input font-mono"
          value={values.repo}
          disabled={busy}
          maxLength={REPO_MAX}
          onChange={(e) => set("repo")(e.target.value)}
          placeholder="owner/name"
          data-testid="repo-binding-bind-repo"
          data-ui-bridge-id="operations.repo-binding-bind-repo"
        />
        {shown.repo && (
          <p
            className="form-error"
            data-testid="repo-binding-bind-repo-error"
            data-ui-bridge-id="operations.repo-binding-bind-repo-error"
          >
            {shown.repo}
          </p>
        )}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="repo-binding-bind-target">
          Bind to tenant
        </label>
        {tenantsError ? (
          <p
            className={`rounded-md border px-2 py-1 text-xs ${UNKNOWN_AMBER}`}
            data-testid="repo-binding-bind-target-unknown"
            data-ui-bridge-id="operations.repo-binding-bind-target-unknown"
          >
            Your tenants are UNKNOWN — the tenant list could not be read:{" "}
            {tenantsError}
          </p>
        ) : null}
        <select
          id="repo-binding-bind-target"
          className="select"
          value={values.targetTenant}
          disabled={busy || tenantsLoading}
          onChange={(e) => set("targetTenant")(e.target.value)}
          data-testid="repo-binding-bind-target"
          data-ui-bridge-id="operations.repo-binding-bind-target"
        >
          <option value="">
            {tenantsLoading
              ? "Loading your tenants…"
              : "Choose a tenant you administer"}
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {!tenantsLoading && !tenantsError && options.length === 0 && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="repo-binding-bind-target-none"
            data-ui-bridge-id="operations.repo-binding-bind-target-none"
          >
            You administer no tenant, so there is nothing to bind to.
          </p>
        )}
        {shown.targetTenant && (
          <p
            className="form-error"
            data-testid="repo-binding-bind-target-error"
            data-ui-bridge-id="operations.repo-binding-bind-target-error"
          >
            {shown.targetTenant}
          </p>
        )}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="repo-binding-bind-reason">
          Reason <span className="text-muted-foreground">(required)</span>
        </label>
        <input
          id="repo-binding-bind-reason"
          className="input"
          value={values.reason}
          disabled={busy}
          maxLength={REASON_MAX}
          onChange={(e) => set("reason")(e.target.value)}
          placeholder="Recorded in the audit of both tenants"
          data-testid="repo-binding-bind-reason"
          data-ui-bridge-id="operations.repo-binding-bind-reason"
        />
        {shown.reason && (
          <p
            className="form-error"
            data-testid="repo-binding-bind-reason-error"
            data-ui-bridge-id="operations.repo-binding-bind-reason-error"
          >
            {shown.reason}
          </p>
        )}
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="repo-binding-bind-decision-ref">
          Decision reference{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="repo-binding-bind-decision-ref"
          className="input"
          value={decisionRef}
          disabled={busy}
          maxLength={DECISION_REF_MAX}
          onChange={(e) => setDecisionRef(e.target.value)}
          placeholder="A decision record path or link"
          data-testid="repo-binding-bind-decision-ref"
          data-ui-bridge-id="operations.repo-binding-bind-decision-ref"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={busy}
        aria-busy={busy}
        data-testid="repo-binding-bind-submit"
        data-ui-bridge-id="operations.repo-binding-bind-submit"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
        {busy ? "Binding…" : "Bind"}
      </Button>
      {outcome && (
        <p
          className={
            outcome.kind === "ok"
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"
          }
          role={outcome.kind === "error" ? "alert" : "status"}
          data-testid="repo-binding-bind-outcome"
          data-ui-bridge-id="operations.repo-binding-bind-outcome"
          data-outcome={outcome.kind}
        >
          {outcome.kind === "ok" ? (
            outcome.text
          ) : (
            <FailureText failure={outcome.failure} />
          )}
        </p>
      )}
    </form>
  );
}

function BindingSection({
  title,
  testId,
  bindings,
  empty,
  unbindStates,
  onUnbind,
}: {
  title: string;
  testId: string;
  bindings: RepoTenantBinding[];
  empty: string;
  unbindStates: Record<string, UnbindState>;
  onUnbind: (repo: string, reason: string) => Promise<void>;
}) {
  return (
    <section
      className="space-y-2"
      data-testid={testId}
      data-ui-bridge-id={`operations.${testId}`}
    >
      <h3 className="text-sm font-medium flex items-center gap-2">
        {title}
        <Badge
          variant="outline"
          className="text-[10px]"
          data-testid={`${testId}-count`}
          data-ui-bridge-id={`operations.${testId}-count`}
        >
          {bindings.length}
        </Badge>
      </h3>
      <RecordList
        items={bindings}
        itemKey={(b) => `${b.caller_side}:${b.repo}`}
        renderRow={(b, ctx) => (
          <BindingRow
            binding={b}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            unbindState={unbindStates[b.repo] ?? IDLE_UNBIND}
            onUnbind={onUnbind}
          />
        )}
        empty={
          <p
            className="text-xs text-muted-foreground"
            data-testid={`${testId}-empty`}
            data-ui-bridge-id={`operations.${testId}-empty`}
          >
            {empty}
          </p>
        }
      />
    </section>
  );
}

export interface RepoTenantBindingsProps {
  /**
   * Called after every bind or unbind settles — success or failure, since a
   * failed write may still have landed — so the page can re-read what else a
   * binding changes (the connected-orgs card's "bound to" rows).
   */
  onChanged?: () => void;
}

export function RepoTenantBindings({ onChanged }: RepoTenantBindingsProps = {}) {
  const { user } = useAuth();
  const { tenants, activeTenantId } = useTenant();
  // The question the three routes' gate asks: admin IN THE ACTIVE TENANT.
  const canAdmin = isActiveTenantCoordAdmin({ user, tenants, activeTenantId });

  const [read, setRead] = useState<ListRead>({ state: "loading" });
  // Request sequencing: only the LATEST read may land. A slower earlier read
  // (a refresh racing a post-write re-read, or a tenant switch) is dropped.
  const readSeq = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++readSeq.current;
    try {
      const data = await fetchRepoTenantBindings();
      if (seq !== readSeq.current) return;
      if (!data || !Array.isArray(data.bindings)) {
        setRead({
          state: "unknown",
          failure: {
            refusal: {
              status: null,
              code: null,
              message: "coord answered without a bindings list",
            },
            envelope: null,
          },
        });
        return;
      }
      setRead({ state: "loaded", data });
    } catch (err) {
      if (seq !== readSeq.current) return;
      setRead({ state: "unknown", failure: failureOf(err) });
    }
  }, []);

  // The last unbind's terminal success, kept at card level (see UnbindForm).
  const [unbindNotice, setUnbindNotice] = useState<string | null>(null);
  // Per-repo unbind state, at card level for the same reason; the ref is the
  // synchronous re-entry guard (state lags a render behind).
  const [unbindStates, setUnbindStates] = useState<Record<string, UnbindState>>(
    {}
  );
  const unbindBusy = useRef(new Set<string>());

  useEffect(() => {
    // Outcomes belong to the tenant they were reached in: a failure kept
    // across a switch would render as an "unlisted" (maybe-applied) binding
    // of the new tenant. An unbind still in flight keeps its entry.
    setUnbindNotice(null);
    setUnbindStates((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([, s]) => s.busy))
    );
    if (!canAdmin) {
      // Invalidate anything in flight: it was asked under another answer.
      readSeq.current += 1;
      return;
    }
    // A tenant switch re-reads from scratch: the previous tenant's list is not
    // this tenant's, so it is not shown while the new one loads.
    setRead({ state: "loading" });
    void refetch();
  }, [canAdmin, activeTenantId, refetch]);

  const afterWrite = useCallback(async () => {
    onChanged?.();
    await refetch();
  }, [onChanged, refetch]);

  const onUnbind = useCallback(
    async (repo: string, reason: string) => {
      if (unbindBusy.current.has(repo)) return;
      unbindBusy.current.add(repo);
      setUnbindStates((prev) => ({
        ...prev,
        [repo]: { busy: true, error: null },
      }));
      let result: RepoBindingResult | null;
      try {
        result = await unbindRepoTenant({ repo, reason });
      } catch (err) {
        const failure = failureOf(err);
        setUnbindStates((prev) => ({
          ...prev,
          [repo]: { busy: true, error: failure },
        }));
        // Re-read before the control re-enables: a timed-out unbind may have
        // landed, and the list is what says so.
        await afterWrite();
        unbindBusy.current.delete(repo);
        setUnbindStates((prev) => ({
          ...prev,
          [repo]: { busy: false, error: failure },
        }));
        return;
      }
      // Any 2xx is the success; summary and re-read are outside the failure
      // path so neither can report a landed unbind as failed.
      setUnbindNotice(resultSummary("Unbound", result, repo));
      unbindBusy.current.delete(repo);
      setUnbindStates((prev) => {
        const next = { ...prev };
        delete next[repo];
        return next;
      });
      await afterWrite();
    },
    [afterWrite]
  );

  const boundHere =
    read.state === "loaded"
      ? read.data.bindings.filter((b) => b.caller_side === "bound")
      : [];
  const boundAway =
    read.state === "loaded"
      ? read.data.bindings.filter((b) => b.caller_side === "org")
      : [];
  // An unbind failure whose row the re-read no longer lists has no row to
  // render on — the timeout case, where the unbind landed after all. It is
  // shown at card level instead of being dropped.
  const listed = new Set(
    read.state === "loaded" ? read.data.bindings.map((b) => b.repo) : []
  );
  const orphanFailures =
    read.state === "loaded"
      ? Object.entries(unbindStates).filter(
          (entry): entry is [string, UnbindState & { error: CardFailure }] =>
            entry[1].error !== null && !entry[1].busy && !listed.has(entry[0])
        )
      : [];

  return (
    <Card
      data-testid="repo-tenant-bindings"
      data-ui-bridge-id="operations.repo-tenant-bindings"
      data-read-state={canAdmin ? read.state : "admin-only"}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          Repository tenant bindings
          {canAdmin && (
            <span
              className="ml-auto"
              data-ui-bridge-id="operations.repo-tenant-bindings-refresh"
            >
              <RefreshButton
                onRefresh={refetch}
                label="Refresh bindings"
                title="Re-reads the bindings coord holds for this tenant"
                data-testid="repo-tenant-bindings-refresh"
              />
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A binding makes a repository governed by a tenant other than its
          GitHub organization&apos;s tenant. Repositories bound here do not
          appear under your connected organizations, so they are listed below.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canAdmin ? (
          <div
            data-testid="repo-tenant-bindings-admin-only"
            data-ui-bridge-id="operations.repo-tenant-bindings-admin-only"
          >
            <ReadOnlyNotice label="Administrator only — the bindings are listed, bound and unbound by an administrator of the active tenant." />
          </div>
        ) : (
          <>
            {read.state === "loading" && (
              <div
                data-testid="repo-tenant-bindings-loading"
                data-ui-bridge-id="operations.repo-tenant-bindings-loading"
              >
                <RecordList
                  items={[]}
                  itemKey={() => ""}
                  renderRow={() => null}
                  loaded={false}
                />
              </div>
            )}
            {unbindNotice && (
              <p
                className="text-xs text-muted-foreground"
                role="status"
                data-testid="repo-binding-unbind-outcome"
                data-ui-bridge-id="operations.repo-binding-unbind-outcome"
              >
                {unbindNotice}
              </p>
            )}
            {orphanFailures.map(([repo, s]) => (
              <p
                key={repo}
                className="text-xs text-destructive"
                role="alert"
                data-testid={`repo-binding-unbind-error-unlisted-${repo}`}
                data-ui-bridge-id="operations.repo-binding-unbind-error-unlisted"
              >
                Unbind of {repo} reported a failure, and the re-read no longer
                lists the binding, so the change may have been applied:{" "}
                <FailureText failure={s.error} />
              </p>
            ))}
            {read.state === "unknown" && (
              <p
                className={`rounded-md border px-3 py-2 text-sm ${UNKNOWN_AMBER}`}
                role="alert"
                data-testid="repo-tenant-bindings-unknown"
                data-ui-bridge-id="operations.repo-tenant-bindings-unknown"
              >
                Bindings UNKNOWN — the list could not be read:{" "}
                <FailureText failure={read.failure} />
              </p>
            )}
            {read.state === "loaded" && (
              <>
                <BindingSection
                  title="Bound to this tenant"
                  testId="repo-bindings-bound-here"
                  bindings={boundHere}
                  empty={`No repositories are bound to this tenant (measured ${absoluteTime(read.data.measured_at)}).`}
                  unbindStates={unbindStates}
                  onUnbind={onUnbind}
                />
                <BindingSection
                  title="Bound away from this tenant's organizations"
                  testId="repo-bindings-bound-away"
                  bindings={boundAway}
                  empty={`No repository of this tenant's organizations is bound elsewhere (measured ${absoluteTime(read.data.measured_at)}).`}
                  unbindStates={unbindStates}
                  onUnbind={onUnbind}
                />
              </>
            )}
            <BindForm afterWrite={afterWrite} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
