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
 *   Pipeline · Pull Requests · Gates · Alerts · Notifications   ← direct
 *   Work ▸    Plans / Plan Library / Questions / Agents / Agent Commands /
 *             Agent Skills / Prompt Log / History / Lands
 *   Merge ▸   Pull Decisions / Automation Rules / Gate Clearance /
 *             Merge Settings°
 *   Intent ▸  Prompt Documents / Policies / Decision Policies /
 *             Policy Edit Review
 *   Dev Ops ▸ Overview / Trees° / Spawn° / Runner Drain° / Test Targets° /
 *             Migrations° / Deploys° / Releases° / Git Ops° / Federation° /
 *             Memory° / Onboarding° / Onboarding Status°
 *   Access ▸  Members / Agent Registry                  (° = operator-only)
 *
 * `testId` values are load-bearing: the header crumb renders
 * `<testId>-active`, which Spec-CI "active section" assertions match.
 */

import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  Compass,
  Cpu,
  FileText,
  Gauge,
  Gavel,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hammer,
  History as HistoryIcon,
  Inbox,
  KeyRound,
  Layers,
  Library,
  MessageSquare,
  NotebookText,
  Package,
  Plug,
  Puzzle,
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
    href: "/admin/coord/alerts",
    label: "Alerts",
    icon: AlertTriangle,
    testId: "coord-nav-alerts",
  },
  {
    // Fifth direct tab by argued exception — see the header block. Placed
    // immediately after Alerts: conditions ("what is wrong now?") and
    // events ("what happened while I was away?") read as a pair.
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
        // Sits beside Plans deliberately: Plans is coord's work units, this is
        // the prompt/plan CORPUS those units are authored from. Distinct path
        // (not /plans/library) so the Plans item's startsWith active-match
        // doesn't double-highlight — same reasoning as the Onboarding pair.
        href: "/admin/coord/plan-library",
        label: "Plan Library",
        icon: Library,
        testId: "coord-nav-plan-library",
      },
      {
        href: "/admin/coord/questions",
        label: "Questions",
        icon: Inbox,
        testId: "coord-nav-questions",
      },
      {
        href: "/admin/coord/agents",
        label: "Agents",
        icon: ScrollText,
        testId: "coord-nav-agents",
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

