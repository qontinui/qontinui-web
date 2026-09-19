import React from "react";
import {
  LayoutDashboard,
  Workflow,
  Network,
  Sparkles,
  CheckCircle2,
  Settings,
  FileText,
  Scissors,
  Search,
  ImageIcon,
  Camera,
  Box,
  GitBranch,
  Scan,
  Target,
  Sliders,
  Globe,
  Play,
  Video,
  Monitor,
  Store,
  TestTube2,
  Database,
  BarChart3,
  AlertCircle,
  BookOpen,
  ScanSearch,
  Server,
  CalendarClock,
  GitCommitHorizontal,
  Boxes,
  Download,
  ListChecks,
  Coins,
  Archive,
  Users,
  ShieldCheck,
} from "lucide-react";
import type { NavItem } from "./types";
import {
  DIRECT_TABS as COORD_DIRECT_TABS,
  GROUPS as COORD_GROUPS,
  type NavGroup,
  type NavLeaf,
} from "@/components/admin/coord/coordNavModel";
import {
  OVERVIEW_ROOT,
  OVERVIEW_SECTIONS,
} from "@/components/overview/sections";

// =============================================================================
// Web-local navigation items.
//
// Items shared with the runner come from the @qontinui/navigation package via
// shared-nav-adapter.ts. Everything web-specific lives here: the Coord,
// Sessions, Fleet and Access sections, the (hidden) visual-automation menu,
// and the admin items.
// =============================================================================

const COORD_COLOR = "#10B981";
const FLEET_COLOR = "#6366F1";

/** Sidebar id for a console page, from its model `testId`
 *  (`coord-nav-plans` → `coord-plans`). */
function coordItemId(leaf: NavLeaf): string {
  return leaf.testId.replace(/^coord-nav-/, "coord-");
}

function coordLeafItem(leaf: NavLeaf, group?: string): NavItem {
  return {
    id: coordItemId(leaf),
    label: leaf.label,
    icon: React.createElement(leaf.icon, {
      className: group ? "size-5" : "size-4",
    }),
    route: leaf.href,
    color: COORD_COLOR,
    // Console pages have detail routes (`/admin/coord/plans/<slug>`) that
    // should keep their section highlighted. No two console hrefs prefix one
    // another, so this cannot double-highlight.
    matchPrefix: true,
    adminOnly: leaf.operatorOnly,
    group,
  };
}

/** A console group as one collapsible sidebar item. Operator-only leaves map
 *  to `adminOnly` (both mean `is_superuser`), and the sidebar filter drops a
 *  parent whose children are all filtered out. */
function coordModelGroup(id: CoordGroupId): NavGroup {
  const model = COORD_GROUPS.find((g) => g.id === id);
  if (!model) throw new Error(`coordNavModel has no group "${id}"`);
  return model;
}

function coordGroupItem(id: CoordGroupId, group: string): NavItem {
  const model = coordModelGroup(id);
  const first = model.items[0];
  if (!first) throw new Error(`coordNavModel group "${id}" is empty`);
  return {
    id: `coord-group-${model.id}`,
    label: model.label,
    icon: React.createElement(model.icon, { className: "size-5" }),
    route: first.href,
    color: COORD_COLOR,
    adminOnly: model.operatorOnly,
    group,
    children: model.items.map((leaf) => coordLeafItem(leaf)),
  };
}

type CoordGroupId = "work" | "merge" | "intent" | "devops" | "access";

/** Sidebar group label for the Project Overview. `use-sidebar-navigation`
 *  moves this group to the very top of the menu, whatever else is shown. */
export const OVERVIEW_GROUP = "Overview";

const OVERVIEW_COLOR = "#4A90D9";

