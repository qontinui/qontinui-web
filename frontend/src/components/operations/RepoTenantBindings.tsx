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
 * Status honesty (served policy `ux-priorities`
 * `a-status-signal-must-observe-the-state-it-names`): a failed list read
 * renders UNKNOWN with coord's code and message, never an empty list; an empty
 * MEASURED list says so with the time coord measured it. Every action
 * acknowledges itself (disabled + spinner) and ends in a terminal state that
 * names coord's error code on failure (`an-action-must-acknowledge-itself`).
 *
 * Rows compose the console primitives (`RecordList` / `RecordRow` /
 * `RecordDetail`, style guide R2/R5): one line per binding, detail and the
 * Unbind form expand in place.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Link2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  UNKNOWN_AMBER,
  absoluteTime,
} from "@/components/console";
import { useTenant, type Tenant } from "@/contexts/tenant-context";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import {
  bindRepoTenant,
  fetchRepoTenantBindings,
  unbindRepoTenant,
  type RepoBindingResult,
  type RepoBindingsResponse,
  type RepoTenantBinding,
} from "@/lib/api/operations/prMergeOnboarding";

/**
 * `owner/name` — one slash, both halves non-empty, GitHub's own character set.
 * The same shape the web backend's restore proxy accepts; coord normalizes
 * case and answers `400 invalid_repo` for anything it still refuses.
 */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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

/** One-line summary of a successful bind or unbind, from coord's answer. */
export function resultSummary(
  verb: "Bound" | "Unbound",
  r: RepoBindingResult
): string {
  if (r.idempotent) {
    return `${r.repo}: already in that state — nothing changed.`;
  }
  const moved = `moved tenant_repos ${r.moved.tenant_repos}, profile ${r.moved.profile}, canonical ${r.moved.canonical}`;
  const audit = `${r.audit_ids.length} audit ${r.audit_ids.length === 1 ? "row" : "rows"}`;
  const notified = r.notified ? "operator notified" : "operator NOT notified";
  return `${verb} ${r.repo} — ${moved}; ${audit}; ${notified}.`;
}

type ListRead =
  | { state: "loading" }
  | { state: "loaded"; data: RepoBindingsResponse }
  | { state: "unknown"; refusal: CoordRefusal };

type ActionOutcome =
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

function slugOrUnknown(slug: string | null | undefined): string {
  return slug && slug.trim() !== "" ? slug : "unknown tenant";
}

/**
 * The Unbind / Reclaim control inside a row's detail. A failure stays here,
 * beside the reason the operator typed. A success is reported UP, because the
 * re-read that follows removes this row — and this form with it — so a
 * message kept here would vanish with the thing it reports on.
 */
function UnbindForm({
  binding,
  onUnbound,
}: {
  binding: RepoTenantBinding;
  onUnbound: (summary: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonMissing = reason.trim() === "";
  const verb = binding.caller_side === "org" ? "Reclaim" : "Unbind";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busy || reasonMissing) return;
    setBusy(true);
    setError(null);
    try {
      const result = await unbindRepoTenant({
        repo: binding.repo,
        reason: reason.trim(),
      });
      await onUnbound(resultSummary("Unbound", result));
    } catch (err) {
      setError(refusalText(coordRefusalOf(err)));
    } finally {
      setBusy(false);
    }
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
          {error}
        </p>
      )}
    </form>
  );
}

function BindingRow({
  binding,
  expanded,
  onToggle,
  onUnbound,
}: {
  binding: RepoTenantBinding;
  expanded: boolean;
  onToggle: () => void;
  onUnbound: (summary: string) => Promise<void>;
}) {
  const label =
    binding.caller_side === "bound"
      ? `from ${slugOrUnknown(binding.org_tenant_slug)}`
      : `bound to ${slugOrUnknown(binding.tenant_slug)}`;
  return (
    <div
      data-ui-bridge-id="operations.repo-binding-row"
      data-caller-side={binding.caller_side}
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
            <CoordAdminOnly>
              <UnbindForm binding={binding} onUnbound={onUnbound} />
            </CoordAdminOnly>
          }
        />
      </RecordRow>
    </div>
  );
}

