/**
 * The Coord Console's page structure — one definition, two renderers.
 *
 * The app sidebar renders it as navigation (`navigation/sidebar/nav-items.ts`
 * turns each direct tab into an item and each group into a collapsible), and
 * `CoordNav` renders it as the console header's wayfinding crumb. Keeping the
 * structure here, rather than inside either renderer, is what stops the two
 * from disagreeing about which pages exist and where they live.
 *
 * The groups are persona-shaped (developer / merge maintainer / fleet
 * operator), carried over unchanged from the console's own dropdown nav:
 *
 *   Pipeline · Pull Requests · Gates · Notifications   ← direct
 *   Work ▸    Plans / Work Units / Plan Library / Plan Candidates /
 *             Plan Forks / Plan Follow-ups / Questions / Findings /
 *             Verification /
 *             Agents / Agent Commands / Agent Skills / Prompt Log /
 *             History / Lands
 *   Merge ▸   Pull Decisions / Automation Rules / Gate Clearance /
 *             Merge Settings°
 *   Intent ▸  Prompt Documents / Policies / Decision Policies /
 *             Policy Edit Review
 *   Dev Ops ▸ Overview / CI / Trees° / Spawn° / Runner Drain° / Test Targets° /
 *             Migrations° / Deploys° / Releases° / Git Ops° / Federation° /
 *             Memory° / Onboarding° / Onboarding Status°
 *   Access ▸  Members / Agent Registry                  (° = operator-only)
 *
 * There is no Alerts tab. The raw `coord.alerts` list is agents' work (plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8); the operator's rollup of it is the Conditions panel on
 * `Dev Ops ▸ Overview`, and `next.config.mjs` 308s `/admin/coord/alerts`
 * there.
 *
 * `testId` values are load-bearing: the header crumb renders
 * `<testId>-active`, which Spec-CI "active section" assertions match.
 */

import {
  Activity,
  Anchor,
  BadgeCheck,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  Compass,
  CornerDownRight,
  Cpu,
  FileText,
  Files,
  Gauge,
  Gavel,
  GitBranch,
  GitFork,
  GitMerge,
  GitPullRequest,
  Hammer,
  HardDrive,
  History as HistoryIcon,
  Inbox,
  KeyRound,
  Layers,
  Library,
  Lightbulb,
  ListChecks,
  ListTodo,
  MessageSquare,
  NotebookText,
  Package,
  Plug,
  Puzzle,
  RotateCcw,
  Rocket,
  Scale,
  ScrollText,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Stethoscope,
  UserCog,
  Workflow,
} from "lucide-react";

export interface NavLeaf {
  href: string;
  label: string;
  icon: typeof Activity;
  testId: string;
  /**
   * Operator-infrastructure-only — cross-tenant / fleet-wide surfaces with no
   * tenant-scoped meaning for a developer. Rendered only for operators
   * (`user.is_superuser`); the backend enforces tenant scoping on everything
   * a member can reach.
   */
  operatorOnly?: boolean;
  /**
   * Coord-tenant-admin-only — a tenant-scoped page whose backend read is
   * gated on `require_coord_tenant_admin` (so a plain member would get a 403
   * page). Rendered for an admin of the ACTIVE tenant or a superuser, via
   * `isActiveTenantCoordAdmin` — the question that gate asks. NOT
   * `useAuth().isCoordAdmin`, which is a union across tenants. Distinct from
   * `operatorOnly`, which is `is_superuser` alone. See {@link navEntryVisibleTo}.
   */
  coordAdminOnly?: boolean;
}

/** Who is looking at the menu. */
export interface NavViewer {
  isSuperuser: boolean;
  isCoordAdmin: boolean;
}

/**
 * Whether a nav entry is shown to a viewer. The sidebar filter calls this, so
 * the two visibility classes cannot drift between the model and the menu:
 * `adminOnly`/`operatorOnly` needs a superuser; `coordAdminOnly` needs a coord
 * tenant admin (superusers included).
 */
