"use client";

/**
 * /admin/coord/members — Members & Roles admin console.
 *
 * Unlike the rest of /admin/coord/* (which any authenticated tenant member may
 * VIEW, with mutation controls gated per-control via {@link CoordAdminOnly}),
 * this entire page is **admin-only**: it manages tenant membership and role
 * grants. A non-admin sees an "Administrator access required" notice instead of
 * the page body. The backend ALSO enforces admin on every mutating endpoint
 * (403), so this gate is the UX layer keeping the surface honest.
 *
 * Four sections:
 *  a. Your tenant + roles      — GET  /coord/my-tenants
 *  b. Members table            — GET  /coord/members
 *                                POST /coord/members/{operator_id}/roles
 *                                DELETE /coord/members/{operator_id}/roles
 *  c. Invite / pre-provision   — POST /coord/members
 *  d. Group → tenant → role    — GET  /coord/group-tenant-roles
 *                                POST /coord/group-tenant-roles
 *                                DELETE /coord/group-tenant-roles
 *
 * PRODUCT TIER ↔ coord role mapping (tier labels shown in UI, coord roles sent
 * to the API): Administrator ↔ `admin`, Developer ↔ `operator`. (A future
 * "Viewer" tier also maps to `operator` today; we keep the selector to the two
 * primary choices.)
 *
 * ## Console style (Phase 3 Wave 4, commit B) — D2 + D7
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` sequences
 * this route LAST and in its own commit (D7): at 1500 lines it is the largest
 * file in the console, and keeping it independently revertible is worth more
 * than folding it in with the other five Family-C routes.
 *
 * D2 keeps the tables. What the route gains:
 *
 * - **R1** — a `<StatCluster>` above the members table, derived from the rows
 *   already loaded, answering how access is distributed. Unfetched counts
 *   render `–`, never `0` (R6's absence-is-not-zero rule).
 * - **R5** — the members table had NO per-record detail, so the operator id,
 *   the SSO provider and the account age were simply not on the page at all,
 *   and the revoke controls padded every row by however many roles the member
 *   held. A click now expands a full-width `<tr><td colSpan={5}>`
 *   `<RecordDetail>` carrying all of it.
 * - **R3** — `memberStatus.ts` replaces the bag of identical grey role badges
 *   with one audited badge answering *what can this person do?* — which is the
 *   only way the page can render "holds nothing at all" as a shape rather than
 *   as an absence.
 * - **R7** — this page stacked FIVE unconditional sections, four of which are
 *   secondary to the members table an administrator came for. They now sit
 *   BELOW it in `<CollapsiblePanel>`s that keep their signal on the header.
 * - **R9** — the five `<Card><CardHeader><CardTitle>` wrappers are gone.
 *
 * `CognitoGroupItem` already did D2 before this plan reached it — a clickable
 * row expanding a `<td colSpan>`. It keeps its behaviour and moves onto the
 * shared `<RecordDetail>` host so the console has ONE detail presentation.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { useAuth } from "@/contexts/auth-context";
import { OPERATIONS_API, relativeTime } from "@/components/operations/utils";
import {
  CollapsiblePanel,
  RecordDetail,
  StatCluster,
  StatusBadge,
  rowAccentProps,
  type Stat,
} from "@/components/console";
import { deriveMemberStatus, MEMBER_STATUS_PALETTE } from "./memberStatus";

const log = createLogger("CoordMembersPage");

// ---------------------------------------------------------------------------
// Tier ↔ coord role mapping
// ---------------------------------------------------------------------------

/** Coord role string. The wire contract uses bare role names. */
type CoordRole = "admin" | "operator";

interface TierOption {
  /** Coord role sent to the API. */
  role: CoordRole;
  /** Product-tier label shown in the UI. */
  label: string;
}

/** Primary tier choices offered in every role selector. */
const TIER_OPTIONS: TierOption[] = [
  { role: "admin", label: "Administrator" },
  { role: "operator", label: "Developer" },
];

/** Render a coord role as its product-tier label (falls back to the raw role). */
function tierLabel(role: string): string {
  const opt = TIER_OPTIONS.find((t) => t.role === role);
  return opt ? opt.label : role;
}

/**
 * Human-facing name for a tenant entry. coord's `/admin/coord/me` returns the
 * slug as `slug`; we also accept `tenant_slug` in case a future proxy remaps it.
 * UUIDs are the last resort — they are not user-facing.
 */
function tenantName(t: TenantRoleEntry): string {
  return t.slug ?? t.tenant_slug ?? t.tenant_id ?? "—";
}

/**
 * Human-facing name for the home tenant. coord returns only `home_tenant_id`,
 * so resolve the slug by matching it against the tenant list (the home tenant
 * is always one of the operator's tenants).
 */
function homeTenantName(data: MyTenantsResponse): string {
  if (data.home_tenant_slug) return data.home_tenant_slug;
  const match = data.tenants?.find(
    (t) => t.tenant_id != null && t.tenant_id === data.home_tenant_id
  );
  return match ? tenantName(match) : (data.home_tenant_id ?? "—");
}

// ---------------------------------------------------------------------------
// Wire types — mirror the web backend's /coord/* proxy responses.
// ---------------------------------------------------------------------------

interface OperatorRow {
  operator_id: string;
  email: string;
  display_name: string | null;
  sso_provider: string | null;
  last_login_at: string | null;
  created_at: string | null;
  roles: string[];
}

interface MembersResponse {
  operators: OperatorRow[];
}

interface GroupTenantRoleRow {
  group_id: string;
  tenant_slug: string;
  role: string;
  auto_create_tenant: boolean;
  created_at: string | null;
  tenant_id: string | null;
}

interface GroupTenantRolesResponse {
  group_tenant_roles: GroupTenantRoleRow[];
}

interface CognitoGroupRow {
  group_name: string;
  description: string | null;
  creation_date: string | null;
  last_modified_date: string | null;
  precedence: number | null;
}

interface CognitoGroupsResponse {
  groups: CognitoGroupRow[];
}

interface CognitoGroupUserRow {
  username: string;
  email: string | null;
  status: string | null;
  enabled: boolean | null;
}

interface CognitoGroupUsersResponse {
  users: CognitoGroupUserRow[];
}

interface TenantRoleEntry {
  tenant_id?: string;
  /** coord `/admin/coord/me` returns the slug here; `tenant_slug` is a fallback. */
  slug?: string;
  tenant_slug?: string;
  roles?: string[];
}

interface MyTenantsResponse {
  home_tenant_id?: string | null;
  home_tenant_slug?: string | null;
  tenants?: TenantRoleEntry[];
  roles?: string[];
}

// ---------------------------------------------------------------------------
// Payload shape — a successful STATUS is not a successful READ
// ---------------------------------------------------------------------------

/**
 * The list a 200 promised, or a throw.
 *
 * Every read on this page renders `loading` → `error` → `rows.length === 0` →
 * the table. That ordering is right, and it is not the gap. The gap is one
 * layer up: `setRows(json.things ?? [])` turns a body that never carried the
 * list into a **successful, empty** read — `error` stays null, the error arm is
 * skipped, and the page prints its absence copy for a table it never saw. The
 * `?? []` is dead per the wire types (every list field here is declared
 * non-optional) and live at runtime, which is exactly why it survived review.
 *
 * A non-array value is worse than a missing one: `.length` succeeds on a
 * string, so the `=== 0` guard does not fire, the value reaches `.map()`, and
 * the panel throws.
 *
 * The predicate lives here rather than at each call site for the reason
 * `console/readFailure.ts` gives for its own: seven sites each spelling it
 * themselves will drift, and the drift is invisible because every spelling
 * looks right.
 *
 * It stays local for one reason only — no second page needs it yet. NOT
 * because the `console/` barrel is off-limits to wire concerns: that barrel
 * says "nothing here fetches, polls, or knows a route", but it exports
 * `readFailure.ts`, whose `isNotFoundError` parses an HTTP status out of a
 * `GET <url> failed: <status> - <body>` message. So the barrel already holds a
 * predicate about a wire body, and citing "presentation only" as the reason
 * would be a rule this file's own precedent breaks. Promote this the first
 * time a second consumer appears.
 *
 * Throwing is the whole mechanism: each caller already has a `catch` that sets
 * the error state, so refusing the body here routes it to the unknown arm the
 * page already renders. No caller learns a new failure mode.
 */
function requireRows<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`malformed ${what} payload`);
  }
  return value as T[];
}

// ---------------------------------------------------------------------------
// Tenant slug validation (matches the backend / coord constraint).
// ---------------------------------------------------------------------------

const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// Cognito group-name validation (mirrors the backend, next to the input)
// ---------------------------------------------------------------------------
//
// Cognito constrains `groupName` to `[\p{L}\p{M}\p{S}\p{N}\p{P}]+`, which
// excludes whitespace — so `test admins` is rejected. The backend now answers
// that with a 400 naming the reason (web #1099 for create; its follow-up for
// delete / list-members / add-member / remove-member). This is the layer in
// front of that: the operator should never have to make a network round-trip,
// or read an HTTP status, to learn that a space is not allowed.
//
// `\p{…}` escapes need the `u` flag, which is why this regex can say exactly
// what AWS says rather than approximating it.