function BindForm({ onDone }: { onDone: () => Promise<void> }) {
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
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const errors = validateBindForm(values);
  const shown = touched ? errors : {};

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busy || Object.keys(errors).length > 0) return;
    setBusy(true);
    setOutcome(null);
    try {
      const ref = decisionRef.trim();
      const result = await bindRepoTenant({
        repo: values.repo.trim(),
        target_tenant: values.targetTenant,
        reason: values.reason.trim(),
        ...(ref ? { decision_ref: ref } : {}),
      });
      setOutcome({ kind: "ok", text: resultSummary("Bound", result) });
      setValues({ repo: "", targetTenant: "", reason: "" });
      setDecisionRef("");
      setTouched(false);
      await onDone();
    } catch (err) {
      setOutcome({ kind: "error", text: refusalText(coordRefusalOf(err)) });
    } finally {
      setBusy(false);
    }
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
          {outcome.text}
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
  onUnbound,
}: {
  title: string;
  testId: string;
  bindings: RepoTenantBinding[];
  empty: string;
  onUnbound: (summary: string) => Promise<void>;
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
            onUnbound={onUnbound}
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

export function RepoTenantBindings() {
  const [read, setRead] = useState<ListRead>({ state: "loading" });

  const refetch = useCallback(async () => {
    try {
      const data = await fetchRepoTenantBindings();
      if (!data || !Array.isArray(data.bindings)) {
        setRead({
          state: "unknown",
          refusal: {
            status: null,
            code: null,
            message: "coord answered without a bindings list",
          },
        });
        return;
      }
      setRead({ state: "loaded", data });
    } catch (err) {
      setRead({ state: "unknown", refusal: coordRefusalOf(err) });
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // The last unbind's terminal success, kept at card level (see UnbindForm).
  const [unbindNotice, setUnbindNotice] = useState<string | null>(null);
  const onUnbound = useCallback(
    async (summary: string) => {
      setUnbindNotice(summary);
      await refetch();
    },
    [refetch]
  );

  const boundHere =
    read.state === "loaded"
      ? read.data.bindings.filter((b) => b.caller_side === "bound")
      : [];
  const boundAway =
    read.state === "loaded"
      ? read.data.bindings.filter((b) => b.caller_side === "org")
      : [];

  return (
    <Card
      data-testid="repo-tenant-bindings"
      data-ui-bridge-id="operations.repo-tenant-bindings"
      data-read-state={read.state}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          Repository tenant bindings
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
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A binding makes a repository governed by a tenant other than its
          GitHub organization&apos;s tenant. Repositories bound here do not
          appear under your connected organizations, so they are listed below.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
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
        {read.state === "unknown" && (
          <p
            className={`rounded-md border px-3 py-2 text-sm ${UNKNOWN_AMBER}`}
            role="alert"
            data-testid="repo-tenant-bindings-unknown"
            data-ui-bridge-id="operations.repo-tenant-bindings-unknown"
          >
            Bindings UNKNOWN — the list could not be read:{" "}
            {refusalText(read.refusal)}
          </p>
        )}
        {read.state === "loaded" && (
          <>
            <BindingSection
              title="Bound to this tenant"
              testId="repo-bindings-bound-here"
              bindings={boundHere}
              empty={`No repositories are bound to this tenant (measured ${absoluteTime(read.data.measured_at)}).`}
              onUnbound={onUnbound}
            />
            <BindingSection
              title="Bound away from this tenant's organizations"
              testId="repo-bindings-bound-away"
              bindings={boundAway}
              empty={`No repository of this tenant's organizations is bound elsewhere (measured ${absoluteTime(read.data.measured_at)}).`}
              onUnbound={onUnbound}
            />
          </>
        )}
        <CoordAdminOnly>
          <BindForm onDone={refetch} />
        </CoordAdminOnly>
      </CardContent>
    </Card>
  );
}
