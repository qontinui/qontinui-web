"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Building2 } from "lucide-react";
import {
  fetchMyTenants,
  type MyTenantsResponse,
  type TenantRoleEntry,
} from "@/lib/api/operations/coordMembers";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import { CollapsiblePanel } from "@/components/console";
import {
  CoordProjectRenameDialog,
  type RenameTarget,
} from "@/components/admin/coord/CoordProjectRenameDialog";
import { requireRows } from "../_lib/groupName";
import {
  homeTenantName,
  renameTargetFor,
  tierLabel,
  tenantName,
} from "../_lib/tenantLabels";
import { log } from "../_lib/log";

// ===========================================================================
// Section a — Your tenant + roles
// ===========================================================================

/**
 * @param onSlugChanged called when a tenant's SHORT ID may have changed (a
 *   rename that moved the slug, or one whose outcome is unknown). Other panels
 *   on this page render slugs — the group-mapping list and the Cognito groups'
 *   mapping chips — so the page re-reads them.
 */
export function MyTenantsCard({ onSlugChanged }: { onSlugChanged: () => void }) {
  const [data, setData] = useState<MyTenantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The row whose Rename dialog is open. The dialog is MOUNTED only while this
  // is set, so the rest of the page never pays for its tenant-context and UI
  // Bridge hooks.
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchMyTenants();
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
      setError(operationsErrorMessage(err));
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
                {data.tenants.map((t, i) => {
                  const renameTarget = renameTargetFor(t);
                  return (
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
                      {renameTarget ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => setRenaming(renameTarget)}
                          data-testid={`coord-tenant-rename-open-${renameTarget.id}`}
                          data-ui-bridge-id={`coord.tenant-rename.open.${renameTarget.id}`}
                        >
                          Rename
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
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
    {renaming ? (
      <CoordProjectRenameDialog
        open
        tenant={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        // The rows above show what this section's read returned, so re-read.
        onRenamed={(result) => {
          void load();
          // `previous` absent is UNKNOWN, so it reloads rather than not.
          if (result.previous?.slug !== result.slug) onSlugChanged();
        }}
        onOutcomeUnknown={() => {
          void load();
          onSlugChanged();
        }}
      />
    ) : null}
    </div>
  );
}