const COGNITO_GROUP_NAME_RE = /^[\p{L}\p{M}\p{S}\p{N}\p{P}]+$/u;
const COGNITO_GROUP_NAME_MAX = 128;

/**
 * Why `name` cannot be a Cognito group name, as a sentence for a human — or
 * `null` when it can.
 *
 * Deliberately NOT the regex itself. The tenant-slug field one card up prints
 * `Must match ^[a-z0-9][a-z0-9-]{0,63}$`, which is a machine constraint pasted
 * into a human sentence; an operator reading it still has to work out what
 * they typed wrong. Mirrors the backend's `invalid_group_name_reason` in the
 * same order, so the two layers never disagree about which rule bit.
 */
function groupNameProblem(name: string): string | null {
  if (!name) return "A group name is required.";
  if (name.length > COGNITO_GROUP_NAME_MAX) {
    return `Group names are at most ${COGNITO_GROUP_NAME_MAX} characters.`;
  }
  if (COGNITO_GROUP_NAME_RE.test(name)) return null;
  if (/\s/.test(name)) return "Group names can't contain spaces.";
  return "Group names can't contain spaces or control characters.";
}

/**
 * A valid name derived from `name`, or `null` when there is nothing to offer.
 *
 * Offered as a one-click fix rather than printed as advice: the operator's
 * intent (`test admins`) is unambiguous, and retyping it is work the page can
 * simply do.
 */
function suggestGroupName(name: string): string | null {
  const fixed = name
    // Every character Cognito rejects is whitespace or a control character,
    // so one class covers the whole complement.
    .replace(/[\s\p{C}]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COGNITO_GROUP_NAME_MAX);
  if (!fixed || fixed === name || groupNameProblem(fixed) !== null) return null;
  return fixed;
}

/**
 * The inline validation line under a group-name input: the reason, and the
 * one-click fix where one exists.
 *
 * `role="alert"` because the message appears as the operator types — a
 * screen-reader user who has already moved past the field would otherwise
 * never learn the submit button went away.
 *
 * That announcement fires ONCE, though, and only for whoever was listening at
 * the time. So the message also carries `id={testId}` for the input's
 * `aria-describedby`: a screen-reader user who tabs back to the field — or who
 * reaches it for the first time after the value was pasted or filled — hears
 * the reason along with the `aria-invalid` state, instead of "invalid entry"
 * and nothing else. Announcement and association answer different questions
 * and neither substitutes for the other.
 */
function GroupNameHint({
  problem,
  suggestion,
  onAccept,
  testId,
}: {
  problem: string | null;
  suggestion: string | null;
  onAccept: (value: string) => void;
  testId: string;
}) {
  if (!problem) return null;
  return (
    <p
      id={testId}
      className="text-xs text-destructive flex flex-wrap items-center gap-1.5"
      role="alert"
      data-testid={testId}
    >
      <span>{problem}</span>
      {suggestion && (
        <button
          type="button"
          className="underline underline-offset-2 hover:no-underline"
          onClick={() => onAccept(suggestion)}
          data-testid={`${testId}-fix`}
        >
          Use “{suggestion}”
        </button>
      )}
    </p>
  );
}

// ===========================================================================
// Section a — Your tenant + roles
// ===========================================================================

