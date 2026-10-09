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
 * Sections, in render order:
 *  c. Add a member by email    — POST /coord/tenant-members
 *     (the PRIMARY write, unfolded and first)
 *  b. Members table            — GET  /coord/members
 *                                POST /coord/members/{operator_id}/roles
 *                                DELETE /coord/members/{operator_id}/roles
 *  a. Your tenant + roles      — GET  /coord/my-tenants   (folded)
 *  "Advanced: auto-provision by SSO group" (folded) holding two panels:
 *   d. Group → tenant → role   — GET  /coord/group-tenant-roles
 *                                POST /coord/group-tenant-roles
 *                                DELETE /coord/group-tenant-roles
 *   e. Cognito groups          — GET/POST/DELETE /coord/cognito/groups*
 *                                (superuser-only, gated inside the section)
 *
 * The letters are the sections' historical names, kept so the banner comments
 * in `_components/` still resolve; they are no longer the order.
 *
 * ## One task, one form (plan `2026-09-15-simplify-tenant-member-add-by-email`)
 *
 * Section c used to be `InviteForm`, a "invite / pre-provision" panel asking
 * the administrator to hand-type a Cognito **subject (`sub`)** and an **SSO
 * provider**. Its own on-page copy conceded it only worked for somebody who
 * had already signed up and whose `sub` you already knew out-of-band — there
 * was no invitation behind it, and both fields are internal vocabulary on a
 * primary surface (**R8**). It is deleted, not deprecated: `AddTenantMemberForm`
 * takes an email and a tier, and the backend decides whether the account exists
 * (`added`) or does not. Creating an account is a platform superuser's act —
 * Qontinui is invite-only — so a superuser gets `invited` (account created,
 * tier granted, then a temporary password emailed) and a tenant admin gets
 * `invite_required`, with nothing written.
 *
 * Sections d and e were the other two ways to "add somebody", each framed in
 * IdP plumbing. They now sit together under one folded **Advanced** panel that
 * says what they are actually for — pre-authorizing an entire IdP group's
 * current *and future* members — so they read as a rarer, different tool
 * rather than as two more routes to the thing the top form does.
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

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Users } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { CollapsiblePanel } from "@/components/console";
import { MyTenantsCard } from "./_components/MyTenantsCard";
import { MembersTable } from "./_components/MembersTable";
import { AddTenantMemberForm } from "./_components/AddTenantMemberForm";
import { GroupTenantRolesSection } from "./_components/GroupTenantRolesSection";
import { CognitoGroupsSection } from "./_components/CognitoGroupsSection";

// ===========================================================================
// Page — admin-gated shell
// ===========================================================================

export default function MembersPage() {
  const { isCoordAdmin, user, loading } = useAuth();
  // Bumped after any membership mutation so dependent sections refetch.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  // Bumped when a tenant rename moved (or may have moved) a slug, so every
  // panel that renders slugs re-reads.
  const [slugKey, setSlugKey] = useState(0);
  const bumpSlugs = useCallback(() => setSlugKey((k) => k + 1), []);

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
      {/* The add form FIRST, then the members table, then everything else
          folded below. R7's ordering argument ("the read an administrator came
          for goes first, write forms fold away") held while the write form was
          a five-field pre-provisioning panel costing ~330px. It is now two
          inputs and one button — and it is the task this page exists for, so
          burying it under a members list that grows without bound would cost
          the primary action a scroll on exactly the tenants that have the most
          people in them. Everything R7 was actually protecting against is
          unchanged: nothing secondary sits above the table. */}
      <AddTenantMemberForm onAdded={bump} />
      {/* R7 — the members table unconditional; the secondary sections below it
          and folded. Ordering matters as much as folding: "Your tenant & roles"
          used to sit ABOVE the table, so an administrator arriving to change
          somebody's access read their own roles first. Each panel keeps its
          signal on the header while closed (the home tenant's name, the mapping
          count, the group count), which is R7's actual contract — the panel
          folds, its signal does not. */}
      <MembersTable refreshKey={refreshKey} onChanged={bump} />
      <MyTenantsCard onSlugChanged={bumpSlugs} />
      {/* R7 + the plan's Design decision 1 — the SSO-group machinery is one
          tool for a different job (pre-authorizing an entire IdP group's
          current and future members), not a second way to do what the form at
          the top does. Two sibling panels read as two more options; ONE
          labelled "Advanced" panel with a sentence of its own reads as the
          rarer tool it is.

          The cost, named rather than glossed: R7's "the panel folds, its
          signal does not" now holds one level down. The mapping count and the
          group count still sit on their own collapsed headers, but those
          headers are themselves unmounted until this wrapper is opened, so
          neither number is visible on arrival. That is acceptable HERE and
          only here — both are inventory counts of a bulk-provisioning tool,
          not a health signal: nothing about them is ever the thing an
          administrator must act on now. The one signal that IS (a member
          holding no access at all) lives in the members table's own
          StatCluster, which is unconditional and above this. */}
      <CollapsiblePanel
        title="Advanced: auto-provision by SSO group"
        icon={<Users className="h-4 w-4" />}
        titleAs="h2"
        defaultOpen={false}
        storageKey="coord-members-advanced-sso"
        contentClassName="space-y-4"
        data-testid="coord-members-advanced"
      >
        <>
          <p className="text-xs text-muted-foreground">
            Bulk provisioning. Map an identity-provider group to a tenant role
            and every member of that group — the ones in it today and the ones
            added to it later — gets that role automatically when they sign in.
            To give one colleague access, use the form at the top of this page
            instead.
          </p>
          <GroupTenantRolesSection
            isSuperuser={user?.is_superuser === true}
            refreshKey={slugKey}
          />
          <CognitoGroupsSection
            isSuperuser={user?.is_superuser === true}
            refreshKey={slugKey}
          />
        </>
      </CollapsiblePanel>
    </div>
  );
}
