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
} from "lucide-react";
import type { NavItem } from "./types";

// =============================================================================
// Dev-only and admin-only navigation items.
//
// Production items come from qontinui-navigation shared package
// via shared-nav-adapter.ts. Only dev-only and admin items remain here.
// =============================================================================

export const devNavItems: NavItem[] = [
  // ===========================================================================
  // NOTE: there is no local "Co-Pilot" nav item. Home IS the co-pilot — the
  // shared `@qontinui/navigation` registry's `prompt-home` item ("Home", route
  // `/prompt-home`) renders the co-pilot command surface directly, matching the
  // runner (where prompt-home/Home IS the co-pilot). `/co-pilot` redirects to
  // `/prompt-home` for legacy bookmarks.
  // ===========================================================================

  // ===========================================================================
  // Runners (production-visible). The unified /runners page covers online
  // runners, session history, and auth tokens — Phase 4B folded the old
  // /runners/fleet page into here.
  // ===========================================================================
  {
    id: "runner-fleet",
    label: "Runners",
    description: "Online runners, session history, and auth tokens",
    icon: React.createElement(Server, { className: "size-5" }),
    route: "/runners",
    color: "#10B981",
    group: "Coordination",
  },

  // Download the Qontinui Runner desktop app. Points at the in-app /download
  // page (resolves the latest release dynamically). The public marketing
  // header links /runner/download; the app shell had no download entry until
  // this item, so a logged-in user could not reach the installer from the menu.
  {
    id: "download-runner",
    label: "Download Runner",
    description: "Download the Qontinui Runner desktop app",
    icon: React.createElement(Download, { className: "size-5" }),
    route: "/download",
    color: "#10B981",
    group: "Coordination",
  },

  // NOTE: there is no top-level "Operations" item. The cross-machine fleet
  // view + operations panels were merged into the Coord Console's Fleet tab
  // (/admin/coord/fleet); /operations redirects there.
  {
    id: "commits",
    label: "Commits",
    description: "Which session produced which commit",
    icon: React.createElement(GitCommitHorizontal, { className: "size-5" }),
    route: "/commits",
    color: "#10B981",
    group: "Coordination",
  },
  // Coord Console — the coordination-layer surface (fleet, trees, pull
  // decisions, plans; the old Operations fleet view folded into its Fleet tab).
  // VISIBLE TO ALL authenticated users: the /admin/coord pages are viewable by
  // any tenant member (layout guard relaxed in 5a02ee3d), with mutation
  // controls gated per-control via <CoordAdminOnly>. Not adminOnly, so it sits
  // in the Coordination block (pre-SYSTEM) and stays a single group header.
  {
    id: "admin-coord",
    label: "Coord Console",
    description: "Coordination layer — fleet, trees, pull decisions, plans",
    icon: React.createElement(Network, { className: "size-5" }),
    route: "/admin/coord",
    color: "#10B981",
    group: "Coordination",
  },
  // Scheduled Runs — cron-style workflow dispatches. Advanced/automation (gated
  // behind the "Show advanced automation features" toggle on web); kept out of
  // the Coordination block so it never splits that group's header.
  {
    id: "scheduled-runs",
    label: "Scheduled Runs",
    description: "Cron-style workflow dispatches",
    icon: React.createElement(CalendarClock, { className: "size-5" }),
    route: "/scheduled-runs",
    color: "#0EA5E9",
    group: "Automation",
  },
  // Regression Tests — condition groups (natural-language checks) run on demand
  // or on a schedule against a target URL. Visible to any authenticated user;
  // talks to the always-registered httpClient via the `/api/v1/conditions/*`
  // backend proxy.
  {
    id: "conditions",
    label: "Regression Tests",
    description: "Condition groups run on demand or on a schedule",
    icon: React.createElement(ListChecks, { className: "size-5" }),
    route: "/conditions",
    color: "#0EA5E9",
    group: "Automation",
  },

  // ===========================================================================
  // Digital Twin — completeness matrix over the coordination-layer observers.
  // Visualizes how complete the twin is + the per-observer credibility envelope
  // (the same information AI agents receive). Coord-backed like Operations.
  // ===========================================================================
  {
    id: "digital-twin",
    label: "Digital Twin",
    description: "Twin completeness + observer credibility",
    icon: React.createElement(Boxes, { className: "size-5" }),
    route: "/digital-twin",
    color: "#6366F1",
    group: "Runners",
  },

  // ===========================================================================
  // Environments — digital-twin management surface. Register applications +
  // machines, define environments, designate a CANONICAL machine, and view
  // per-machine config DRIFT vs canonical. User-JWT scoped (devenv API).
  // ===========================================================================
  {
    id: "environments",
    label: "Environments",
    description: "Applications, machines, and config drift vs canonical",
    icon: React.createElement(Server, { className: "size-5" }),
    route: "/environments",
    color: "#6366F1",
    group: "Runners",
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
    id: "state-machine-dev",
    label: "State Machine",
    description: "UI Bridge state machine builder",
    icon: React.createElement(Network, { className: "size-5" }),
    route: "/automation-builder/ui-bridge-states",
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
    id: "visual-automation-execute",
    label: "Execute",
    description: "GUI automation control surface",
    icon: React.createElement(Play, { className: "size-5" }),
    route: "/tools/visual-automation",
    color: "#10B981",
    productMode: "visual",
    group: "Run",
  },
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
  // AI-Dev Coordination (member-visible — Developers view the coord layer)
  // ===========================================================================
  {
    id: "ai-dev-coordination",
    label: "AI-Dev Coordination",
    description: "Coordination layer — fleet, plans, gates, merge queue",
    icon: React.createElement(Network, { className: "size-5" }),
    route: "/admin/coord",
    color: "#06B6D4",
    group: "Runners",
    // No adminOnly: any authenticated member can reach the coord pages;
    // mutation controls are gated on coord_is_admin per-page.
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
      // (Coord Console moved out to a top-level Coordination item, visible to
      // all — see above. Its pages are viewable by any tenant member; mutations
      // stay admin-gated via <CoordAdminOnly>.)
    ],
  },
];