function MyTenantsCard() {
  const [data, setData] = useState<MyTenantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/coord/my-tenants`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MyTenantsResponse | null;
      // This read is cast straight into state with no check at all. A `null`
      // body — legal JSON, and what a proxy returns when it has nothing —
      // leaves `data` null while `loading` and `error` are both false, and the
      // render's trailing `: null` then draws NOTHING. A blank section with no
      // error is the worst outcome on this page: there is not even a wrong
      // claim for an operator to disbelieve.
      if (json === null || typeof json !== "object" || Array.isArray(json)) {
        throw new Error("malformed my-tenants payload");
      }
      // What this guard deliberately does NOT reject is `{}`. Every field on
      // `MyTenantsResponse` is optional and the endpoint is a raw `-> Any`
      // passthrough of coord's `/admin/coord/me` (`operations.py:8570`) with no
      // response model, so there is no key whose absence is decidable here:
      // `{}` is indistinguishable from coord answering "you hold nothing", and
      // an operator who genuinely holds nothing must still see "No roles
      // found." Tightening that needs a declared contract on the coord side,
      // not a guess on this one.
      //
      // `tenants`/`roles` ARE decidable, because present-and-not-a-list is
      // never a valid answer. Both reach `.map()` at the render site, and
      // `data.tenants && data.tenants.length > 0` waves a string straight
      // through. `== null` treats an explicit `null` as absent, which is what
      // the render's own `data.tenants?.` / `?? []` already assume.
      if (json.tenants != null) {
        requireRows<TenantRoleEntry>(json.tenants, "my-tenants `tenants`");
        for (const t of json.tenants) {
          // Per-entry, for the same reason: `(t.roles ?? []).map()` throws on a
          // string, and one bad entry takes the whole card down.
          if (t?.roles != null) {
            requireRows<string>(t.roles, "my-tenants tenant `roles`");
          }
        }
      }
      if (json.roles != null) {
        requireRows<string>(json.roles, "my-tenants `roles`");
      }
      setData(json);
    } catch (err) {
      log.warn("load my-tenants failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    // R7 — secondary material collapses, but its SIGNAL does not: the home
    // tenant's NAME stays on the header while closed, which is the one fact
    // this section carries that an administrator might need at a glance.
    //
    // The section testid rides the WRAPPER, not the content: `CollapsiblePanel`
    // unmounts its children when closed (that is the point of R7), and an
    // authored testid that vanishes with the fold would be a testid this wave
    // removed rather than moved.
    <div data-testid="coord-members-my-tenants">
    <CollapsiblePanel
      title="Your tenant & roles"
      icon={<Building2 className="h-4 w-4" />}
      titleAs="h2"
      defaultOpen={false}
      storageKey="coord-members-my-tenants"
      summary={
        <Badge
          variant="outline"
          // `error !== null`, not the sibling badges' `error ?`, and matching
          // the `StatCluster` predicate above. `setError` stores
          // `err.message`, which is `""` for `new Error()` — falsy, so `error ?`
          // would drop the amber while the text below still read "unknown".
          // One predicate for the tone and the word, so they cannot disagree.
          className={`font-mono text-[11px]${
            error !== null ? " text-amber-600 dark:text-amber-400" : ""
          }`}
          data-testid="coord-members-my-tenants-summary"
        >
          {/* The third `defaultOpen={false}` panel on this page, and the one
              the sibling badges' fix skipped. `summary` renders inside
              `CollapsibleTrigger` (`CollapsiblePanel.tsx:138`), so while this
              panel is folded the error paragraph below is unmounted by Radix
              and this badge is the whole story an operator gets.

              `data ? <Badge/> : undefined` made the badge VANISH on a failed
              read. That is not a wrong count — it is no signal at all, and a
              header indistinguishable from one that is merely still loading.
              The comment above this component promises the opposite: the
              panel folds, its signal does not. Silence is the fabricated
              absence in its quietest form, and the worst of the four shapes,
              because there is nothing for an operator to disbelieve.

              `–` and `unknown` are the two markers the mappings and groups
              badges already use, so all three collapsed headers now answer in
              one vocabulary rather than two.

              The trailing `–` is unreachable — `loading` starts `true` and the
              `finally` only clears it after `data` or `error` is set — but the
              type is `MyTenantsResponse | null`, and spelling the arm is
              cheaper than a non-null assertion. */}
          {loading
            ? "–"
            : error !== null
              ? "unknown"
              : data
                ? homeTenantName(data)
                : "–"}
        </Badge>
      }
      contentClassName="space-y-3"
    >
      <>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        ) : data ? (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Home tenant:</span>
              <span className="font-medium">{homeTenantName(data)}</span>
            </div>
            {data.tenants && data.tenants.length > 0 ? (
              <div className="space-y-1.5">
                {data.tenants.map((t, i) => (
                  <div
                    key={t.tenant_id ?? t.slug ?? t.tenant_slug ?? i}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-medium">{tenantName(t)}</span>
                    <span className="flex flex-wrap gap-1">
                      {(t.roles ?? []).map((r) => (
                        <Badge key={r} variant="secondary">
                          {tierLabel(r)}
                        </Badge>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ) : data.roles && data.roles.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Roles:</span>
                {data.roles.map((r) => (
                  <Badge key={r} variant="secondary">
                    {tierLabel(r)}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No roles found.</p>
            )}
          </div>
        ) : null}
      </>
    </CollapsiblePanel>
    </div>
  );
}

// ===========================================================================
// Section b — Members table
// ===========================================================================

function MembersTable({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Pending role selection per operator (defaults to Administrator).
  const [pendingRole, setPendingRole] = useState<Record<string, CoordRole>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // R5 — one row open at a time, the same model `<RecordList>` holds for a row
  // list, spelled out here because a `<TableBody>` cannot host that primitive.
  const [openMember, setOpenMember] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/coord/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MembersResponse;
      // The third sibling. A malformed 200 here fabricates "No members yet." —
      // and, through `stats` below, the four-count headline `members 0 ·
      // administrators 0 · developers 0 · no access 0`. That is the page's
      // whole answer, invented from a read that did not land.
      const rows = requireRows<OperatorRow>(json?.operators, "members");
      for (const op of rows) {
        // Per ROW as well, and this one hides rather than announcing itself.
        // `deriveMemberStatus` does not throw on a string: `"operator"
        // .includes("admin")` is false and `.length > 0` is true, so the row
        // renders as Developer and `stats` counts it as one. Nothing looks
        // wrong until somebody clicks the row, and `op.roles.map()` in the
        // expansion (`MemberDetail`, below) throws and unmounts the tree.
        //
        // Absent is refused here, unlike the `tenants[].roles` guard above,
        // and the difference is the wire types: `TenantRoleEntry.roles` is
        // declared optional, `OperatorRow.roles` is not. The render agrees —
        // `op.roles.length` is dereferenced unconditionally — so a body
        // without the key already crashed this page. Throwing turns that
        // crash into the error arm the section already has.
        requireRows<string>(op?.roles, "members row `roles`");
      }
      setOperators(rows);
    } catch (err) {
      log.warn("load members failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const grantRole = useCallback(
    async (operatorId: string, role: CoordRole) => {
      setBusy(operatorId);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/members/${encodeURIComponent(
            operatorId
          )}/roles`,
          { method: "POST", body: JSON.stringify({ role }) }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        toast.success(`Granted ${tierLabel(role)}`);
        await load();
        onChanged();
      } catch (err) {
        log.warn("grant role failed", err);
        toast.error(
          `Grant failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged]
  );

  const revokeRole = useCallback(
    async (operatorId: string, role: string) => {
      setBusy(operatorId);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/members/${encodeURIComponent(
            operatorId
          )}/roles`,
          { method: "DELETE", body: JSON.stringify({ role }) }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        toast.success(`Revoked ${tierLabel(role)}`);
        await load();
        onChanged();
      } catch (err) {
        log.warn("revoke role failed", err);
        toast.error(
          `Revoke failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged]
  );

  // R1 — the count cluster, derived from the rows already on the page (never a
  // second fetch). It answers the question an administrator opens this page
  // with, which the old header ("Members") did not: how is access distributed,
  // and is anybody sitting here unable to do anything?
  const stats = useMemo((): Stat[] => {
    let admins = 0;
    let devs = 0;
    let none = 0;
    for (const op of operators) {
      const k = deriveMemberStatus(op.roles).kind;
      if (k === "administrator") admins += 1;
      else if (k === "developer") devs += 1;
      else none += 1;
    }
    // `null` renders as `–`, never `0` (`StatCluster.tsx:95`). Only the
    // in-flight half of that was spelled here, so a FAILED read still
    // published all four counts as confident zeroes — and "no access 0" reads
    // as "nobody is locked out", the single most reassuring answer the page
    // can give, on the strength of a read that never arrived.
    //
    // This is DELIBERATELY stricter than `console/readFailure.ts`, and the
    // difference is worth naming rather than glossing. That module's
    // `readIsUnknown` is `readFailed && !loaded`: once a read has ever landed,
    // it says a later failure belongs to `staleDetail`, not to "unknown", and
    // it calls the count-based spelling wrong because on a POLLED surface one
    // blipped tick flips a genuinely-empty list to "unknown" and back.
    //
    // That reasoning does not reach here. `MembersTable` is not polled — it
    // reloads on mount, on `refreshKey`, and after a grant/revoke — so there
    // is no tick to flicker on. And the error arm already replaces the entire
    // table below with the error paragraph, so dashing the strip makes it
    // AGREE with the table underneath instead of contradicting it. Numbers
    // standing over a hidden table is the state worth avoiding.
    const unknown = loading || error !== null;
    return [
      {
        key: "members",
        label: "members ",
        // Claiming "0 members" before the fetch lands — or after it fails —
        // would be a lie about a page whose whole subject is who exists.
        value: unknown ? null : operators.length,
        "data-testid": "coord-members-count",
      },
      {
        key: "admins",
        label: "administrators ",
        value: unknown ? null : admins,
        "data-testid": "coord-members-count-admins",
      },
      {
        key: "devs",
        label: "developers ",
        value: unknown ? null : devs,
        "data-testid": "coord-members-count-developers",
      },
      {
        key: "no-access",
        label: "no access ",
        // Muted, NOT `attention`: nobody must act now (see `memberStatus.ts`).
        tone: "muted",
        value: unknown ? null : none,
        title:
          "Members holding no role in this tenant. Nothing is broken — they simply cannot reach anything until an administrator grants a tier.",
        "data-testid": "coord-members-count-no-access",
      },
    ];
  }, [operators, loading, error]);

  return (
    // R9 — no page-level Card/CardHeader/CardTitle. "Members" duplicated the
    // console shell's own title bar; the counts that replace it say something
    // the word did not.
    <div className="space-y-3" data-testid="coord-members-table-card">
      <StatCluster stats={stats} data-testid="coord-members-summary" />
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : operators.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table data-testid="coord-members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Grant tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((op) => {
                const sel = pendingRole[op.operator_id] ?? "admin";
                const isBusy = busy === op.operator_id;
                const expanded = openMember === op.operator_id;
                const status = deriveMemberStatus(op.roles);
                const Chevron = expanded ? ChevronDown : ChevronRight;
                return (
                  <Fragment key={op.operator_id}>
                    <TableRow
                      data-testid={`member-row-${op.operator_id}`}
                      data-expanded={expanded ? "true" : "false"}
                      onClick={() =>
                        setOpenMember(expanded ? null : op.operator_id)
                      }
                      {...rowAccentProps(status, "cursor-pointer")}
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Chevron
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          {op.email}
                        </span>
                      </TableCell>
                      <TableCell>{op.display_name ?? "—"}</TableCell>
                      <TableCell>
                        {/* R3 — ONE badge answering "what can this person do?".
                            The per-role revoke chips move into the expansion:
                            they are an ACTION on a grant, not a description of
                            the member, and rendering N of them made the row as
                            tall as the number of grants. */}
                        <StatusBadge
                          status={status}
                          palette={MEMBER_STATUS_PALETTE}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {relativeTime(op.last_login_at)}
                      </TableCell>
                      <TableCell
                        // The grant controls are a Select and a Button; a
                        // click on either must not toggle the row under them.
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <Select
                            value={sel}
                            onValueChange={(v) =>
                              setPendingRole((p) => ({
                                ...p,
                                [op.operator_id]: v as CoordRole,
                              }))
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className="w-[150px]"
                              data-testid={`tier-select-${op.operator_id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIER_OPTIONS.map((t) => (
                                <SelectItem key={t.role} value={t.role}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            disabled={isBusy}
                            onClick={() => grantRole(op.operator_id, sel)}
                            data-testid={`grant-${op.operator_id}`}
                          >
                            Grant
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      // D2 — a full-width cell spanning all five columns.
                      <TableRow
                        data-testid={`member-row-detail-${op.operator_id}`}
                        className="hover:bg-transparent"
                      >
                        <TableCell colSpan={5} className="p-0">
                          <MemberDetail
                            op={op}
                            isBusy={isBusy}
                            onRevoke={revokeRole}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * R5's detail for one member, in the shared host and the fixed slot order.
 *
 * `actions` is where the per-role revoke chips live now. They were on the
 * collapsed row, which conflated two different things — *what this member can
 * do* (a description, one badge) and *take a grant away from them* (an action,
 * one control per grant) — and made a row's height a function of how many
 * roles somebody holds. `raw` carries the operator id and the SSO subject,
 * which is the only place R8 allows them.
 */
function MemberDetail({
  op,
  isBusy,
  onRevoke,
}: {
  op: OperatorRow;
  isBusy: boolean;
  onRevoke: (operatorId: string, role: string) => void;
}) {
  const status = deriveMemberStatus(op.roles);
  return (
    <RecordDetail
      className="rounded-none border-x-0 border-b-0"
      data-testid="member-row-detail"
      why={
        <p className="text-xs text-muted-foreground">
          {/* §4.2 clause 4 — a calm kind that is nonetheless owed something
              says so HERE, in words, never by borrowing amber. */}
          {status.reason ??
            `${op.display_name ?? op.email} holds ${op.roles.length} role${op.roles.length === 1 ? "" : "s"} in this tenant.`}
        </p>
      }
      actions={
        op.roles.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Revoke a grant:</p>
            <div className="flex flex-wrap gap-1">
              {op.roles.map((r) => (
                <Badge key={r} variant="secondary" className="gap-1 pr-0.5">
                  {tierLabel(r)}
                  <DestructiveButton
                    size="icon"
                    aria-label={`Revoke ${tierLabel(r)}`}
                    title={`Revoke ${tierLabel(r)}`}
                    disabled={isBusy}
                    onClick={() => onRevoke(op.operator_id, r)}
                    className="ml-0.5 size-4 rounded-sm bg-transparent text-muted-foreground shadow-none hover:bg-destructive hover:text-white"
                    data-testid={`revoke-${op.operator_id}-${r}`}
                  >
                    <X className="h-3 w-3" />
                  </DestructiveButton>
                </Badge>
              ))}
            </div>
          </div>
        ) : undefined
      }
      history={
        <p className="text-[11px] text-muted-foreground">
          Account created {relativeTime(op.created_at)} · last login{" "}
          {relativeTime(op.last_login_at)}
        </p>
      }
      raw={
        <div className="break-all font-mono text-[10px] text-muted-foreground/60">
          operator_id: {op.operator_id} · roles: [{op.roles.join(", ")}]
          {op.sso_provider ? ` · sso: ${op.sso_provider}` : ""}
        </div>
      }
    />
  );
}

// ===========================================================================
// Section c — Invite / pre-provision
// ===========================================================================

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ssoSubject, setSsoSubject] = useState("");
  const [ssoProvider, setSsoProvider] = useState("cognito");
  const [role, setRole] = useState<CoordRole>("admin");
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    if (!email.trim() || !ssoSubject.trim()) {
      toast.error("Email and Cognito subject are required.");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        sso_subject: ssoSubject.trim(),
        sso_provider: ssoProvider.trim() || "cognito",
        roles: [role],
      };
      if (displayName.trim()) body.display_name = displayName.trim();
      const res = await httpClient.fetch(`${OPERATIONS_API}/coord/members`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} ${text}`.trim());
      }
      toast.success(`Invited ${email.trim()}`);
      setEmail("");
      setDisplayName("");
      setSsoSubject("");
      setSsoProvider("cognito");
      setRole("admin");
      onInvited();
    } catch (err) {
      log.warn("invite failed", err);
      toast.error(
        `Invite failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSubmitting(false);
    }
  }, [email, displayName, ssoSubject, ssoProvider, role, onInvited]);

  return (
    // R7 — a WRITE form is the clearest case of secondary material: it
    // is never what an administrator is reading, only what they came to
    // do occasionally, and it cost ~330px above the group/Cognito
    // sections on every visit. Testid on the wrapper — see MyTenantsCard.
    <div data-testid="coord-members-invite">
    <CollapsiblePanel
      title="Invite / pre-provision a member"
      icon={<UserPlus className="h-4 w-4" />}
      titleAs="h2"
      defaultOpen={false}
      storageKey="coord-members-invite"
      contentClassName="space-y-4"
    >
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              data-testid="invite-email"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-display-name">Display name (optional)</Label>
            <Input
              id="invite-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
              data-testid="invite-display-name"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-sso-subject">Cognito subject (sub)</Label>
            <Input
              id="invite-sso-subject"
              value={ssoSubject}
              onChange={(e) => setSsoSubject(e.target.value)}
              placeholder="e.g. 9f2c…-uuid"
              data-testid="invite-sso-subject"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-sso-provider">SSO provider</Label>
            <Input
              id="invite-sso-provider"
              value={ssoProvider}
              onChange={(e) => setSsoProvider(e.target.value)}
              placeholder="cognito"
              data-testid="invite-sso-provider"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-tier">Initial tier</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as CoordRole)}
            >
              <SelectTrigger
                id="invite-tier"
                className="w-full"
                data-testid="invite-tier"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t.role} value={t.role}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The user must sign up in Cognito first — the{" "}
          <span className="font-medium">Cognito subject</span> is their Cognito{" "}
          <code className="text-[0.7rem]">sub</code> claim. Pre-provisioning here
          binds that subject to a tenant member + initial role so they have
          access the moment they sign in.
        </p>
        <div className="flex justify-end">
          <Button
            onClick={submit}
            disabled={submitting}
            data-testid="invite-submit"
          >
            <UserPlus className="h-4 w-4" />
            Invite
          </Button>
        </div>
      </>
    </CollapsiblePanel>
    </div>
  );
}

// ===========================================================================
// Section d — Group → tenant → role mappings
// ===========================================================================

function GroupTenantRolesSection({ isSuperuser }: { isSuperuser: boolean }) {
  const [rows, setRows] = useState<GroupTenantRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Add-mapping form state.
  const [groupId, setGroupId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [role, setRole] = useState<CoordRole>("operator");
  const [autoCreate, setAutoCreate] = useState(true);
  // Create the Cognito group as part of the same action (superuser-only — pool
  // -wide group creation requires staff access). Folds the previously-separate
  // "create group" then "add mapping" steps into one, so a mapping can never be
  // added for a group that doesn't exist.
  const [alsoCreateGroup, setAlsoCreateGroup] = useState(isSuperuser);
  const [submitting, setSubmitting] = useState(false);

  const slugValid = tenantSlug === "" || TENANT_SLUG_RE.test(tenantSlug);
  // Validated against the TRIMMED value because that is what `addMapping`
  // submits — validating the raw text would flag a trailing space the request
  // never carries.
  const groupIdProblem =
    groupId.trim() === "" ? null : groupNameProblem(groupId.trim());
  const groupIdSuggestion = groupIdProblem
    ? suggestGroupName(groupId.trim())
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/group-tenant-roles`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GroupTenantRolesResponse;
      // A successful STATUS is not a successful READ — the same rule the
      // blast-radius read of this SAME endpoint applies below. `?? []` is dead
      // per the types (`group_tenant_roles` is declared non-optional) and live
      // at runtime, and what it fabricates is "No mappings yet." from a body
      // that never carried the table. It also stops a non-array body reaching
      // `rows.map()` at the render site, where `.length` succeeds on a string
      // and `.map` then throws, taking the panel down.
      setRows(
        requireRows<GroupTenantRoleRow>(
          json?.group_tenant_roles,
          "group-tenant-roles"
        )
      );
    } catch (err) {
      log.warn("load group-tenant-roles failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addMapping = useCallback(async () => {
    if (!groupId.trim() || !tenantSlug.trim()) {
      toast.error("Group ID and tenant slug are required.");
      return;
    }
    if (!TENANT_SLUG_RE.test(tenantSlug.trim())) {
      toast.error("Tenant slug must match ^[a-z0-9][a-z0-9-]{0,63}$.");
      return;
    }
    const gid = groupId.trim();
    // The Group ID becomes a Cognito group name whenever "Also create" is on,
    // and coord's mapping is keyed on it either way — so a name Cognito can
    // never hold is wrong on both halves, whichever half runs.
    const namingProblem = groupNameProblem(gid);
    if (namingProblem) {
      toast.error(namingProblem);
      return;
    }
    setSubmitting(true);
    try {
      const slug = tenantSlug.trim();
      // Step 1 (optional, superuser-only): ensure the Cognito group exists, so
      // the mapping is never orphaned. A pre-existing group (409) is fine.
      let groupCreated = false;
      let groupReused = false;
      if (alsoCreateGroup && isSuperuser) {
        const gres = await httpClient.fetch(
          `${OPERATIONS_API}/coord/cognito/groups`,
          {
            method: "POST",
            body: JSON.stringify({
              group_name: gid,
              description: `${tierLabel(role)} for ${slug}`,
            }),
          }
        );
        if (gres.status === 409) {
          // Reusing an existing group is correct — SAYING so is the fix. This
          // arm used to be silent, and the success toast then read "Mapping
          // added", so the operator could not tell a group that was created
          // from one that was quietly reused.
          groupReused = true;
        } else if (!gres.ok) {
          // ONE prefix, not two. `backendErrorMessage` returns the backend's
          // own sentence — and since #1099's follow-up a malformed name is a
          // 400 that names the real reason — while the `catch` below adds
          // "Add failed:". Nesting `HTTP 400 {"detail":…}` in between made the
          // reason the least readable part of the line.
          throw new Error(await backendErrorMessage(gres));
        } else {
          groupCreated = true;
        }
      }
      // Step 2: the group → tenant → role mapping.
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/group-tenant-roles`,
        {
          method: "POST",
          body: JSON.stringify({
            group_id: gid,
            tenant_slug: slug,
            role,
            auto_create_tenant: autoCreate,
          }),
        }
      );
      if (!res.ok) {
        const reason = await backendErrorMessage(res);
        // A partial failure LEAVES A POOL-WIDE GROUP BEHIND. Reporting only
        // the mapping failure hides an orphan that a non-superuser cannot even
        // see, let alone clean up — so the message has to name it.
        throw new Error(
          groupCreated
            ? `${reason} — the Cognito group "${gid}" WAS created and is now unmapped. Delete it in the Cognito Groups section below if you are not about to retry.`
            : reason
        );
      }
      toast.success(
        groupCreated
          ? `Group "${gid}" created + mapping added`
          : groupReused
            ? `Group "${gid}" already existed; mapping added`
            : "Mapping added"
      );
      setGroupId("");
      setTenantSlug("");
      setRole("operator");
      setAutoCreate(true);
      setAlsoCreateGroup(isSuperuser);
      await load();
    } catch (err) {
      log.warn("add mapping failed", err);
      toast.error(
        `Add failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    groupId,
    tenantSlug,
    role,
    autoCreate,
    alsoCreateGroup,
    isSuperuser,
    load,
  ]);

  const deleteMapping = useCallback(
    async (row: GroupTenantRoleRow) => {
      const key = `${row.group_id}:${row.tenant_slug}:${row.role}`;
      setBusy(key);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/group-tenant-roles`,
          {
            method: "DELETE",
            body: JSON.stringify({
              group_id: row.group_id,
              tenant_slug: row.tenant_slug,
              role: row.role,
            }),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        toast.success("Mapping deleted");
        await load();
      } catch (err) {
        log.warn("delete mapping failed", err);
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  return (
    // R7 — infrastructural SSO wiring, below the members table and behind a
    // click. The mapping COUNT stays on the header while closed: an empty
    // mapping set is the thing a reader might need to notice without opening.
    <div data-testid="coord-members-group-roles">
    <CollapsiblePanel
      title="Group → tenant → role mappings"
      icon={<ShieldCheck className="h-4 w-4" />}
      titleAs="h2"
      defaultOpen={false}
      storageKey="coord-members-group-roles"
      summary={(
        <Badge
          variant="outline"
          className={`font-mono text-[11px]${
            error ? " text-amber-600 dark:text-amber-400" : ""
          }`}
          data-testid="coord-group-roles-summary"
        >
          <span className="font-normal text-muted-foreground">mappings&nbsp;</span>
          {/* `rows.length` is 0 both when the read said "none" and when it
              FAILED, and this panel is `defaultOpen={false}` — so the error
              text below is hidden and this badge is the whole story an
              operator gets. Printing `0` there states the most reassuring
              possible answer on the strength of a read that did not land. The
              comment above says the count is here precisely so an empty set
              can be noticed WITHOUT opening; that is exactly what makes the
              false `0` worth closing. */}
          {loading ? "–" : error ? "unknown" : rows.length}
        </Badge>
      )}
      contentClassName="space-y-4"
    >
      <>
        <p className="text-xs text-muted-foreground">
          Binds a Cognito group to a tenant + role.{" "}
          {isSuperuser
            ? "With “Also create Cognito group” checked, the group is created in the same step — then add members in the Cognito Groups section below."
            : "Create the group in the Cognito Groups section (or AWS console) first; group creation requires staff access."}
        </p>

        {/* Existing mappings */}
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No mappings yet.</p>
        ) : (
          <Table data-testid="coord-group-roles-table">
            <TableHeader>
              <TableRow>
                <TableHead>Group ID</TableHead>
                <TableHead>Tenant slug</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Auto-create</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const key = `${row.group_id}:${row.tenant_slug}:${row.role}`;
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{row.group_id}</TableCell>
                    <TableCell>{row.tenant_slug}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tierLabel(row.role)}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.auto_create_tenant ? (
                        <Badge variant="success">yes</Badge>
                      ) : (
                        <Badge variant="outline">no</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DestructiveButton
                        size="sm"
                        disabled={busy === key}
                        onClick={() => deleteMapping(row)}
                        data-testid={`delete-mapping-${key}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DestructiveButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Add-mapping form */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-medium">Add mapping</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="map-group-id">Group ID</Label>
              <Input
                id="map-group-id"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="e.g. qontinui-admins"
                aria-invalid={groupIdProblem !== null}
                // Only while the hint is rendered — `aria-describedby` naming
                // an absent id describes the field with nothing.
                aria-describedby={
                  groupIdProblem !== null ? "map-group-id-problem" : undefined
                }
                data-testid="map-group-id"
              />
              <GroupNameHint
                problem={groupIdProblem}
                suggestion={groupIdSuggestion}
                onAccept={setGroupId}
                testId="map-group-id-problem"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="map-tenant-slug">Tenant slug</Label>
              <Input
                id="map-tenant-slug"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="e.g. acme-corp"
                aria-invalid={!slugValid}
                data-testid="map-tenant-slug"
              />
              {!slugValid && (
                <p className="text-xs text-destructive">
                  Must match ^[a-z0-9][a-z0-9-]{"{"}0,63{"}"}$
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="map-role">Role tier</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as CoordRole)}
              >
                <SelectTrigger
                  id="map-role"
                  className="w-full"
                  data-testid="map-role"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((t) => (
                    <SelectItem key={t.role} value={t.role}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={autoCreate}
                  onCheckedChange={(c) => setAutoCreate(c === true)}
                  data-testid="map-auto-create"
                />
                Auto-create tenant
              </label>
            </div>
            {isSuperuser && (
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={alsoCreateGroup}
                    onCheckedChange={(c) => setAlsoCreateGroup(c === true)}
                    data-testid="map-also-create-group"
                  />
                  Also create Cognito group
                </label>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={addMapping}
              disabled={submitting || !slugValid || groupIdProblem !== null}
              data-testid="map-submit"
            >
              <Plus className="h-4 w-4" />
              Add mapping
            </Button>
          </div>
        </div>
      </>
    </CollapsiblePanel>
    </div>
  );
}

// ===========================================================================
// Section e — Cognito Groups (superuser-only)
// ===========================================================================

/**
 * Expandable members list for a single Cognito group.
 *
 * Lazily fetches `GET /coord/cognito/groups/{name}/users` when first opened and
 * supports removing a user by email via `DELETE .../users {email}`.
 */
function CognitoGroupMembers({
  groupName,
  onChanged,
}: {
  groupName: string;
  /** Tell the section its member counts are stale (a removal happened). */
  onChanged?: () => void;
}) {
  const [users, setUsers] = useState<CognitoGroupUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
          groupName
        )}/users`
      );
      // This route answers 400 naming the reason for a `group_name` Cognito
      // could never hold, so a bare `HTTP ${res.status}` throws that sentence
      // away and renders the section error as literally "HTTP 400" — the
      // status the backend stopped relying on precisely because it says
      // nothing. `backendErrorMessage` is what the mutations on this page
      // already use.
      if (!res.ok) throw new Error(await backendErrorMessage(res));
      const json = (await res.json()) as CognitoGroupUsersResponse;
      // "No users in this group yet." is an assertion about a group an operator
      // is deciding whether to empty or delete. It must come from a read that
      // landed, not from a 200 that forgot the list.
      setUsers(requireRows<CognitoGroupUserRow>(json?.users, "cognito group users"));
    } catch (err) {
      log.warn("load cognito group users failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [groupName]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeUser = useCallback(
    async (email: string) => {
      setBusy(email);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
            groupName
          )}/users`,
          { method: "DELETE", body: JSON.stringify({ email }) }
        );
        // ONE prefix, not two — the `catch` below adds "Remove failed:". This
        // route already answered 404 (no such user) and 409 (ambiguous email)
        // with a real sentence, and now answers 400 for an email or group name
        // Cognito rejects as malformed; nesting `HTTP 404 {"detail":…}` in
        // between made the reason the least readable part of the toast. The
        // add-member handler on the sibling component reads its errors this
        // way already — this was the last Cognito membership call that did not.
        if (!res.ok) {
          throw new Error(await backendErrorMessage(res));
        }
        toast.success(`Removed ${email} from ${groupName}`);
        await load();
        onChanged?.();
      } catch (err) {
        log.warn("remove cognito group user failed", err);
        toast.error(
          `Remove failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [groupName, load, onChanged]
  );

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive flex items-center gap-1.5 py-2">
        <AlertTriangle className="h-4 w-4" /> {error}
      </p>
    );
  }

  if (users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No users in this group yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 py-2" data-testid={`cognito-users-${groupName}`}>
      {users.map((u) => {
        const label = u.email ?? u.username;
        return (
          <div
            key={u.username}
            className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-medium truncate">{label}</span>
              {u.status ? (
                <Badge variant="outline" className="text-[0.7rem]">
                  {u.status}
                </Badge>
              ) : null}
              {u.enabled === false ? (
                <Badge variant="secondary" className="text-[0.7rem]">
                  disabled
                </Badge>
              ) : null}
            </div>
            {u.email ? (
              <DestructiveButton
                size="icon"
                aria-label={`Remove ${label} from ${groupName}`}
                title={`Remove ${label} from ${groupName}`}
                disabled={busy === u.email}
                onClick={() => removeUser(u.email as string)}
                className="size-6 shrink-0"
                data-testid={`cognito-remove-user-${groupName}-${u.username}`}
              >
                <X className="h-3.5 w-3.5" />
              </DestructiveButton>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Suffix coord treats as a home-tenant pin (`auth_sso::HOME_GROUP_SUFFIX`). */
const HOME_GROUP_SUFFIX = "-home";

/**
 * The human sentence out of a backend error response.
 *
 * The group-delete guards answer 409 with a STRUCTURED detail
 * (`{error, tenants, message}`) so the caller can branch on `error`, while
 * every other route on this page answers with a plain-string detail. Rendering
 * `[object Object]` at the one place an operator most needs to read the reason
 * is exactly the failure this helper exists to prevent.
 *
 * Three sources, in order: a string `detail`, a structured `detail.message`,
 * then the status. A JSON body carrying neither falls back to the STATUS, not
 * to its own source text — `{}` printed as `{}` is the same non-message as
 * `[object Object]`. A body that is not JSON at all is different: a plain-text
 * gateway or proxy error IS the sentence, so that one is returned as-is.
 */
async function backendErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    const detail = parsed?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (detail && typeof detail === "object") {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
    // Parsed as JSON and carries no sentence — `{}`, or a `detail` in a shape
    // this does not know. The raw JSON is NOT a message: printing it puts `{}`
    // or a brace-blob where the operator expects a reason, which is the same
    // defect as `[object Object]` one shape along. The status is at least true,
    // and it is what these call sites showed before they were routed here.
    return `HTTP ${res.status}`;
  } catch {
    // Not JSON — a plain-text gateway or proxy body IS the message, so fall
    // through to the raw body rather than discarding it for the status.
  }
  return text.trim() || `HTTP ${res.status}`;
}

/**
 * A single Cognito group row: name / description / created columns, an
 * expand toggle that reveals members, an inline "add user by email" form, and a
 * delete-group action.
 *
 * The delete is the dangerous one, so two things are true of this row that were
 * not before plan
 * `2026-08-27-members-page-delete-paths-authorization-and-blast-radius`
 * Phase 2:
 *
 *  - **Blast radius is on the COLLAPSED row.** The member list only mounts
 *    inside `{expanded && …}`, so a collapsed row used to show name,
 *    description and a creation time — zero information about what the Delete
 *    button beside it would affect. Member count and coord's tenant mappings
 *    are now rendered next to the name, at the moment of decision.
 *  - **Delete goes through {@link ConfirmDestructiveDialog}** and requires
 *    typing the group name. `DestructiveButton` alone only blocks synthetic
 *    clicks; it never asked a human anything.
 */
function CognitoGroupItem({
  group,
  mappings,
  mappingsError,
  memberCount,
  membersError,
  onDeleted,
  onMembersChanged,
}: {
  group: CognitoGroupRow;
  /**
   * coord `group_tenant_roles` rows whose `group_id` is this group; `null`
   * while the section's read is still in flight (or has not run), so an
   * un-arrived answer is never mistaken for an empty one.
   */
  mappings: GroupTenantRoleRow[] | null;
  /**
   * Set when the `group-tenant-roles` read FAILED — unknown, NOT "no
   * mappings". The same distinction `membersError` draws, for the other half
   * of the blast radius.
   */
  mappingsError: boolean;
  /** Members in this group; `null` while loading, `undefined` if unknown. */
  memberCount: number | null | undefined;
  /** Set when the member-count probe failed — unknown, NOT zero. */
  membersError: boolean;
  onDeleted: () => void;
  /** Refresh the section's counts after an add/remove in this group. */
  onMembersChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [allowHomeGroup, setAllowHomeGroup] = useState(false);
  // Bump to force the members sub-list to refetch after an add.
  const [membersKey, setMembersKey] = useState(0);

  const isHomeGroup = group.group_name.endsWith(HOME_GROUP_SUFFIX);
  const homeTenantSlug = isHomeGroup
    ? group.group_name.slice(0, -HOME_GROUP_SUFFIX.length)
    : null;

  const addUser = useCallback(async () => {
    const email = addEmail.trim();
    if (!email) {
      toast.error("Enter an email to add.");
      return;
    }
    setAdding(true);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
          group.group_name
        )}/users`,
        { method: "POST", body: JSON.stringify({ email }) }
      );
      if (res.status === 404) {
        toast.error("No Cognito user with that email; they must sign up first.");
        return;
      }
      if (res.status === 409) {
        toast.error(
          "Ambiguous email — more than one Cognito user matches. Resolve in Cognito first."
        );
        return;
      }
      if (!res.ok) {
        throw new Error(await backendErrorMessage(res));
      }
      toast.success(`Added ${email} to ${group.group_name}`);
      setAddEmail("");
      setExpanded(true);
      setMembersKey((k) => k + 1);
      onMembersChanged();
    } catch (err) {
      log.warn("add cognito group user failed", err);
      toast.error(
        `Add failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setAdding(false);
    }
  }, [addEmail, group.group_name, onMembersChanged]);

  const deleteGroup = useCallback(async () => {
    setDeleting(true);
    try {
      // `allow_home_group` is the ONE override the dashboard offers. There is
      // deliberately no `allow_mapped` control: when coord maps the group the
      // backend 409s and the fix is to remove the mapping first — that
      // ordering is the guard's whole purpose, and a checkbox would erase it.
      const query = allowHomeGroup ? "?allow_home_group=true" : "";
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
          group.group_name
        )}${query}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        throw new Error(await backendErrorMessage(res));
      }
      toast.success(`Deleted group ${group.group_name}`);
      setConfirmOpen(false);
      onDeleted();
    } catch (err) {
      log.warn("delete cognito group failed", err);
      toast.error(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        { duration: 12_000 }
      );
      setDeleting(false);
    }
  }, [group.group_name, allowHomeGroup, onDeleted]);

  const memberLabel = membersError
    ? "members unknown"
    : memberCount == null
      ? "counting members…"
      : `${memberCount} member${memberCount === 1 ? "" : "s"}`;

  return (
    <>
      <TableRow data-testid={`cognito-group-row-${group.group_name}`}>
        <TableCell className="font-medium align-top">
          <button
            type="button"
            className="flex items-center gap-1.5 hover:underline"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            data-testid={`cognito-group-toggle-${group.group_name}`}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            {group.group_name}
          </button>
          {/* Blast radius — visible WITHOUT expanding the row, because the
              Delete button beside it is visible without expanding too. */}
          <div
            className="mt-1 flex flex-wrap items-center gap-1 pl-[1.375rem]"
            data-testid={`cognito-group-blast-${group.group_name}`}
          >
            <Badge
              variant={membersError ? "outline" : "secondary"}
              // Amber on the unknown arm, matching the `tenant mappings
              // unknown` badge rendered immediately to its right and the two
              // collapsed panel headers. Both halves of this blast radius fail
              // the same way and are read in one glance, so they must not
              // announce it in two different tones: `members unknown` in the
              // default foreground beside an amber `tenant mappings unknown`
              // reads as one caveat and one fact.
              className={`text-[0.7rem] font-normal${
                membersError ? " text-amber-600 dark:text-amber-400" : ""
              }`}
              data-testid={`cognito-group-members-count-${group.group_name}`}
            >
              <Users className="h-3 w-3" />
              {memberLabel}
            </Badge>
            {mappingsError ? (
              // A FAILED read is not an empty one. Rendering "no tenant
              // mappings" here would turn a suppressed error into the single
              // most reassuring thing this row can say, right beside Delete.
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-amber-600 dark:text-amber-400"
                data-testid={`cognito-group-mappings-unknown-${group.group_name}`}
              >
                <Building2 className="h-3 w-3" />
                tenant mappings unknown
              </Badge>
            ) : mappings === null ? (
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-muted-foreground"
                data-testid={`cognito-group-mappings-loading-${group.group_name}`}
              >
                <Building2 className="h-3 w-3" />
                reading tenant mappings…
              </Badge>
            ) : mappings.length === 0 ? (
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-muted-foreground"
                data-testid={`cognito-group-unmapped-${group.group_name}`}
              >
                no tenant mappings
              </Badge>
            ) : (
              mappings.map((m) => (
                <Badge
                  key={`${m.tenant_slug}:${m.role}`}
                  variant="outline"
                  className="text-[0.7rem] font-normal"
                  data-testid={`cognito-group-mapping-${group.group_name}-${m.tenant_slug}-${m.role}`}
                >
                  <Building2 className="h-3 w-3" />
                  {m.tenant_slug} · {tierLabel(m.role)}
                </Badge>
              ))
            )}
            {isHomeGroup ? (
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-amber-600 dark:text-amber-400"
                data-testid={`cognito-group-home-pin-${group.group_name}`}
              >
                <ShieldCheck className="h-3 w-3" />
                pins home → {homeTenantSlug}
              </Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground align-top">
          {group.description || "—"}
        </TableCell>
        <TableCell className="text-muted-foreground text-xs whitespace-nowrap align-top">
          {relativeTime(group.creation_date)}
        </TableCell>
        <TableCell className="text-right align-top">
          <DestructiveButton
            size="sm"
            disabled={deleting}
            onClick={() => {
              setAllowHomeGroup(false);
              setConfirmOpen(true);
            }}
            data-testid={`cognito-delete-group-${group.group_name}`}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DestructiveButton>
        </TableCell>
      </TableRow>

      <ConfirmDestructiveDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) setAllowHomeGroup(false);
          setConfirmOpen(o);
        }}
        title={`Delete the Cognito group ${group.group_name}?`}
        description={
          <>
            This deletes the group from the <strong>shared</strong> Cognito
            pool. Cognito has no undo — re-creating the group does not restore
            its members, and every tenant keyed off this pool is affected.
            Members do not lose the roles it grants right away: each person&apos;s
            token stops carrying the group at their <strong>next login</strong>,
            so the effect arrives one person at a time, whenever they next sign
            in.
          </>
        }
        confirmLabel="Delete group"
        confirmPhrase={group.group_name}
        busy={deleting}
        // The `-home` acknowledgement is a HARD gate in the UI, not a hint:
        // the backend refuses without `allow_home_group`, and shipping a
        // confirm that is guaranteed to 409 would teach operators to click
        // through the dialog and read the toast instead.
        confirmDisabled={isHomeGroup && !allowHomeGroup}
        onConfirm={() => void deleteGroup()}
        extra={
          isHomeGroup ? (
            <label
              className="flex items-start gap-2 text-sm"
              htmlFor={`cognito-allow-home-${group.group_name}`}
            >
              <Checkbox
                id={`cognito-allow-home-${group.group_name}`}
                checked={allowHomeGroup}
                onCheckedChange={(v) => setAllowHomeGroup(v === true)}
                data-testid={`cognito-allow-home-${group.group_name}`}
              />
              <span>
                I understand this un-pins the home tenant for everyone in{" "}
                <span className="font-mono">{group.group_name}</span>.
              </span>
            </label>
          ) : null
        }
        testId={`cognito-delete-confirm-${group.group_name}`}
      >
        <p className="font-medium">What this affects</p>
        <ul className="list-disc pl-5 space-y-1">
          <li data-testid={`cognito-delete-confirm-members-${group.group_name}`}>
            {membersError
              ? "Member count could not be read — treat it as unknown, not zero."
              : memberCount == null
                ? "Counting members…"
                : `${memberCount} member${
                    memberCount === 1 ? "" : "s"
                  } lose this group at their next login.`}
          </li>
          {mappingsError ? (
            // The bullet that would otherwise say "nothing references this
            // group" is the one an operator reads as permission to proceed.
            // When the read failed we do not know that, so we say so — and we
            // name the guard that DOES know, so "unknown" does not read as
            // "unguarded". The confirm stays enabled deliberately: the backend
            // re-runs this check server-side and answers 502
            // `mapping_check_unavailable` if IT cannot read the table either,
            // so blocking here would only convert a recoverable delete into a
            // dead end while implying the dashboard is the guard.
            <li
              className="text-amber-700 dark:text-amber-400"
              data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
            >
              coord&apos;s tenant mappings could not be read — treat this as
              unknown, not as &ldquo;none&rdquo;. The delete is still checked
              server-side and will be refused if any mapping exists.
            </li>
          ) : mappings === null ? (
            <li
              data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
            >
              Reading coord&apos;s tenant mappings…
            </li>
          ) : mappings.length === 0 ? (
            <li
              data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
            >
              No coord tenant mappings reference this group.
            </li>
          ) : (
            // The SAME testid rides every arm, this one included, so a query
            // for it is total over the state space. Leaving it off here would
            // make `queryByTestId(...) === null` mean "there ARE mappings" —
            // the opposite of what a reader assumes, and a way for a future
            // `toBeNull()` assertion to pass vacuously on the mapped path.
            //
            // NOTE for tests: this arm is the ONLY one that can render the id
            // more than once (one `<li>` per mapping), and `getByTestId`
            // THROWS on multiple matches. A test that reaches the mapped path
            // with more than one mapping must use `getAllByTestId`. The other
            // three arms are always single, which is why the singular query is
            // safe there.
            mappings.map((m) => (
              <li
                key={`${m.tenant_slug}:${m.role}`}
                data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
              >
                Grants <strong>{tierLabel(m.role)}</strong> in{" "}
                <span className="font-mono">{m.tenant_slug}</span> — the backend
                will refuse this delete until that mapping is removed above.
              </li>
            ))
          )}
          {isHomeGroup ? (
            <li>
              Pins its members&apos; home tenant to{" "}
              <span className="font-mono">{homeTenantSlug}</span>. Their home
              re-resolves at their next login.
            </li>
          ) : null}
        </ul>
      </ConfirmDestructiveDialog>

      {expanded && (
        // D2 — this row ALREADY expanded a full-width `colSpan` cell before
        // this plan reached it. What changes is only the host: the ad-hoc
        // `bg-muted/30` div becomes the shared `<RecordDetail>`, so a click on
        // a record looks the same here as on every other console page.
        <TableRow data-testid={`cognito-group-detail-${group.group_name}`}>
          <TableCell colSpan={4} className="p-0">
            <RecordDetail
              className="rounded-none border-x-0 border-b-0"
              why={
                <CognitoGroupMembers
                  key={membersKey}
                  groupName={group.group_name}
                  onChanged={onMembersChanged}
                />
              }
              actions={
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <Label htmlFor={`cognito-add-${group.group_name}`}>
                    Add user by email
                  </Label>
                  <Input
                    id={`cognito-add-${group.group_name}`}
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="person@example.com"
                    data-testid={`cognito-add-email-${group.group_name}`}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={addUser}
                  disabled={adding}
                  data-testid={`cognito-add-submit-${group.group_name}`}
                >
                  <UserPlus className="h-4 w-4" />
                  Add
                </Button>
              </div>
              }
              raw={
                <div className="break-all font-mono text-[10px] text-muted-foreground/60">
                  group: {group.group_name}
                  {group.precedence != null
                    ? ` · precedence: ${group.precedence}`
                    : ""}
                </div>
              }
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Calls `onMount` once, the first time it renders. Renders nothing.
 *
 * `CollapsiblePanel` UNMOUNTS its children while closed (Radix
 * `CollapsibleContent`, no `forceMount`), so a child's mount IS the "the
 * operator opened this panel" event. The panel owns its open state and
 * exposes no callback, and reaching for one would mean forking a shared
 * console primitive to serve one caller.
 */
function MountedOnce({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}

/**
 * Pool-wide Cognito group management. Superuser-only — pool-wide Cognito ops
 * require staff/superuser access. A coord admin who is NOT a superuser sees a
 * muted note instead of the controls.
 */
function CognitoGroupsSection({ isSuperuser }: { isSuperuser: boolean }) {
  const [groups, setGroups] = useState<CognitoGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Blast-radius inputs for the group ROWS. Section-level, not per-row,
  // because the row that needs them is the one that has NOT been expanded —
  // a per-row lazy fetch would arrive only after the operator had already
  // expanded, which is after the decision the numbers exist to inform.
  // `null` until the read lands: an initial `[]` would render as the positive
  // claim "no tenant mappings" for every group during the first paint, which
  // is the same fabrication a failed read makes, just shorter-lived.
  const [mappings, setMappings] = useState<GroupTenantRoleRow[] | null>(null);
  // Set when the `group-tenant-roles` read FAILED. Kept apart from `mappings`
  // for the same reason `memberErrors` is kept apart from `memberCounts` — a
  // failed read must render as "unknown", never as "none".
  const [mappingsError, setMappingsError] = useState(false);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  // Groups whose member probe FAILED. Kept apart from `memberCounts` so a
  // failed read renders as "unknown" rather than as a confident zero.
  const [memberErrors, setMemberErrors] = useState<Record<string, true>>({});
  const [countsToken, setCountsToken] = useState(0);
  // Wave 4 folded this section (`CollapsiblePanel defaultOpen={false}`) as
  // "the least-often-read section on the page". The group LIST still loads
  // eagerly, because the folded header badge counts it — but the blast-radius
  // reads are one coord query plus one AWS `list_users_in_group` PER GROUP,
  // and spending those on a panel nobody opened is pure waste. They wait for
  // the first open, which is also the first moment their output can be seen.
  const [panelOpened, setPanelOpened] = useState(false);
  const markPanelOpened = useCallback(() => setPanelOpened(true), []);

  // Create-group form state.
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  // Validated against the TRIMMED value because that is what `createGroup`
  // submits; an empty field shows nothing (the submit handler says "required").
  const newNameProblem =
    newName.trim() === "" ? null : groupNameProblem(newName.trim());
  const newNameSuggestion = newNameProblem
    ? suggestGroupName(newName.trim())
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/cognito/groups`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as CognitoGroupsResponse;
      // Same rule as the two `group-tenant-roles` reads: a 200 whose body is
      // not the list is UNKNOWN, not "no groups". `?? []` would render "No
      // Cognito groups yet." for a pool that may be full of them, and a
      // non-array body would reach `groups.map()` below and throw.
      setGroups(requireRows<CognitoGroupRow>(json?.groups, "cognito groups"));
    } catch (err) {
      log.warn("load cognito groups failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperuser) void load();
  }, [load, isSuperuser]);

  // coord's group -> tenant -> role mappings. Read here as well as in the
  // section above: this is the reason the backend refuses a delete, so the
  // row that offers the delete has to show it.
  useEffect(() => {
    if (!isSuperuser || !panelOpened) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/group-tenant-roles`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as GroupTenantRolesResponse;
        // A successful STATUS is not a successful READ. `group_tenant_roles`
        // is declared non-optional, so a `?? []` here is dead per the types
        // and live at runtime — and what it would fabricate is precisely the
        // absence claim this whole change exists to make unreachable. Treat a
        // malformed 200 as the failure it is and let the `catch` route it to
        // the unknown arm. (It also stops a non-array body throwing later,
        // inside the `.filter()` at the render site.)
        const rows = requireRows<GroupTenantRoleRow>(
          json?.group_tenant_roles,
          "group-tenant-roles"
        );
        if (!cancelled) {
          setMappings(rows);
          setMappingsError(false);
        }
      } catch (err) {
        // Non-fatal: the group list still renders. The backend enforces the
        // referential guard regardless of what this panel managed to show.
        //
        // But do NOT collapse the failure to `[]`. `mappings.length === 0` is
        // what renders "no tenant mappings" and "No coord tenant mappings
        // reference this group." beside a Delete button, so an emptied array
        // here would publish a suppressed error as a confident all-clear about
        // the exact blast radius this panel exists to show. Flag it instead.
        //
        // The flag WINS at both render sites, so on a failed REFRESH a row
        // that had shown real mappings degrades to "unknown" rather than
        // continuing to display rows we can no longer vouch for. That is the
        // same trade `memberCounts` makes (its map is replaced wholesale, so a
        // known count degrades to "members unknown" too), and it is the safe
        // direction: unknown is never a weaker warning than the truth.
        log.warn("load group-tenant-roles for blast radius failed", err);
        if (!cancelled) setMappingsError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperuser, panelOpened, countsToken]);

  // Member counts, one probe per group, in parallel.
  useEffect(() => {
    if (!isSuperuser || !panelOpened || groups.length === 0) return;
    let cancelled = false;
    void (async () => {
      const counts: Record<string, number> = {};
      const errors: Record<string, true> = {};
      await Promise.all(
        groups.map(async (g) => {
          try {
            const res = await httpClient.fetch(
              `${OPERATIONS_API}/coord/cognito/groups/${encodeURIComponent(
                g.group_name
              )}/users`
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = (await res.json()) as CognitoGroupUsersResponse;
            // `memberErrors` is the mechanism #1111 held up as the model — a
            // failed probe becomes "members unknown" rather than a count. But
            // it is reached only from this `catch`, so a malformed 200 walked
            // straight past it: `(json.users ?? []).length` recorded a
            // confident `0 members` on the row that offers the pool-wide
            // Delete, with no error flag to contradict it. A non-array body was
            // worse still — `"nope".length` is 4, so the badge would have shown
            // a member count that was really a string length.
            //
            // Refusing the body here routes it to the same `catch`, which is
            // where the honest answer already lives.
            counts[g.group_name] = requireRows<CognitoGroupUserRow>(
              json?.users,
              "cognito group users"
            ).length;
          } catch (err) {
            log.warn("member count probe failed", g.group_name, err);
            errors[g.group_name] = true;
          }
        })
      );
      if (!cancelled) {
        setMemberCounts(counts);
        setMemberErrors(errors);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperuser, panelOpened, groups, countsToken]);

  const refreshBlastRadius = useCallback(
    () => setCountsToken((t) => t + 1),
    []
  );

  const createGroup = useCallback(async () => {
    const group_name = newName.trim();
    const namingProblem = groupNameProblem(group_name);
    if (namingProblem) {
      toast.error(namingProblem);
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = { group_name };
      if (newDescription.trim()) body.description = newDescription.trim();
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/cognito/groups`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (res.status === 409) {
        toast.error(`A Cognito group named "${group_name}" already exists.`);
        return;
      }
      if (!res.ok) {
        // One prefix, not two — the `catch` below adds "Create failed:", and
        // the backend's 400 already names the reason.
        throw new Error(await backendErrorMessage(res));
      }
      toast.success(`Created group ${group_name}`);
      setNewName("");
      setNewDescription("");
      await load();
    } catch (err) {
      log.warn("create cognito group failed", err);
      toast.error(
        `Create failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setCreating(false);
    }
  }, [newName, newDescription, load]);

  return (
    // R7 — the identity-provider surface: the least-often-read section on the
    // page and, at a table plus a create form, one of the tallest.
    <div data-testid="coord-members-cognito-groups">
    <CollapsiblePanel
      title="Cognito Groups"
      icon={<KeyRound className="h-4 w-4" />}
      titleAs="h2"
      defaultOpen={false}
      storageKey="coord-members-cognito-groups"
      summary={(
        <Badge
          variant="outline"
          className={`font-mono text-[11px]${
            error ? " text-amber-600 dark:text-amber-400" : ""
          }`}
          data-testid="coord-cognito-groups-summary"
        >
          <span className="font-normal text-muted-foreground">groups&nbsp;</span>
          {/* A failed read must not print `groups 0` on a collapsed panel —
              see the mappings badge above. This is the section that carries
              the pool-wide Delete, so "there is nothing here" is the last
              thing it should assert on a read that never landed. */}
          {loading ? "–" : error ? "unknown" : groups.length}
        </Badge>
      )}
      contentClassName="space-y-4"
    >
      <>
        {/* Mounts only while the panel is open — that is the signal the
            blast-radius probes wait on. */}
        <MountedOnce onMount={markPanelOpened} />
        {!isSuperuser ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="cognito-groups-superuser-required"
          >
            Cognito group management requires staff/superuser access.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Bind a group to a tenant+role above, create the matching Cognito
              group here, then add members by email — no AWS console needed.
            </p>

            {/* Existing groups */}
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : error ? (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> {error}
              </p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Cognito groups yet.
              </p>
            ) : (
              <Table data-testid="coord-cognito-groups-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <CognitoGroupItem
                      key={g.group_name}
                      group={g}
                      mappings={
                        mappings === null
                          ? null
                          : mappings.filter((m) => m.group_id === g.group_name)
                      }
                      mappingsError={mappingsError}
                      memberCount={
                        memberErrors[g.group_name]
                          ? undefined
                          : (memberCounts[g.group_name] ?? null)
                      }
                      membersError={memberErrors[g.group_name] === true}
                      onDeleted={load}
                      onMembersChanged={refreshBlastRadius}
                    />
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Create-group form */}
            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-sm font-medium">Create group</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="cognito-new-name">Group name</Label>
                  <Input
                    id="cognito-new-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. qontinui-admins"
                    aria-invalid={newNameProblem !== null}
                    // Only while the hint is rendered — see the mapping form's
                    // Group ID input above.
                    aria-describedby={
                      newNameProblem !== null
                        ? "cognito-new-name-problem"
                        : undefined
                    }
                    data-testid="cognito-new-name"
                  />
                  <GroupNameHint
                    problem={newNameProblem}
                    suggestion={newNameSuggestion}
                    onAccept={setNewName}
                    testId="cognito-new-name-problem"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cognito-new-description">
                    Description (optional)
                  </Label>
                  <Input
                    id="cognito-new-description"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="What this group is for"
                    data-testid="cognito-new-description"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={createGroup}
                  disabled={creating || newNameProblem !== null}
                  data-testid="cognito-create-submit"
                >
                  <Plus className="h-4 w-4" />
                  Create group
                </Button>
              </div>
            </div>
          </>
        )}
      </>
    </CollapsiblePanel>
    </div>
  );
}

// ===========================================================================
// Page — admin-gated shell
// ===========================================================================

export default function MembersPage() {
  const { isCoordAdmin, user, loading } = useAuth();
  // Bumped after any membership mutation so dependent sections refetch.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (loading) {
    return (
      <div className="p-3 sm:p-6 space-y-4" data-testid="coord-members-page">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isCoordAdmin) {
    return (
      <div className="p-3 sm:p-6" data-testid="coord-members-page">
        <Card data-testid="coord-members-access-denied">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-base font-semibold">
                Administrator access required
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Managing members and roles is restricted to tenant
                administrators. Ask an administrator for an Administrator-tier
                role if you need access.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-5xl"
      data-testid="coord-members-page"
    >
      {/* R7 — the members table FIRST and unconditional; the four secondary
          sections below it and folded. Ordering matters as much as folding:
          "Your tenant & roles" used to sit ABOVE the table, so an
          administrator arriving to change somebody's access read their own
          roles first. Each panel keeps its signal on the header while closed
          (the home tenant's name, the mapping count, the group count), which
          is R7's actual contract — the panel folds, its signal does not. */}
      <MembersTable refreshKey={refreshKey} onChanged={bump} />
      <MyTenantsCard />
      <InviteForm onInvited={bump} />
      <GroupTenantRolesSection isSuperuser={user?.is_superuser === true} />
      <CognitoGroupsSection isSuperuser={user?.is_superuser === true} />
    </div>
  );
}