export function navEntryVisibleTo(
  entry: {
    adminOnly?: boolean;
    operatorOnly?: boolean;
    coordAdminOnly?: boolean;
  },
  viewer: NavViewer | null
): boolean {
  // `operatorOnly` is the model's name for the sidebar's `adminOnly`.
  const superuserOnly = entry.adminOnly === true || entry.operatorOnly === true;
  if (superuserOnly && viewer?.isSuperuser !== true) return false;
  if (entry.coordAdminOnly && viewer?.isCoordAdmin !== true) return false;
  return true;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: typeof Activity;
  items: NavLeaf[];
  /**
   * Group hidden entirely for non-operators — trigger and all.
   *
   * This is NOT "every item is operator-only", and has not been since
   * `Dev Ops ▸` (resolved Q3 of
   * `2026-08-25-coord-console-intent-and-devops-sections`): that group drops
   * this flag and marks every member except `Overview` instead, so a plain
   * member sees the trigger with one entry under it. The two flags are
   * independent by construction — the sidebar drops the group on THIS flag
   * and filters items on `NavLeaf.operatorOnly` separately — so set this one
   * only when the group has nothing a member may reach, and never as a
   * shorthand for "most of its items are operator-only".
   */
  operatorOnly?: boolean;
}

// The redesigned merge-pipeline view (one row per PR) is member-visible and
// named for what a developer comes for. The ROUTE now says so too:
// `/admin/coord/fleet` became `/admin/coord/pipeline` in Phase 4 of
// `2026-08-25-coord-console-intent-and-devops-sections`, because after that
// phase "fleet" means Dev Ops and one word cannot mean two things in one
// console. `next.config.mjs` 308s the old path.
export const DIRECT_TABS: NavLeaf[] = [
  {
    href: "/admin/coord/pipeline",
    label: "Pipeline",
    icon: Activity,
    testId: "coord-nav-pipeline",
  },
  {
    href: "/admin/coord/prs",
    label: "Pull Requests",
    icon: GitPullRequest,
    testId: "coord-nav-prs",
  },
  {
    href: "/admin/coord/gates",
    label: "Gates",
    icon: Gauge,
    testId: "coord-nav-gates",
  },
  {
    // Fourth direct tab by argued exception — see the header block: the
    // operator's record of what agents did, read at a glance.
    href: "/admin/coord/notifications",
    label: "Notifications",
    icon: Bell,
    testId: "coord-nav-notifications",
  },
];

