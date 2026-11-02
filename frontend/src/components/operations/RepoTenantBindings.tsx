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
 *
 * Refusals follow the bind door's contract (qontinui-coord#3522
 * `BindingError`): each code's extras are rendered as one more sentence
 * ({@link refusalDetail}) — `schema_settling`'s retry delay and replica census
 * (a `null` count is UNKNOWN, never 0), `in_flight_merge_proposals`'
 * `proposal_ids`, `org_unbound`'s org and remedy, the side and tenant of
 * `not_admin_in_both_tenants` (a `null` tenant is one coord withholds),
 * `binding_not_found`'s repo, `tenancy_changed`'s retry, and the rest.
 * A write answered 2xx is a success whatever its body says. A failed write is
 * followed by a re-read, because a write that timed out, or whose answer was
 * lost, may still have landed (the web's `coord_write_timeout` and
 * `answer_lost` refusals say so, and are rendered with their next action), and
 * so may one whose COMMIT failed (coord answers that
 * `repo_binding_commit_unknown`). A `repo_binding_write_failed` reads as
 * "nothing was written" only when its body says `"rolled_back": true`;
 * without that marker it is read defensively as "may have landed", like every
 * coord 5xx outside {@link NOTHING_WRITTEN_5XX} (the web's own refusals are
 * decided by their discriminator) — see {@link rolledBack} and
 * {@link writeMayHaveLanded}.
 *
 * Rows compose the console primitives (`RecordList` / `RecordRow` /
 * `RecordDetail`, style guide R2/R5): one line per binding, detail and the
 * Unbind form expand in place.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  type RepoBindingRefusalBody,
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
 * Input caps. `reason` / `decision_ref` are coord's own bound — at most 2000
 * characters (coord counts them after trimming, and this form sends them
 * trimmed) — which the web backend's `RepoBindRequest` / `RepoUnbindRequest`
 * mirror, so a value the browser lets through is never a 422 there. `repo` is
 * the `owner/name` this form accepts: GitHub's 39-char login + `/` + its
 * 100-char name (the backend admits coord's longer URL spellings too).
 */
const REPO_MAX = 140;
const REASON_MAX = 2000;
const DECISION_REF_MAX = 2000;

/**
 * A coord refusal as this card renders it: status, typed code, sentence, and
 * the rejected body's fields (`{}` when it was not a JSON object), from which
 * {@link refusalDetail} reads the code's extras.
 */
export interface CoordRefusal {
  status: number | null;
  code: string | null;
  message: string;
  body: Partial<RepoBindingRefusalBody> & Record<string, unknown>;
}

/** A machine code (`not_admin_in_both_tenants`), as opposed to a sentence. */
const CODE_RE = /^[a-z][a-z0-9_]*$/;

function nonBlank(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Read a rejected client call back into coord's typed error. Coord's core
 * answers `{"error": "<code>", "message": "<text>", ...extras}` and the proxy
 * passes it through verbatim. The operator layer in front of the core answers
 * `{error, hint}`, or a SENTENCE in `error` (`"insufficient role"`), so only a
 * snake_case `error` (or web `detail`) is read as the code, and the message
 * falls back through `hint` and a sentence `error` before the shared
 * operations sentence (a transport failure, the web gate's own refusal).
 */
export function coordRefusalOf(err: unknown): CoordRefusal {
  const status = httpStatusOf(err);
  let body: CoordRefusal["body"] = {};
  try {
    const parsed: unknown = JSON.parse(httpBodyOf(err) ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as CoordRefusal["body"];
    }
  } catch {
    // not JSON — fall through to the shared sentence
  }
  const error = nonBlank(body.error);
  const detail = nonBlank(body.detail);
  const code =
    error !== null && CODE_RE.test(error)
      ? error
      : detail !== null && CODE_RE.test(detail)
        ? detail
        : null;
  const message =
    nonBlank(body.message) ??
    nonBlank(body.hint) ??
    (error !== null && error !== code ? error : null) ??
    operationsErrorMessage(err);
  return { status, code, message, body };
}

/** "403 not_admin_in_both_tenants — <message>", omitting what is absent. */
export function refusalText(r: CoordRefusal): string {
  const head = [r.status !== null ? String(r.status) : null, r.code]
    .filter(Boolean)
    .join(" ");
  return head ? `${head} — ${r.message}` : r.message;
}

/** A replica count from `schema_settling`: `null`/absent is UNKNOWN, never 0. */
function censusCount(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "UNKNOWN";
}

/**
 * Names a tenant id for a sentence: its slug when the operator belongs to it,
 * else the id itself.
 */
export type TenantLabel = (tenantId: string) => string;

const idLabel: TenantLabel = (id) => id;

/**
 * The one sentence a refusal's EXTRAS add to its message, per the bind door's
 * contract (qontinui-coord#3522 `BindingError::body`). `null` when the code
 * carries no extras worth a sentence. Every field is read defensively: an
 * absent extra is said to be "not reported", never rendered as empty or zero.
 */
export function refusalDetail(
  r: CoordRefusal,
  tenantLabel: TenantLabel = idLabel
): string | null {
  const b = r.body;
  switch (r.code) {
    case "schema_settling": {
      const secs =
        typeof b.retry_after_secs === "number" &&
        Number.isFinite(b.retry_after_secs)
          ? `Nothing was written; retry in about ${b.retry_after_secs} s.`
          : "Nothing was written; retry shortly (the body named no delay).";
      const census =
        b.live_replicas == null && b.not_ready_replicas == null
          ? "The replica census is UNKNOWN — coord could not read it."
          : `Replicas: ${censusCount(b.live_replicas)} live, ${censusCount(b.not_ready_replicas)} not yet applying bindings.`;
      return `${secs} ${census}`;
    }
    case "in_flight_merge_proposals": {
      // An empty list cannot be "0 in flight" while refusing for in-flight work.
      if (!Array.isArray(b.proposal_ids) || b.proposal_ids.length === 0) {
        return "The in-flight proposals were not reported. Wait for them to land or cancel them, then retry.";
      }
      const ids = b.proposal_ids.map(String);
      return `${ids.length} merge ${ids.length === 1 ? "proposal is" : "proposals are"} in flight: ${ids.join(", ")}. Wait for ${ids.length === 1 ? "it" : "them"} to land or cancel ${ids.length === 1 ? "it" : "them"}, then retry.`;
    }
    case "repo_binding_commit_unknown":
      // The commit itself failed, so coord cannot say whether it applied.
      return "The write may have landed: coord's commit failed, so whether it applied is unknown. Before retrying, re-read the bindings (the refresh button at the top of this card) and check whether the change is there.";
    case "repo_binding_write_failed":
      // Coord marks a genuine rollback (a failure before the COMMIT) with
      // `rolled_back: true`, and only that marker establishes "nothing was
      // written". Without it the outcome is read defensively as unknown.
      return rolledBack(r)
        ? "Coord marked the transaction as rolled back before its commit, so nothing was written; it is safe to retry."
        : 'Coord\'s answer carries no rolled_back: true marker, so "nothing was written" is not established. Before retrying, re-read the bindings (the refresh button at the top of this card) and check whether the change is there.';
    case "org_unbound": {
      const org = nonBlank(b.org) ?? "(org not reported)";
      const remedy = nonBlank(b.remedy);
      return `GitHub organization ${org} is bound to no tenant. Connect it to a tenant first (install the GitHub App on it and connect it on this page), then retry.${remedy ? ` Coord's remedy: ${remedy}.` : ""}`;
    }
    case "not_admin_in_both_tenants": {
      const side =
        b.failed_side === "governing"
          ? "the repository's current governing tenant"
          : b.failed_side === "target"
            ? "the target tenant"
            : "one of the two tenants (coord did not say which)";
      const tenant =
        typeof b.failed_tenant === "string" && b.failed_tenant !== ""
          ? tenantLabel(b.failed_tenant)
          : "coord withholds which tenant";
      return `You are not an administrator in ${side} (${tenant}).`;
    }
    case "caller_tenant_not_a_party":
      // Coord returns this from a bind only (an unbind by a non-party is
      // `binding_not_found`); its parties are the governing tenant and the
      // target.
      return "Switch the active tenant to the repository's governing tenant (the tenant it is bound to, or, if it is unbound, its GitHub organization's tenant) or to the tenant you are binding it to, then retry.";
    case "binding_not_found": {
      const repo = nonBlank(b.repo) ?? "The repository";
      return `${repo} has no binding visible to this tenant — it may already have been unbound. Re-read the bindings (the refresh button at the top of this card) to confirm.`;
    }
    case "tenancy_changed":
      return "The binding changed while coord was authorizing this request; nothing was written. Re-read the bindings (the refresh button at the top of this card), then retry.";
    case "tenant_not_found":
      return nonBlank(b.tenant_id)
        ? `Coord has no tenant ${b.tenant_id}.`
        : null;
    case "migration_pending":
      return nonBlank(b.missing) ? `Missing: ${b.missing}.` : null;
    default:
      break;
  }
  if (nonBlank(b.required) !== null) {
    const held = Array.isArray(b.held) ? b.held.map(String) : null;
    return `This needs the ${b.required} role in the active tenant; you hold ${held === null ? "roles not reported" : held.length > 0 ? held.join(", ") : "none"}.`;
  }
  return null;
}

/**
 * Whether coord's answer positively says a failed write was rolled back, so
 * nothing was written: a `repo_binding_write_failed` whose body carries
 * `"rolled_back": true` (qontinui-coord#3522 `BindingError::WriteFailed`, the
 * failure arm before the COMMIT). Only the JSON `true` counts, and only on
 * that code; nothing else establishes a rollback (see
 * {@link writeMayHaveLanded} for how every other failure is read).
 */
export function rolledBack(r: CoordRefusal): boolean {
  return r.code === "repo_binding_write_failed" && r.body.rolled_back === true;
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

/**
 * The web backend's own refusals that say the change MAY have been applied:
 * the write timed out after it was sent, or coord's answer was lost or not
 * JSON. Every other web-side refusal (`coord_unreachable`: coord never saw
 * the request) is a definite "nothing changed".
 */
const WEB_MAY_HAVE_LANDED = new Set([
  "coord_write_timeout",
  "answer_lost",
  "answer_not_json",
]);

/**
 * The bind door's 5xx codes whose contract is "nothing was written"
 * (qontinui-coord#3522 `BindingError`). An allowlist, not "any coord code": a
 * code outside it — `internal_panic` from coord's panic guard, which can fire
 * after the commit, or a code coord adds later — stays ambiguous.
 *
 * `repo_binding_commit_unknown` (a failed COMMIT, whose outcome coord cannot
 * know) is never here.
 *
 * `repo_binding_write_failed` is not here either: the contract is not the
 * code but the marker. It is "nothing was written" per response, only when
 * its body carries `"rolled_back": true` ({@link rolledBack}), which coord
 * sends from the failure arm before the COMMIT, after the rollback. A
 * `write_failed` without the marker, or with any value but `true`, is read
 * defensively as ambiguous, like any other coord 5xx outside this list.
 */
const NOTHING_WRITTEN_5XX = new Set([
  "authz_lookup_failed",
  "repo_binding_read_failed",
  "migration_pending",
  "schema_settling",
  "coord_db_unavailable",
]);

/**
 * Whether a failed WRITE may still have been applied, decided by which side
 * answered and what that side meant:
 * - the web backend's own refusal envelope decides from its discriminator;
 * - no HTTP answer at all (`status === null`: an abort or a network error) is
 *   ambiguous;
 * - a 4xx is a refusal before anything was written;
 * - a 5xx is "nothing written" only for a code on {@link NOTHING_WRITTEN_5XX},
 *   or a `repo_binding_write_failed` coord marked rolled back
 *   ({@link rolledBack}).
 */
export function writeMayHaveLanded(f: CardFailure): boolean {
  if (
    f.envelope?.kind === "refusal" &&
    f.envelope.refusal.source === "web_backend"
  ) {
    return WEB_MAY_HAVE_LANDED.has(f.envelope.refusal.discriminator ?? "");
  }
  if (f.refusal.status === null) return true;
  if (f.refusal.status < 500) return false;
  if (rolledBack(f.refusal)) return false;
  return !(f.refusal.code !== null && NOTHING_WRITTEN_5XX.has(f.refusal.code));
}

export function failureOf(err: unknown): CardFailure {
  const reading = operationsErrorReading(err);
  return {
    refusal: coordRefusalOf(err),
    envelope: reading.kind === "refusal" ? reading : null,
  };
}

/**
 * One failure's text: the envelope with its next action, else coord's code
 * and message — then the code's extras ({@link refusalDetail}) as a sentence of
 * their own, stamped with the code for the UI Bridge.
 */
function FailureText({ failure }: { failure: CardFailure }) {
  const { tenants } = useTenant();
  const tenantLabel = useMemo(() => tenantLabelFrom(tenants), [tenants]);
  const detail = refusalDetail(failure.refusal, tenantLabel);
  return (
    <>
      {failure.envelope !== null ? (
        <>
          {failure.refusal.status !== null && `${failure.refusal.status} — `}
          <BackendErrorMessage error={failure.envelope} />
        </>
      ) : (
        refusalText(failure.refusal)
      )}
      {detail !== null && (
        <span
          className="block"
          data-testid="repo-binding-refusal-detail"
          data-ui-bridge-id="operations.repo-binding-refusal-detail"
          data-refusal-code={failure.refusal.code ?? undefined}
        >
          {detail}
        </span>
      )}
    </>
  );
}

/**
 * A {@link TenantLabel} over the operator's own tenants: `slug` for a tenant
 * they belong to, else the bare id (a tenant they cannot see by name).
 */
export function tenantLabelFrom(tenants: readonly Tenant[]): TenantLabel {
  const slugs = new Map(tenants.map((t) => [t.id, t.slug] as const));
  return (id) => slugs.get(id) ?? id;
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
 * coord's answer does not name one. `tenantLabel` names `from_tenant` /
 * `to_tenant`. The flags coord sets only when they happened —
 * `binding_deleted`, `tombstone_cleared`, `enrollment_spawned` — are named
 * when `true` and otherwise left unsaid.
 */
export function resultSummary(
  verb: "Bound" | "Unbound",
  r: RepoBindingResult | null,
  repo: string,
  tenantLabel: TenantLabel = idLabel
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
  const to = nonBlank(res.to_tenant);
  const from = nonBlank(res.from_tenant);
  const governance =
    to !== null
      ? `governed by ${tenantLabel(to)} after this write${from !== null ? ` (was ${tenantLabel(from)})` : ""}`
      : "governing tenant not reported";
  const flags = [
    res.binding_deleted === true ? "binding deleted" : null,
    res.tombstone_cleared === true ? "un-enrollment tombstone cleared" : null,
    res.enrollment_spawned === true
      ? "enrollment started for the new tenant"
      : null,
  ].filter((f): f is string => f !== null);
  return `${verb} ${name} — ${governance}; ${moved}; ${audit}; ${notified}${flags.length > 0 ? `; ${flags.join("; ")}` : ""}.`;
}

type ListRead =
  | { state: "loading" }
  | { state: "loaded"; data: RepoBindingsResponse }
  | { state: "unknown"; failure: CardFailure };

type ActionOutcome =
  | { kind: "ok"; text: string }
  | { kind: "error"; failure: CardFailure }
  /** The write was sent under another tenant: not checked here. */
  | { kind: "elsewhere"; text: string };

/** A bind's outcome, tagged with the tenant it was sent under. */
type BindOutcome = (
  | { kind: "ok"; text: string }
  | { kind: "error"; failure: CardFailure }
) & { tenant: string | null; repo: string };

/**
 * What a write sent under another tenant says instead of its outcome: this
 * card now shows a different tenant's list, which is not the one the write's
 * outcome would be read from.
 */
export function settledElsewhereText(verb: "bind" | "unbind", repo: string) {
  return `The ${verb} of ${repo} was sent under another tenant, and this card now shows a different one, so its outcome is not checked here. Switch back to that tenant and re-read its bindings to see whether it landed.`;
}

/**
 * The active tenant as of the latest commit, readable after an await. A layout
 * effect, so the ref is current before any promise can resolve after a commit.
 * That property is held by React's commit order (layout effects run inside the
 * commit, passive ones are scheduled after it), not by a test: RTL's `act`
 * flushes passive effects too, so the suite stays green with `useEffect` —
 * which does not make that change safe.
 */
function useLatestTenant(activeTenantId: string | null | undefined) {
  const ref = useRef(activeTenantId);
  useLayoutEffect(() => {
    ref.current = activeTenantId;
  }, [activeTenantId]);
  return ref;
}

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
  // A null `org_tenant_id` is coord saying the org has no tenant account at
  // all (`LIST_SQL`'s LEFT JOIN found none), not that the tenant is hidden.
  const label =
    binding.caller_side === "bound"
      ? binding.org_tenant_id == null
        ? "from an org bound to no tenant"
        : `from ${slugOrUnknown(binding.org_tenant_slug)}`
      : `bound to ${slugOrUnknown(binding.tenant_slug)}`;
  // The unbind's progress and failure render inside the detail; a collapsed
  // row still says one is in flight or failed (in RecordRow's non-truncating
  // status slot), so neither is hidden by opening another row.
  const collapsedStatus = expanded
    ? null
    : unbindState.busy
      ? "unbinding…"
      : unbindState.error
        ? "unbind failed — expand for details"
        : null;
  return (
    <div
      data-ui-bridge-id="operations.repo-binding-row"
      data-caller-side={binding.caller_side}
      data-unbind-busy={unbindState.busy ? "true" : undefined}
    >
      <RecordRow
        identity={binding.repo}
        label={<span title={label}>{label}</span>}
        status={
          collapsedStatus ? (
            <span
              className={`whitespace-nowrap text-xs ${
                unbindState.busy ? "text-muted-foreground" : "text-destructive"
              }`}
              data-testid={`repo-binding-row-status-${binding.repo}`}
            >
              {collapsedStatus}
            </span>
          ) : undefined
        }
        attention={unbindState.error && !unbindState.busy ? "author" : "none"}
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
              <dd>
                {binding.org_tenant_id == null
                  ? "none — the org is bound to no tenant"
                  : slugOrUnknown(binding.org_tenant_slug)}
              </dd>
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
  const {
    tenants,
    activeTenantId,
    loading: tenantsLoading,
    error: tenantsError,
  } = useTenant();
  const options = useMemo(() => bindTargetOptions(tenants), [tenants]);
  const tenantLabel = useMemo(() => tenantLabelFrom(tenants), [tenants]);
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
  const [outcome, setOutcome] = useState<BindOutcome | null>(null);
  // An outcome belongs to the tenant it was reached in (as the card's unbind
  // outcomes do); a bind still in flight keeps its result for when it lands.
  useEffect(() => {
    if (!busyRef.current) setOutcome(null);
  }, [activeTenantId]);
  // Decided at render against the CURRENT tenant, so no window between a
  // switch and the write (or its re-read) settling can show one tenant's
  // outcome on another's card. Switching back while the write is still in
  // flight shows the real outcome; once it has settled, the switch-clear
  // above has removed it, and the list is what says whether it landed.
  const shownOutcome: ActionOutcome | null =
    outcome === null
      ? null
      : outcome.tenant !== activeTenantId
        ? {
            kind: "elsewhere",
            text: settledElsewhereText("bind", outcome.repo),
          }
        : outcome;
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
    const sentUnder = activeTenantId;
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
      setOutcome({
        kind: "error",
        failure: failureOf(err),
        tenant: sentUnder,
        repo,
      });
      await afterWrite();
      busyRef.current = false;
      setBusy(false);
      return;
    }
    // Any 2xx is the success — the summary and the re-read sit outside the
    // failure path so neither can turn a landed bind into a reported failure.
    setOutcome({
      kind: "ok",
      text: resultSummary("Bound", result, repo, tenantLabel),
      tenant: sentUnder,
      repo,
    });
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
        <p
          className="text-xs text-muted-foreground"
          data-ui-bridge-id="operations.repo-binding-bind-target-hint"
        >
          Coord binds only when the active tenant is the repository&apos;s
          current governing tenant or the tenant chosen here, and you administer
          both.
        </p>
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
      {shownOutcome && (
        <p
          className={
            shownOutcome.kind === "error"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
          role={shownOutcome.kind === "error" ? "alert" : "status"}
          data-testid="repo-binding-bind-outcome"
          data-ui-bridge-id="operations.repo-binding-bind-outcome"
          data-outcome={shownOutcome.kind}
        >
          {shownOutcome.kind === "error" ? (
            <FailureText failure={shownOutcome.failure} />
          ) : (
            shownOutcome.text
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

export function RepoTenantBindings({
  onChanged,
}: RepoTenantBindingsProps = {}) {
  const { user } = useAuth();
  const { tenants, activeTenantId } = useTenant();
  // The question the three routes' gate asks: admin IN THE ACTIVE TENANT.
  const canAdmin = isActiveTenantCoordAdmin({ user, tenants, activeTenantId });
  const tenantLabel = useMemo(() => tenantLabelFrom(tenants), [tenants]);

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
              body: {},
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
    // of the new tenant. An unbind still in flight keeps its entry (the busy
    // guard), but not its error: the other party's card lists the same repo,
    // and must not show this tenant's failure on its row. The failure path
    // re-applies the error once the tenant it was sent under is active again.
    setUnbindNotice(null);
    setUnbindStates((prev) =>
      Object.fromEntries(
        Object.entries(prev)
          .filter(([, s]) => s.busy)
          .map(([repo, s]) => [repo, { ...s, error: null }])
      )
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

  // An unbind still in flight across a tenant switch keeps its busy guard, but
  // its outcome is not the new tenant's: the re-read is the new tenant's list,
  // not the one the write's outcome would be read from.
  const tenantRef = useLatestTenant(activeTenantId);
  const dropElsewhere = useCallback((repo: string) => {
    unbindBusy.current.delete(repo);
    setUnbindStates((prev) => {
      const next = { ...prev };
      delete next[repo];
      return next;
    });
    setUnbindNotice(settledElsewhereText("unbind", repo));
  }, []);

  const onUnbind = useCallback(
    async (repo: string, reason: string) => {
      if (unbindBusy.current.has(repo)) return;
      unbindBusy.current.add(repo);
      const sentUnder = tenantRef.current;
      setUnbindStates((prev) => ({
        ...prev,
        [repo]: { busy: true, error: null },
      }));
      let result: RepoBindingResult | null;
      try {
        result = await unbindRepoTenant({ repo, reason });
      } catch (err) {
        const failure = failureOf(err);
        if (tenantRef.current === sentUnder) {
          setUnbindStates((prev) => ({
            ...prev,
            [repo]: { busy: true, error: failure },
          }));
        }
        // Re-read before the control re-enables: a timed-out unbind may have
        // landed, and the list is what says so.
        await afterWrite();
        if (tenantRef.current !== sentUnder) {
          dropElsewhere(repo);
          return;
        }
        unbindBusy.current.delete(repo);
        setUnbindStates((prev) => ({
          ...prev,
          [repo]: { busy: false, error: failure },
        }));
        return;
      }
      if (tenantRef.current !== sentUnder) {
        dropElsewhere(repo);
        await afterWrite();
        return;
      }
      // Any 2xx is the success; summary and re-read are outside the failure
      // path so neither can report a landed unbind as failed.
      setUnbindNotice(resultSummary("Unbound", result, repo, tenantLabel));
      unbindBusy.current.delete(repo);
      setUnbindStates((prev) => {
        const next = { ...prev };
        delete next[repo];
        return next;
      });
      await afterWrite();
    },
    [afterWrite, tenantLabel, tenantRef, dropElsewhere]
  );

  const boundHere =
    read.state === "loaded"
      ? read.data.bindings.filter((b) => b.caller_side === "bound")
      : [];
  const boundAway =
    read.state === "loaded"
      ? read.data.bindings.filter((b) => b.caller_side === "org")
      : [];
  // An unbind failure with no row to render on is shown at card level instead
  // of being dropped: either the re-read no longer lists the binding (the
  // timeout case, where the unbind landed after all), or the re-read failed
  // too and there are no rows at all — the likely pairing, since a coord or
  // DB outage fails both.
  const listed = new Set(
    read.state === "loaded" ? read.data.bindings.map((b) => b.repo) : []
  );
  const orphanFailures =
    read.state === "loading"
      ? []
      : Object.entries(unbindStates).filter(
          (entry): entry is [string, UnbindState & { error: CardFailure }] =>
            entry[1].error !== null &&
            !entry[1].busy &&
            (read.state !== "loaded" || !listed.has(entry[0]))
        );
  const listUnread = read.state !== "loaded";

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
            {orphanFailures.map(([repo, s]) => {
              const maybe = writeMayHaveLanded(s.error);
              const where = listUnread ? "unread" : "unlisted";
              return (
                <p
                  key={repo}
                  className={
                    maybe
                      ? `rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`
                      : "text-xs text-destructive"
                  }
                  role="alert"
                  data-testid={`repo-binding-unbind-error-${where}-${repo}`}
                  data-ui-bridge-id={`operations.repo-binding-unbind-error-${where}`}
                  data-may-have-landed={maybe ? "true" : "false"}
                >
                  {maybe
                    ? listUnread
                      ? `The unbind of ${repo} failed in a way that does not establish whether it was applied, and the bindings could not be re-read, so whether the change was applied is UNKNOWN: `
                      : `The unbind of ${repo} failed in a way that does not establish whether it was applied, and the re-read no longer lists the binding, so the change may have been applied: `
                    : listUnread
                      ? `The unbind of ${repo} was not applied, so nothing was written by it; the bindings could not be re-read: `
                      : `The unbind of ${repo} was not applied, so nothing was written by it, and the re-read no longer lists the binding: `}
                  <FailureText failure={s.error} />
                </p>
              );
            })}
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