export const devNavItems: NavItem[] = [
  // ===========================================================================
  // Overview — the project overview for business leaders overseeing a
  // project (plan `2026-09-19-project-overview-for-business-leaders`). The
  // page list lives in `components/overview/sections.ts`, shared with the
  // overview's own sub-navigation. Visible to every authenticated user.
  // ===========================================================================
  ...OVERVIEW_SECTIONS.map(
    (section): NavItem => ({
      id: section.id,
      label: section.label,
      description: section.description,
      icon: React.createElement(section.icon, { className: "size-5" }),
      route: section.route,
      color: OVERVIEW_COLOR,
      // Summary's route prefixes every sibling's, so only the others keep
      // their highlight on detail routes.
      matchPrefix: section.route !== OVERVIEW_ROOT,
      group: OVERVIEW_GROUP,
    })
  ),

  // NOTE: there is no local "Co-Pilot" or "Home" nav item. The shared
  // `@qontinui/navigation` registry's `prompt-home` item ("Home", the co-pilot
  // command surface) is hidden on web for now — see `WEB_REMOVED_SHARED_IDS`
  // in `_hooks/use-sidebar-navigation.ts`. The `/prompt-home` route itself is
  // kept so the surface can come back by removing that one id.

  // ===========================================================================
  // Coord — the Coord Console is the heart of qontinui-web, so its sections
  // ARE the top of the menu rather than one "Coord Console" entry leading to a
  // second, in-page menu. Structure comes from `coordNavModel.ts`, which the
  // console header's wayfinding crumb reads too.
  //
  // VISIBLE TO ALL authenticated users: the /admin/coord pages are viewable by
  // any tenant member, with mutation controls gated per-control via
  // <CoordAdminOnly>. Operator-infrastructure pages are `adminOnly`.
  // ===========================================================================
  ...COORD_DIRECT_TABS.map((leaf) => coordLeafItem(leaf, "Coord")),
  coordGroupItem("work", "Coord"),
  coordGroupItem("merge", "Coord"),
  coordGroupItem("intent", "Coord"),
  // Regression Tests — condition groups (natural-language checks) run on
  // demand or on a schedule against a target URL. Coord-backed: the
  // `/api/v1/conditions/*` backend proxies to coord's condition-group routes,
  // scoped to the caller's tenant.
  {
    id: "conditions",
    label: "Regression Tests",
    description: "Condition groups run on demand or on a schedule",
    icon: React.createElement(ListChecks, { className: "size-5" }),
    route: "/conditions",
    color: COORD_COLOR,
    group: "Coord",
  },

  // ===========================================================================
  // Sessions — the live coord view (/sessions, bounded by a 7-day GC), the
  // PERMANENT archive beside it, and what the sessions produced and held.
  // ===========================================================================
  {
    id: "sessions",
    label: "Sessions",
    description: "Live and recent agent sessions",
    icon: React.createElement(Users, { className: "size-5" }),
    route: "/sessions",
    color: COORD_COLOR,
    group: "Sessions",
  },
  // Session Repository — the permanent archive of Claude Code sessions
  // (`agent.session_artifacts` + the object store), plan
  // `2026-08-26-claude-code-session-repository-in-qontinui-web` Phase 5.
  // Reads are member-visible and tenant-scoped server-side; relaunch/transfer
  // is gated by <CoordAdminOnly> on the detail page and by the backend.
  {
    id: "session-repository",
    label: "Session Repository",
    description: "Archived Claude Code sessions — search, review, relaunch",
    icon: React.createElement(Archive, { className: "size-5" }),
    route: "/sessions/repository",
    color: COORD_COLOR,
    group: "Sessions",
  },
  {
    id: "commits",
    label: "Commits",
    description: "Which session produced which commit",
    icon: React.createElement(GitCommitHorizontal, { className: "size-5" }),
    route: "/commits",
    color: COORD_COLOR,
    group: "Sessions",
  },
  {
    id: "agent-claims",
    label: "Claims",
    description: "Resources agent sessions currently hold",
    icon: React.createElement(ShieldCheck, { className: "size-5" }),
    route: "/admin/agent-claims",
    color: COORD_COLOR,
    group: "Sessions",
  },

  // ===========================================================================
  // Fleet — the machines the work runs on.
  // ===========================================================================
  // Runners — the ONE runners entry. The unified /runners page covers online
  // runners, session history, and auth tokens; the shared registry's own
  // `runners` item (same route) is hidden on web so it is not listed twice.
  // The console's drain-and-rebuild page is "Runner Drain" under Dev Ops.
  {
    id: "runner-fleet",
    label: "Runners",
    description: "Online runners, session history, and auth tokens",
    icon: React.createElement(Server, { className: "size-5" }),
    route: "/runners",
    color: FLEET_COLOR,
    group: "Fleet",
  },
  coordGroupItem("devops", "Fleet"),
  // Environments — register applications + machines, define environments,
  // designate a CANONICAL machine, and view per-machine config DRIFT vs
  // canonical. User-JWT scoped (devenv API).
  {
    id: "environments",
    label: "Environments",
    description: "Applications, machines, and config drift vs canonical",
    icon: React.createElement(Server, { className: "size-5" }),
    route: "/environments",
    color: FLEET_COLOR,
    group: "Fleet",
  },
  // Digital Twin — completeness matrix over the coordination-layer observers
  // and the per-observer credibility envelope agents receive.
  {
    id: "digital-twin",
    label: "Digital Twin",
    description: "Twin completeness + observer credibility",
    icon: React.createElement(Boxes, { className: "size-5" }),
    route: "/digital-twin",
    color: FLEET_COLOR,
    group: "Fleet",
  },
  // Download the Qontinui Runner desktop app (the in-app /download page
  // resolves the latest release dynamically).
  {
    id: "download-runner",
    label: "Download Runner",
    description: "Download the Qontinui Runner desktop app",
    icon: React.createElement(Download, { className: "size-5" }),
    route: "/download",
    color: FLEET_COLOR,
    group: "Fleet",
  },

  // ===========================================================================
  // Access — who is in the project, and which agents they get by default.
  // ===========================================================================
  ...coordModelGroup("access").items.map((leaf) =>
    coordLeafItem(leaf, "Access")
  ),

  // Scheduled Runs — cron-style workflow dispatches. Advanced/automation (gated
  // behind the "Show advanced automation features" toggle on web).
  {
    id: "scheduled-runs",
    label: "Scheduled Runs",
    description: "Cron-style workflow dispatches",
    icon: React.createElement(CalendarClock, { className: "size-5" }),
    route: "/scheduled-runs",
    color: "#0EA5E9",
    group: "Automation",
  },

  // Model Cost Comparison — static, admin-maintained dataset (refreshed via
  // the /update-model-costs command) comparing per-token API prices and
  // subscription-plan combinations across LLM providers, with leaderboard
  // scores. Visible to all authenticated users.
  {
    id: "model-cost-comparison",
    label: "Model Costs",
    description: "Compare per-token and subscription costs across AI models",
    icon: React.createElement(Coins, { className: "size-5" }),
    route: "/model-cost-comparison",
    color: "#F59E0B",
    group: "Tools",
  },

  // ===========================================================================
  // AI mode tools (supplemental to shared navigation)
  // ===========================================================================
  {
    id: "inspector",
    label: "Inspector",
    description: "UI Bridge element inspection",
    icon: React.createElement(ScanSearch, { className: "size-5" }),
    route: "/tools/inspector",
    color: "var(--brand-secondary)",
    productMode: "ai",
  },
  {
    id: "review",
    label: "Review",
    description: "UI Bridge full project review",
    icon: React.createElement(ScanSearch, { className: "size-5" }),
    route: "/build/review-workflow",
    color: "var(--brand-secondary)",
    productMode: "ai",
  },
  {
    id: "build-flow-designer",
    label: "Flow Designer",
    description: "AI-assisted workflow structure designer",
    icon: React.createElement(GitBranch, { className: "size-5" }),
    route: "/build/flow-designer",
    color: "var(--brand-secondary)",
    productMode: "ai",
  },
  {
    id: "observations",
    label: "Observations",
    description: "Browse cross-session knowledge with temporal filtering",
    icon: React.createElement(BookOpen, { className: "size-5" }),
    route: "/observations",
    color: "#8B5CF6",
    productMode: "ai",
  },

  // ===========================================================================
  // Visual Automation (visible in "visual" product mode)
  // Flattened as top-level items with group labels for the visual mode sidebar.
  // ===========================================================================
  {
    id: "visual-automation-monitor",
    label: "Monitor",
    description: "Real-time automation monitoring",
    icon: React.createElement(Monitor, { className: "size-5" }),
    route: "/monitor",
    color: "#10B981",
    productMode: "visual",
  },
  {
    id: "va-build",
    label: "GUI Build",
    icon: React.createElement(Network, { className: "size-5" }),
    route: "/automation-builder/states",
    color: "var(--brand-secondary)",
    productMode: "visual",
    group: "Build",
    children: [
      {
        id: "va-state-machine",
        label: "State Machine",
        description: "Define states and transitions",
        icon: React.createElement(Network, { className: "size-4" }),
        route: "/automation-builder/states",
        color: "var(--brand-secondary)",
        productMode: "visual",
      },
      {
        id: "va-workflows",
        label: "Workflows",
        description: "Create automation action sequences",
        icon: React.createElement(Workflow, { className: "size-4" }),
        route: "/automation-builder",
        color: "var(--brand-secondary)",
        productMode: "visual",
      },
      {
        id: "va-variables",
        label: "Variables",
        description: "Global configuration values",
        icon: React.createElement(Sliders, { className: "size-4" }),
        route: "/automation-builder/variables",
        color: "var(--brand-secondary)",
        productMode: "visual",
      },
      {
        id: "va-contexts",
        label: "AI Contexts",
        description: "Domain knowledge for AI tasks",
        icon: React.createElement(BookOpen, { className: "size-4" }),
        route: "/automation-builder/contexts",
        color: "var(--brand-secondary)",
        productMode: "visual",
      },
      {
        id: "va-marketplace",
        label: "Marketplace",
        description: "Community automation packages",
        icon: React.createElement(Store, { className: "size-4" }),
        route: "/marketplace",
        color: "var(--brand-secondary)",
        productMode: "visual",
      },
    ],
  },
  {
    id: "va-assets",
    label: "Assets",
    icon: React.createElement(ImageIcon, { className: "size-5" }),
    route: "/automation-builder/images",
    color: "#8B5CF6",
    productMode: "visual",
    children: [
      {
        id: "va-images",
        label: "Images",
        description: "Pattern image library",
        icon: React.createElement(ImageIcon, { className: "size-4" }),
        route: "/automation-builder/images",
        color: "#8B5CF6",
        productMode: "visual",
      },
      {
        id: "va-screenshots",
        label: "Screenshots",
        description: "Uploaded screenshots for pattern creation",
        icon: React.createElement(Camera, { className: "size-4" }),
        route: "/automation-builder/screenshots",
        color: "#8B5CF6",
        productMode: "visual",
      },
      {
        id: "va-recordings",
        label: "Recordings",
        description: "Video recordings for state discovery",
        icon: React.createElement(Video, { className: "size-4" }),
        route: "/recordings",
        color: "#8B5CF6",
        productMode: "visual",
      },
      {
        id: "va-visual-index",
        label: "Visual Index",
        description: "Indexed elements for visual search",
        icon: React.createElement(Database, { className: "size-4" }),
        route: "/projects/:projectId/rag",
        color: "#8B5CF6",
        productMode: "visual",
      },
    ],
  },
  {
    id: "va-create",
    label: "Create",
    icon: React.createElement(Sparkles, { className: "size-5" }),
    route: "/automation-builder/image-extraction",
    color: "var(--brand-success)",
    productMode: "visual",
    children: [
      {
        id: "va-extract-images",
        label: "Extract Images",
        description: "Cut pattern images from screenshots",
        icon: React.createElement(Scissors, { className: "size-4" }),
        route: "/automation-builder/image-extraction",
        color: "var(--brand-success)",
        productMode: "visual",
      },
      {
        id: "va-pattern-extraction",
        label: "Pattern Extraction",
        description: "Extract robust patterns from screenshots",
        icon: React.createElement(Sparkles, { className: "size-4" }),
        route: "/automation-builder/pattern-optimization",
        color: "var(--brand-success)",
        productMode: "visual",
      },
      {
        id: "va-annotations",
        label: "Annotations",
        description: "Create regions and locations for states",
        icon: React.createElement(Scan, { className: "size-4" }),
        route: "/automation-builder/annotations",
        color: "var(--brand-success)",
        productMode: "visual",
      },
      {
        id: "va-template-capture",
        label: "Template Capture",
        description: "Click-to-template element detection",
        icon: React.createElement(Target, { className: "size-4" }),
        route: "/automation-builder/template-capture",
        color: "var(--brand-success)",
        productMode: "visual",
      },
    ],
  },
  {
    id: "va-discover",
    label: "Discover",
    icon: React.createElement(Search, { className: "size-5" }),
    route: "/automation-builder/snapshot-tests",
    color: "#4ECDC4",
    productMode: "visual",
    children: [
      {
        id: "va-snapshot-tests",
        label: "Snapshot Tests",
        description: "Generate tests from page snapshot",
        icon: React.createElement(Camera, { className: "size-4" }),
        route: "/automation-builder/snapshot-tests",
        color: "#10b981",
        productMode: "visual",
      },
      {
        id: "va-navigation-tests",
        label: "Navigation Tests",
        description: "Generate tests from exploration",
        icon: React.createElement(GitBranch, { className: "size-4" }),
        route: "/automation-builder/navigation-tests",
        color: "#10b981",
        productMode: "visual",
      },
      {
        id: "va-discover-states",
        label: "Discover States",
        description: "Automatically discover UI states",
        icon: React.createElement(Search, { className: "size-4" }),
        route: "/automation-builder/state-discovery",
        color: "#4ECDC4",
        productMode: "visual",
      },
      {
        id: "va-extraction",
        label: "Discover",
        description: "Discover states from web, desktop, or render logs",
        icon: React.createElement(Globe, { className: "size-4" }),
        route: "/automation-builder/extraction",
        color: "#4ECDC4",
        productMode: "visual",
      },
      {
        id: "va-capture",
        label: "Capture",
        description: "Record user interactions for automation replay",
        icon: React.createElement(Video, { className: "size-4" }),
        route: "/tools/capture",
        color: "#EF4444",
        productMode: "visual",
      },
    ],
  },
  {
    id: "va-config-testing",
    label: "Config Testing",
    icon: React.createElement(CheckCircle2, { className: "size-5" }),
    route: "/automation-builder/pattern-tests",
    color: "#FF6B6B",
    productMode: "visual",
    group: "Test",
    children: [
      {
        id: "va-pattern-tests",
        label: "Pattern Tests",
        description: "Test pattern recognition accuracy",
        icon: React.createElement(Target, { className: "size-4" }),
        route: "/automation-builder/pattern-tests",
        color: "#FF6B6B",
        productMode: "visual",
      },
      {
        id: "va-integration-tests",
        label: "Integration Tests",
        description: "End-to-end workflow testing",
        icon: React.createElement(TestTube2, { className: "size-4" }),
        route: "/integration-testing",
        color: "#FF6B6B",
        productMode: "visual",
      },
      {
        id: "va-semantic-analysis",
        label: "Semantic Analysis",
        description: "Analyze UI element semantics",
        icon: React.createElement(Scan, { className: "size-4" }),
        route: "/automation-builder/semantic-analysis",
        color: "#FF6B6B",
        productMode: "visual",
      },
      {
        id: "va-rag-testing",
        label: "RAG Testing",
        description: "Test RAG element matching with SAM3/CLIP",
        icon: React.createElement(Target, { className: "size-4" }),
        route: "/automation-builder/rag-testing",
        color: "#FF6B6B",
        productMode: "visual",
      },
      {
        id: "va-workflow-runner",
        label: "Workflow Runner",
        description: "Execute and debug workflows",
        icon: React.createElement(Play, { className: "size-4" }),
        route: "/workflow-viz",
        color: "#FF6B6B",
        productMode: "visual",
      },
      {
        id: "va-captures",
        label: "Captures",
        description: "Execution recordings with input events",
        icon: React.createElement(Camera, { className: "size-4" }),
        route: "/captures",
        color: "#FF6B6B",
        productMode: "visual",
      },
    ],
  },
  {
    id: "va-qa-testing",
    label: "QA Testing",
    icon: React.createElement(TestTube2, { className: "size-5" }),
    route: "/qa-dashboard",
    color: "#F59E0B",
    productMode: "visual",
    children: [
      {
        id: "va-qa-dashboard",
        label: "Dashboard",
        description: "QA testing overview and metrics",
        icon: React.createElement(LayoutDashboard, {
          className: "size-4",
        }),
        route: "/qa-dashboard",
        color: "#F59E0B",
        productMode: "visual",
      },
      {
        id: "va-test-runs",
        label: "Test Runs",
        description: "View test execution history",
        icon: React.createElement(Play, { className: "size-4" }),
        route: "/testing",
        color: "#F59E0B",
        productMode: "visual",
      },
      {
        id: "va-qa-runs",
        label: "QA Runs",
        description: "QA test run history",
        icon: React.createElement(TestTube2, { className: "size-4" }),
        route: "/qa-dashboard/runs",
        color: "#F59E0B",
        productMode: "visual",
      },
      {
        id: "va-coverage",
        label: "Coverage",
        description: "Test coverage analysis",
        icon: React.createElement(BarChart3, { className: "size-4" }),
        route: "/qa-dashboard/coverage",
        color: "#F59E0B",
        productMode: "visual",
      },
      {
        id: "va-deficiencies",
        label: "Deficiencies",
        description: "Track testing deficiencies",
        icon: React.createElement(Target, { className: "size-4" }),
        route: "/qa-dashboard/deficiencies",
        color: "#F59E0B",
        productMode: "visual",
      },
      {
        id: "va-compare",
        label: "Compare",
        description: "Compare test results",
        icon: React.createElement(GitBranch, { className: "size-4" }),
        route: "/qa-dashboard/compare",
        color: "#F59E0B",
        productMode: "visual",
      },
      {
        id: "va-execution-history",
        label: "Execution History",
        description: "View detailed execution tree events",
        icon: React.createElement(Play, { className: "size-4" }),
        route: "/execution-history",
        color: "#F59E0B",
        productMode: "visual",
      },
    ],
  },
  {
    id: "va-ai-tasks",
    label: "AI Tasks",
    icon: React.createElement(Sparkles, { className: "size-5" }),
    route: "/ai-tasks",
    color: "#9333EA",
    productMode: "visual",
    group: "Tools",
    children: [
      {
        id: "va-ai-tasks-list",
        label: "All Tasks",
        description: "View all AI analysis tasks",
        icon: React.createElement(Sparkles, { className: "size-4" }),
        route: "/ai-tasks",
        color: "#9333EA",
        productMode: "visual",
      },
    ],
  },
  {
    id: "va-project-tools",
    label: "Project Tools",
    icon: React.createElement(Box, { className: "size-5" }),
    route: "/automation-builder/overview",
    color: "var(--brand-primary)",
    productMode: "visual",
    children: [
      {
        id: "va-overview",
        label: "Overview",
        description: "Project summary and quick access",
        icon: React.createElement(LayoutDashboard, {
          className: "size-4",
        }),
        route: "/automation-builder/overview",
        color: "var(--brand-primary)",
        productMode: "visual",
      },
      {
        id: "va-dependencies",
        label: "Dependencies",
        description: "View state and workflow relationships",
        icon: React.createElement(GitBranch, { className: "size-4" }),
        route: "/automation-builder/dependencies",
        color: "var(--brand-primary)",
        productMode: "visual",
      },
      {
        id: "va-documentation",
        label: "Documentation",
        description: "Auto-generated project docs",
        icon: React.createElement(FileText, { className: "size-4" }),
        route: "/automation-builder/documentation",
        color: "var(--brand-primary)",
        productMode: "visual",
      },
      {
        id: "va-automation-analytics",
        label: "Automation Analytics",
        description: "Performance metrics and insights",
        icon: React.createElement(BarChart3, { className: "size-4" }),
        route: "/automation-builder/analytics",
        color: "var(--brand-primary)",
        productMode: "visual",
      },
      {
        id: "va-issues",
        label: "Issues",
        description: "Track and manage project issues",
        icon: React.createElement(AlertCircle, { className: "size-4" }),
        route: "/issues",
        color: "var(--brand-primary)",
        productMode: "visual",
      },
    ],
  },

  // ===========================================================================
  // Admin (superuser only)
  // ===========================================================================
  {
    id: "admin",
    label: "Admin",
    icon: React.createElement(Settings, { className: "size-5" }),
    route: "/admin",
    color: "#FF6B6B",
    adminOnly: true,
    group: "Admin",
    children: [
      {
        id: "admin-dashboard",
        label: "Dashboard",
        description: "Admin overview and metrics",
        icon: React.createElement(LayoutDashboard, { className: "size-4" }),
        route: "/admin",
        color: "#FF6B6B",
        adminOnly: true,
      },
    ],
  },
];