export const GROUPS: NavGroup[] = [
  {
    id: "work",
    label: "Work",
    icon: Hammer,
    items: [
      {
        href: "/admin/coord/plans",
        label: "Plans",
        icon: FileText,
        testId: "coord-nav-plans",
      },
      {
        // Sits beside Plans deliberately, and the two are NOT two views of one
        // thing. Plans is the plan CORPUS reconciled three ways
        // (`/plan-library/reconciliation`, slug-ordered, paged, with a stated
        // total); this is coord's OPERATIONAL work-unit store — a recency
        // window over `coord.work_units`, including the `shepherd-*` merge
        // escalations no other surface shows. It was `/admin/coord/plans`
        // until Phase 3 of plan
        // `2026-09-20-the-operator-plans-page-reads-the-wrong-store`, which
        // moved it here rather than deleting it: it answers a real question
        // for a real population, just not the one its old name promised.
        //
        // Distinct path (not `/plans/work-units`) so the Plans item's
        // startsWith active-match doesn't double-highlight — same reasoning as
        // the Plan Library and Onboarding pairs.
        href: "/admin/coord/work-units",
        label: "Work Units",
        icon: ListTodo,
        testId: "coord-nav-work-units",
      },
      {
        // The plan library's two policy dials (`plan_capture`,
        // `citation_scope_backfill_write`). Its browsing page folded into
        // Plans (plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next`
        // Phase 1) and `/admin/coord/plan-library` now redirects there, so the
        // leaf names the one page the old route still owns. Distinct path (not
        // /plans/settings) so the Plans item's startsWith active-match doesn't
        // double-highlight — same reasoning as the Onboarding pair.
        href: "/admin/coord/plan-library/settings",
        label: "Plan Library Settings",
        icon: Library,
        testId: "coord-nav-plan-library",
      },
      {
        // Every captured artifact KIND — prompts, findings reports, handoffs
        // and the rest. Plans reads `kind = 'plan'` only, so without this leaf
        // the other kinds would have no browsable surface at all. Sibling
        // path of the settings page; neither prefixes the other.
        href: "/admin/coord/plan-library/artifacts",
        label: "Artifact Library",
        icon: Files,
        testId: "coord-nav-plan-library-artifacts",
      },
      // Phase 4 of `2026-09-20-the-operator-plans-page-reads-the-wrong-store`.
      // Three purpose-built plan-library joins had shipped with tests, an
      // OpenAPI entry and a contract — and ZERO consumers; a `git grep` for
      // each route name across `frontend/**` matched only the two generated
      // snapshots. An unconsumed route is not neutral [policy:
      // `capability-ships-enabled`], so each gets a leaf here as well as its
      // in-page entry point. No href prefixes another (`/plans` does not
      // prefix `/plan-candidates`), which is what keeps the sidebar's
      // startsWith active-match from double-highlighting.
      {
        href: "/admin/coord/plan-candidates",
        label: "Plan Candidates",
        icon: ListChecks,
        testId: "coord-nav-plan-candidates",
      },
      {
        // Reached from the `coord-plan-divergent` marker on Plans as well —
        // that marker had nowhere to go until this page existed.
        href: "/admin/coord/plan-forks",
        label: "Plan Forks",
        icon: GitFork,
        testId: "coord-nav-plan-forks",
      },
      {
        href: "/admin/coord/plan-followups",
        label: "Plan Follow-ups",
        icon: CornerDownRight,
        testId: "coord-nav-plan-followups",
      },
      {
        href: "/admin/coord/questions",
        label: "Questions",
        icon: Inbox,
        testId: "coord-nav-questions",
      },
      {
        // Sits beside Questions deliberately: both are what an agent WROTE
        // DOWN rather than what it did. Findings is coord's findings store —
        // the reasoning an agent recorded with a write, and the only place a
        // CREATED prompt document's reasoning exists, since coord emits no
        // notice for a v1. `/admin/coord/prompt-document-proposals` deep-links
        // into it at `?id=<finding_id>`. Plan
        // `2026-09-15-the-console-names-a-finding-it-cannot-open`, Phase 2.
        href: "/admin/coord/findings",
        label: "Findings",
        icon: Lightbulb,
        testId: "coord-nav-findings",
      },
      {
        // Beside Findings, because a refutation IS a finding: this page is the
        // drill-down behind the overview's "Can I trust 'done'?" tile — trust
        // calibration and independent-verification coverage over one shipped
        // population, with their unknowns, the checker lane and a 12-week
        // series. Plan
        // `2026-09-20-trust-calibration-and-independent-verification-coverage-are-measured-continuously`,
        // Phase 5.
        href: "/admin/coord/verification",
        label: "Verification",
        icon: BadgeCheck,
        testId: "coord-nav-verification",
      },
      {
        href: "/admin/coord/agents",
        label: "Agents",
        icon: ScrollText,
        testId: "coord-nav-agents",
      },
      {
        // Closed sessions whose work was never declared finished, fleet-wide,
        // with Resume / Dismiss and the tenant's automatic-resume switch. Plan
        // `2026-10-06-closed-sessions-whose-work-is-unfinished-are-found-fleet-wide-and-resumed`.
        href: "/admin/coord/unfinished",
        label: "Unfinished Sessions",
        icon: RotateCcw,
        testId: "coord-nav-unfinished",
      },
      {
        // Sits beside Agents deliberately: Agents is the per-agent registry,
        // these two are the TEXT those agents are handed at spawn. Filing them
        // under "Merge" — where the other authoring surfaces (Policies, Prompt
        // Documents) happen to live — would put agent tooling behind a label
        // that actively misdirects; nothing about a slash command is about
        // merging, so this group is where they belong. Plan
        // `2026-08-20-fleet-served-agent-skills.md`, Phase 3.
        //
        // Distinct path from `/admin/coord/agents`, and neither of the two
        // prefixes the other: `isLeafActive` matches `pathname === href ||
        // pathname.startsWith(href + "/")`, so `/admin/coord/agent-commands`
        // never satisfies `/admin/coord/agents/` and the pair cannot
        // double-highlight — the same reasoning as the Onboarding pair.
        href: "/admin/coord/agent-commands",
        label: "Agent Commands",
        icon: SquareTerminal,
        testId: "coord-nav-agent-commands",
      },
      {
        href: "/admin/coord/agent-skills",
        label: "Agent Skills",
        icon: Puzzle,
        testId: "coord-nav-agent-skills",
      },
      {
        href: "/admin/coord/prompt-injections",
        label: "Prompt Log",
        icon: MessageSquare,
        testId: "coord-nav-prompt-injections",
      },
      {
        href: "/admin/coord/history",
        label: "History",
        icon: HistoryIcon,
        testId: "coord-nav-history",
      },
      {
        href: "/admin/coord/lands",
        label: "Lands",
        icon: Anchor,
        testId: "coord-nav-lands",
      },
    ],
  },
  {
    id: "merge",
    label: "Merge",
    icon: GitMerge,
    items: [
      {
        href: "/admin/coord/pull-decisions",
        label: "Pull Decisions",
        icon: GitPullRequest,
        testId: "coord-nav-pull-decisions",
      },
      {
        href: "/admin/coord/automation-rules",
        label: "Automation Rules",
        icon: Workflow,
        testId: "coord-nav-automation-rules",
      },
      {
        // STAYS in Merge, and that is a decision rather than an oversight
        // (`2026-08-25-coord-console-intent-and-devops-sections` Phase 3,
        // resolved Q2). It shares the one coord-policy CRUD chain with
        // Automation Rules — both `gate-clearance/_hooks/useGateClearanceRules`
        // and `automation-rules/_hooks/useAutomationRules` build on
        // `_shared/useCoordPolicies` — so it authors `coord.policy_rules` rows
        // the way Automation Rules does. But what it authors rows ABOUT is who
        // may clear a **gate**, and a gate is merge-chain machinery: filing it
        // under `Intent ▸` on the strength of the word "policy" would be the
        // very conflation that moved Prompt Documents / Policies / Policy Edit
        // Review OUT of this group, run in reverse. The Gates page also links
        // across to it from the gate context.
        href: "/admin/coord/gate-clearance",
        label: "Gate Clearance",
        icon: ShieldCheck,
        testId: "coord-nav-gate-clearance",
      },
      {
        href: "/admin/coord/merge-settings",
        label: "Merge Settings",
        icon: GitMerge,
        testId: "coord-nav-merge-settings",
        operatorOnly: true,
      },
    ],
  },
  {
    // What the tenant is BUILDING and the standing guidance agents read while
    // building it — the prompt-shaped document cluster that used to sit under
    // `Merge ▸` for no recorded reason. None of these three is read by the
    // merge train, gates a PR, or appears in a merge decision. Moved here by
    // `2026-08-25-coord-console-intent-and-devops-sections` Phase 3 (Gap 1).
    //
    // On the label — three names were rejected and one tiebreak was decided:
    //  - NOT `Digital Twin`, despite that being the operator's framing: the
    //    app sidebar already uses that name for the *observed-system* twin
    //    (`navigation/sidebar/nav-items.ts` — CI state, routing, dependencies,
    //    health, deploy freshness), and reusing it collides with a large
    //    shipped subsystem.
    //  - NOT `Policies` / `Rules` / `Guidance`: plan
    //    `2026-08-21-project-intent-documents-and-the-selection-loop`
    //    §"Naming constraint" forbids those for these documents, and `/policy`
    //    already means agent-behaviour rules fleet-wide.
    //  - `Intent` over `Direction` (both were live): `Intent` is the vocabulary
    //    of the plan that FILLS this section — `policy = how to act, intent =
    //    what to build`. Two plans, one word.
    //
    // Ownership: `2026-08-21-project-intent-documents-and-the-selection-loop`
    // §3c describes this same edit and is also VETTED. The nav section landed
    // HERE, because Phase 1 of the sections plan had already rewritten this
    // file — two PRs editing `GROUPS` with no shared base is a conflict by
    // construction. Do not implement it a second time from that plan.
    //
    // Member-visible, trigger and items alike: every one of the three is a
    // tenant-scoped surface today and none carries `operatorOnly`.
    id: "intent",
    label: "Intent",
    icon: Compass,
    items: [
      {
        href: "/admin/coord/prompt-documents",
        label: "Prompt Documents",
        icon: NotebookText,
        testId: "coord-nav-prompt-documents",
      },
      {
        href: "/admin/coord/policies",
        label: "Policies",
        icon: Scale,
        testId: "coord-nav-policies",
      },
      {
        // Sits beside Policies deliberately, and in `Intent ▸` rather than
        // `Merge ▸`. `/admin/coord/policies` is the READ-ONLY half of exactly
        // this store — the fleet table of tenants that have graduated a
        // next-step domain — and this is where those rows are AUTHORED. What a
        // decision policy carries is a standing guidance frame an agent reads
        // while deciding what to do next, which is what this group is for; the
        // fact that one of the five domains is called `pr_fix` does not make it
        // merge-chain machinery the way a gate does (see the Gate Clearance
        // note above, which is the same test run the other way).
        //
        // Distinct path segment, not `/policies/decision`, so the Policies
        // item's `startsWith(href + "/")` active-match cannot double-highlight.
        href: "/admin/coord/decision-policies",
        label: "Decision Policies",
        icon: SlidersHorizontal,
        testId: "coord-nav-decision-policies",
      },
      {
        // Sits beside Prompt Documents deliberately: it reviews edits TO those
        // documents. Distinct path (not /prompt-documents/proposals) so the
        // Prompt Documents item's startsWith active-match doesn't
        // double-highlight, matching the Onboarding / Onboarding Status pair.
        href: "/admin/coord/prompt-document-proposals",
        label: "Policy Edit Review",
        icon: Gavel,
        testId: "coord-nav-prompt-document-proposals",
      },
    ],
  },
  {
    // Everything about the hardware the fleet runs on: whose machines they
    // are, what they are doing, and how much they will take. The GROUP is
    // member-visible and its members are not — see `NavGroup.operatorOnly`.
    id: "devops",
    label: "Dev Ops",
    icon: Server,
    items: [
      {
        // The only tenant-visible member, and the reason the group flag is
        // gone: "how is the system functioning" is a question a developer
        // asks about their own machines.
        href: "/admin/coord/devops",
        label: "Overview",
        icon: Gauge,
        testId: "coord-nav-devops-overview",
      },
      {
        // Plan `2026-10-04-ci-dashboard-in-the-dev-ops-console` D1: the POOL
        // axis (capacity, queue, outcome class) gets its own leaf beside the
        // machine-axis Overview rather than a sixth section on it. Member-
        // visible like Overview: "is CI healthy, and where is it stuck?" is a
        // developer's question about their own repos, and its reads
        // (`/ci/overview`, `/ci-status`, merge economics) are tenant-member
        // reads, not admin ones.
        href: "/admin/coord/ci",
        label: "CI",
        icon: BadgeCheck,
        testId: "coord-nav-ci",
      },
      {
        // Plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-
        // and-coord-has-no-resource-model` Phase 5: the computer as a record —
        // capacity, usage per lane, watched services, events, workloads. Beside
        // Overview because Overview's computers link points here.
        // `coordAdminOnly`, not `operatorOnly`: its proxies are gated on
        // `require_coord_tenant_admin` (the payload carries registrar CI-runner
        // rows and access facts), and the menu uses that same gate — a plain
        // member still sees exactly Overview here (resolved Q3), while a coord
        // admin who is not staff is not locked out of a page they may read.
        href: "/admin/coord/computers",
        label: "Computers",
        icon: HardDrive,
        testId: "coord-nav-computers",
        coordAdminOnly: true,
      },
      {
        href: "/admin/coord/trees",
        label: "Trees",
        icon: Boxes,
        testId: "coord-nav-trees",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/spawn",
        label: "Spawn",
        icon: Rocket,
        testId: "coord-nav-spawn",
        operatorOnly: true,
      },
      {
        // A DEVICE MAINTENANCE surface (plan
        // `2026-09-13-drained-runner-never-reaches-idle` D10): drain one
        // runner, watch its restart readiness, and wind down the sessions in
        // the way. Dev Ops rather than a sixth session console — it links to
        // `/sessions?device=` for history instead of reimplementing it. Beside
        // Spawn because the two are the operator's two levers on a runner:
        // put work on it, and get it quiet enough to rebuild.
        href: "/admin/coord/runners",
        // Not "Runners": the app sidebar's top-level Runners entry is
        // `/runners` (online devices, history, tokens). This page is the
        // drain-and-rebuild lever, and one word cannot name both in one menu.
        label: "Runner Drain",
        icon: Cpu,
        testId: "coord-nav-runners",
        operatorOnly: true,
      },
      {
        // Its own route since Phase 4, not a disclosure two levels deep inside
        // the pipeline page: it is a config editor with four write paths
        // (`PATCH /fleet/apps/{id}`, `PUT`/`DELETE
        // /fleet/test-targets/{device}/{app}`, `POST /dispatch/fresh-host`),
        // and a config editor buried inside another domain's page is a defect.
        href: "/admin/coord/test-targets",
        label: "Test Targets",
        icon: Rocket,
        testId: "coord-nav-test-targets",
        operatorOnly: true,
      },
      {
        // Dev Ops rather than Merge (resolved Q4): the alembic reservation
        // queue is a shared RESOURCE, and blocking a PR is a consequence of
        // contention on it, not what it is. The merge-side need is carried by
        // a cross-link from a waiting `MergePipeline` row.
        href: "/admin/coord/migrations",
        label: "Migrations",
        icon: Layers,
        testId: "coord-nav-migrations",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/deploys",
        label: "Deploys",
        icon: Rocket,
        testId: "coord-nav-deploys",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/releases",
        label: "Releases",
        icon: Package,
        testId: "coord-nav-releases",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/git-ops",
        label: "Git Ops",
        icon: GitBranch,
        testId: "coord-nav-git-ops",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/federation",
        label: "Federation",
        icon: GitMerge,
        testId: "coord-nav-federation",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/memory",
        label: "Memory",
        icon: BookOpen,
        testId: "coord-nav-memory",
        operatorOnly: true,
      },
      {
        href: "/admin/coord/onboarding",
        label: "Onboarding",
        icon: Plug,
        testId: "coord-nav-onboarding",
        operatorOnly: true,
      },
      {
        // Zero-touch onboarding status (P4) — per-repo doctor checklist. Also
        // the GitHub App's post-install Setup URL target (accepts ?repo=…).
        // Distinct path (not /onboarding/status) so the Onboarding item's
        // startsWith active-match doesn't double-highlight.
        href: "/admin/coord/onboarding-status",
        label: "Onboarding Status",
        icon: Stethoscope,
        testId: "coord-nav-onboarding-status",
        operatorOnly: true,
      },
    ],
  },
  {
    id: "access",
    label: "Access",
    icon: KeyRound,
    items: [
      {
        href: "/admin/coord/members",
        label: "Members",
        icon: UserCog,
        testId: "coord-nav-members",
      },
      {
        // The tenant DEFAULT for each agent — what a member with no recorded
        // preference gets. A member's own preference lives at
        // /settings/agents, which is not a console surface.
        href: "/admin/coord/agent-registry",
        label: "Agent Registry",
        icon: Bot,
        testId: "coord-nav-agent-registry",
      },
      {
        // Per-tenant switches: transcript sync (the session-output ingest
        // consent gate coord enforces; plan
        // `2026-09-22-transcript-sync-default-on-with-tenant-and-user-controls`)
        // the `command_safety_rewrite` fleet-policy dial runners read at
        // spawn (plan
        // `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts`),
        // and the `account_selection_mode` dial runners force-apply unless the
        // machine is pinned (plan
        // `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`).
        href: "/admin/coord/tenant-policy",
        label: "Tenant Policy",
        icon: ShieldCheck,
        testId: "coord-nav-tenant-policy",
      },
    ],
  },
];

export function isLeafActive(pathname: string, leaf: NavLeaf): boolean {
  return pathname === leaf.href || pathname.startsWith(leaf.href + "/");
}

/** Where the current page sits in the console: its group (null for a direct
 *  tab) and its leaf, or null when the path is no console page. */
export function findActiveLeaf(
  pathname: string
): { group: NavGroup | null; leaf: NavLeaf } | null {
  const direct = DIRECT_TABS.find((leaf) => isLeafActive(pathname, leaf));
  if (direct) return { group: null, leaf: direct };
  for (const group of GROUPS) {
    const leaf = group.items.find((item) => isLeafActive(pathname, item));
    if (leaf) return { group, leaf };
  }
  return null;
}
