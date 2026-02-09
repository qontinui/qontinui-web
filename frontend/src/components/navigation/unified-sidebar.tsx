"use client";

import * as React from "react";
import { useState, useCallback, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Workflow,
  Network,
  Sparkles,
  CheckCircle2,
  Settings,
  FileText,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
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
  Server,
  Link,
  Store,
  CreditCard,
  TestTube2,
  LogOut,
  Download,
  Upload,
  Database,
  BarChart3,
  AlertCircle,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  History,
  Activity,
  Bug,
  TrendingUp,
  Brain,
  Flag,
  Terminal,
  Layers,
  ListChecks,
  Wrench,
  Eye,
  Calendar,
  FileCode,
  Webhook,
  Library,
  ScanSearch,
  Zap,
  Code2,
  Bot,
  ShieldCheck,
  FlaskConical,
  Wifi,
  FolderOpen,
  HardDrive,
  Archive,
  Compass,
  Clock,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OrganizationSwitcher } from "@/components/collaboration/OrganizationSwitcher";
import { CreateOrganizationDialog } from "@/components/collaboration/CreateOrganizationDialog";
import { useOrganization } from "@/contexts/organization-context";
import { useSidebar } from "@/contexts/sidebar-context";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useAutomationStore } from "@/stores/automation";
import { useProjects, useCreateProject } from "@/hooks/use-projects";
import { toast } from "sonner";
import { ConfigImporter } from "@/lib/config-importer";
import { getProjectLoader } from "@/lib/project";
import { ProjectExportDialog } from "@/components/automation-builder/components/ProjectExportDialog";
import { useTutorialStore } from "@/stores/tutorial-store";
import { getTutorialById } from "@/components/tutorial/data";

// =============================================================================
// Types
// =============================================================================

interface NavItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  route: string;
  color: string;
  children?: NavItem[];
  badge?: "beta" | "experimental";
  adminOnly?: boolean;
  hidden?: boolean;
}

// =============================================================================
// Navigation Items
// =============================================================================

// =============================================================================
// Runner-Focused Navigation (primary)
// =============================================================================

const navItems: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="size-5" />,
    route: "/dashboard",
    color: "var(--brand-primary)",
  },
  {
    id: "build",
    label: "Build",
    icon: <Layers className="size-5" />,
    route: "/build/workflows",
    color: "var(--brand-secondary)",
    children: [
      {
        id: "build-workflows",
        label: "Workflows",
        description: "Unified workflow editor",
        icon: <Workflow className="size-4" />,
        route: "/build/workflows",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-library",
        label: "Library",
        description: "Cross-category asset browser",
        icon: <Library className="size-4" />,
        route: "/build/library",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-tests",
        label: "Tests",
        description: "Playwright test builder",
        icon: <TestTube2 className="size-4" />,
        route: "/build/tests",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-api-requests",
        label: "API Requests",
        description: "API request step editor",
        icon: <Globe className="size-4" />,
        route: "/build/api-requests",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-checks",
        label: "Checks",
        description: "Verification check editor",
        icon: <CheckCircle2 className="size-4" />,
        route: "/build/checks",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-contexts",
        label: "Contexts",
        description: "AI context authoring",
        icon: <BookOpen className="size-4" />,
        route: "/build/contexts",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-scripts",
        label: "Scripts",
        description: "Python script editor",
        icon: <FileCode className="size-4" />,
        route: "/build/scripts",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-shell-commands",
        label: "Shell Commands",
        description: "Shell command editor",
        icon: <Terminal className="size-4" />,
        route: "/build/shell-commands",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-macros",
        label: "Macros",
        description: "Sequential action macros",
        icon: <Zap className="size-4" />,
        route: "/build/macros",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-scriptlets",
        label: "Scriptlets",
        description: "Reusable code snippets",
        icon: <Code2 className="size-4" />,
        route: "/build/scriptlets",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-flow-designer",
        label: "Flow Designer",
        description: "AI-assisted workflow structure designer",
        icon: <GitBranch className="size-4" />,
        route: "/build/flow-designer",
        color: "var(--brand-secondary)",
        hidden: true,
      },
      {
        id: "build-awas",
        label: "AWAS",
        description: "Web Action Standards explorer",
        icon: <Webhook className="size-4" />,
        route: "/build/awas",
        color: "var(--brand-secondary)",
        hidden: true,
      },
      {
        id: "build-discover",
        label: "Discover",
        description: "AI-powered workflow generation",
        icon: <Sparkles className="size-4" />,
        route: "/build/discover",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-review",
        label: "Review",
        description: "UI Bridge full project review",
        icon: <ScanSearch className="size-4" />,
        route: "/build/review-workflow",
        color: "var(--brand-secondary)",
      },
      {
        id: "build-run-plan",
        label: "Run Plan",
        description: "Plan/schedule executions",
        icon: <Calendar className="size-4" />,
        route: "/build/run-plan",
        color: "var(--brand-secondary)",
      },
    ],
  },
  {
    id: "execute",
    label: "Execute",
    icon: <Play className="size-5" />,
    route: "/execute",
    color: "#10B981",
  },
  {
    id: "runs",
    label: "Runs",
    icon: <History className="size-5" />,
    route: "/runs",
    color: "#4A90D9",
    children: [
      {
        id: "runs-history",
        label: "History",
        description: "Run history browser",
        icon: <History className="size-4" />,
        route: "/runs",
        color: "#4A90D9",
      },
      {
        id: "runs-active",
        label: "Active",
        description: "Live monitoring dashboard",
        icon: <Activity className="size-4" />,
        route: "/runs/active",
        color: "#4A90D9",
      },
      {
        id: "runs-findings",
        label: "Findings",
        description: "Cross-run findings",
        icon: <Bug className="size-4" />,
        route: "/runs/findings",
        color: "#4A90D9",
      },
      {
        id: "runs-statistics",
        label: "Statistics",
        description: "Performance analytics",
        icon: <TrendingUp className="size-4" />,
        route: "/runs/statistics",
        color: "#4A90D9",
      },
      {
        id: "runs-learning",
        label: "Learning",
        description: "ML insights dashboard",
        icon: <Brain className="size-4" />,
        route: "/runs/learning",
        color: "#4A90D9",
      },
      {
        id: "runs-checkpoints",
        label: "Checkpoints",
        description: "Execution checkpoint browser",
        icon: <Flag className="size-4" />,
        route: "/runs/checkpoints",
        color: "#4A90D9",
      },
      {
        id: "runs-discoveries",
        label: "Discoveries",
        description: "GUI state exploration results",
        icon: <Compass className="size-4" />,
        route: "/runs/discoveries",
        color: "#4A90D9",
      },
    ],
  },
  {
    id: "runners",
    label: "Runners",
    icon: <Server className="size-5" />,
    route: "/runners",
    color: "#10B981",
    children: [
      {
        id: "runner-list",
        label: "Manage",
        description: "View and configure your runners",
        icon: <Server className="size-4" />,
        route: "/runners",
        color: "#10B981",
      },
      {
        id: "connect-runner",
        label: "Connect",
        description: "Connect a new desktop runner",
        icon: <Link className="size-4" />,
        route: "/connect-runner",
        color: "#10B981",
      },
      {
        id: "monitor",
        label: "Monitor",
        description: "Real-time runner monitoring",
        icon: <Monitor className="size-4" />,
        route: "/monitor",
        color: "#10B981",
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: <Wrench className="size-5" />,
    route: "/tools/error-monitor",
    color: "#F59E0B",
    children: [
      {
        id: "tools-error-monitor",
        label: "Error Monitor",
        description: "Log error monitoring",
        icon: <AlertCircle className="size-4" />,
        route: "/tools/error-monitor",
        color: "#F59E0B",
      },
      {
        id: "tools-inspector",
        label: "Inspector",
        description: "UI & accessibility inspector",
        icon: <ScanSearch className="size-4" />,
        route: "/tools/inspector",
        color: "#F59E0B",
      },
      {
        id: "tools-capture",
        label: "Capture",
        description: "Screen capture and recording",
        icon: <Video className="size-4" />,
        route: "/tools/capture",
        color: "#F59E0B",
      },
    ],
  },
  {
    id: "configure",
    label: "Configure",
    icon: <Sliders className="size-5" />,
    route: "/configure/log-sources",
    color: "#8B5CF6",
    children: [
      {
        id: "configure-log-sources",
        label: "Log Sources",
        description: "Log file monitoring config",
        icon: <FileText className="size-4" />,
        route: "/configure/log-sources",
        color: "#8B5CF6",
      },
      {
        id: "configure-finding-rules",
        label: "Finding Rules",
        description: "Finding categories & rules",
        icon: <ListChecks className="size-4" />,
        route: "/configure/finding-rules",
        color: "#8B5CF6",
      },
      {
        id: "configure-hooks",
        label: "Hooks",
        description: "Workflow lifecycle hooks",
        icon: <Webhook className="size-4" />,
        route: "/configure/hooks",
        color: "#8B5CF6",
      },
    ],
  },
  // ===========================================================================
  // Visual Automation (hidden in production, visible in dev mode)
  // Preserves the pre-refactor sidebar structure for GUI automation pages.
  // ===========================================================================
  {
    id: "visual-automation",
    label: "Visual Automation",
    icon: <Eye className="size-5" />,
    route: "/automation-builder/states",
    color: "#06B6D4",
    hidden: true,
    children: [
      {
        id: "visual-automation-execute",
        label: "Execute",
        description: "GUI automation control surface",
        icon: <Play className="size-4" />,
        route: "/tools/visual-automation",
        color: "#10B981",
        hidden: true,
      },
      {
        id: "va-build",
        label: "GUI Build",
        icon: <Network className="size-4" />,
        route: "/automation-builder/states",
        color: "var(--brand-secondary)",
        hidden: true,
        children: [
          {
            id: "va-state-machine",
            label: "State Machine",
            description: "Define states and transitions",
            icon: <Network className="size-4" />,
            route: "/automation-builder/states",
            color: "var(--brand-secondary)",
            hidden: true,
          },
          {
            id: "va-workflows",
            label: "Workflows",
            description: "Create automation action sequences",
            icon: <Workflow className="size-4" />,
            route: "/automation-builder",
            color: "var(--brand-secondary)",
            hidden: true,
          },
          {
            id: "va-variables",
            label: "Variables",
            description: "Global configuration values",
            icon: <Sliders className="size-4" />,
            route: "/automation-builder/variables",
            color: "var(--brand-secondary)",
            hidden: true,
          },
          {
            id: "va-contexts",
            label: "AI Contexts",
            description: "Domain knowledge for AI tasks",
            icon: <BookOpen className="size-4" />,
            route: "/automation-builder/contexts",
            color: "var(--brand-secondary)",
            hidden: true,
          },
          {
            id: "va-marketplace",
            label: "Marketplace",
            description: "Community automation packages",
            icon: <Store className="size-4" />,
            route: "/marketplace",
            color: "var(--brand-secondary)",
            hidden: true,
          },
        ],
      },
      {
        id: "va-assets",
        label: "Assets",
        icon: <ImageIcon className="size-4" />,
        route: "/automation-builder/images",
        color: "#8B5CF6",
        hidden: true,
        children: [
          {
            id: "va-images",
            label: "Images",
            description: "Pattern image library",
            icon: <ImageIcon className="size-4" />,
            route: "/automation-builder/images",
            color: "#8B5CF6",
            hidden: true,
          },
          {
            id: "va-screenshots",
            label: "Screenshots",
            description: "Uploaded screenshots for pattern creation",
            icon: <Camera className="size-4" />,
            route: "/automation-builder/screenshots",
            color: "#8B5CF6",
            hidden: true,
          },
          {
            id: "va-recordings",
            label: "Recordings",
            description: "Video recordings for state discovery",
            icon: <Video className="size-4" />,
            route: "/recordings",
            color: "#8B5CF6",
            hidden: true,
          },
          {
            id: "va-visual-index",
            label: "Visual Index",
            description: "Indexed elements for visual search",
            icon: <Database className="size-4" />,
            route: "/projects/:projectId/rag",
            color: "#8B5CF6",
            hidden: true,
          },
        ],
      },
      {
        id: "va-create",
        label: "Create",
        icon: <Sparkles className="size-4" />,
        route: "/automation-builder/image-extraction",
        color: "var(--brand-success)",
        hidden: true,
        children: [
          {
            id: "va-extract-images",
            label: "Extract Images",
            description: "Cut pattern images from screenshots",
            icon: <Scissors className="size-4" />,
            route: "/automation-builder/image-extraction",
            color: "var(--brand-success)",
            hidden: true,
          },
          {
            id: "va-pattern-extraction",
            label: "Pattern Extraction",
            description: "Extract robust patterns from screenshots",
            icon: <Sparkles className="size-4" />,
            route: "/automation-builder/pattern-optimization",
            color: "var(--brand-success)",
            hidden: true,
          },
          {
            id: "va-annotations",
            label: "Annotations",
            description: "Create regions and locations for states",
            icon: <Scan className="size-4" />,
            route: "/automation-builder/annotations",
            color: "var(--brand-success)",
            hidden: true,
          },
          {
            id: "va-template-capture",
            label: "Template Capture",
            description: "Click-to-template element detection",
            icon: <Target className="size-4" />,
            route: "/automation-builder/template-capture",
            color: "var(--brand-success)",
            hidden: true,
          },
        ],
      },
      {
        id: "va-discover",
        label: "Discover",
        icon: <Search className="size-4" />,
        route: "/automation-builder/snapshot-tests",
        color: "#4ECDC4",
        hidden: true,
        children: [
          {
            id: "va-snapshot-tests",
            label: "Snapshot Tests",
            description: "Generate tests from page snapshot",
            icon: <Camera className="size-4" />,
            route: "/automation-builder/snapshot-tests",
            color: "#10b981",
            hidden: true,
          },
          {
            id: "va-navigation-tests",
            label: "Navigation Tests",
            description: "Generate tests from exploration",
            icon: <GitBranch className="size-4" />,
            route: "/automation-builder/navigation-tests",
            color: "#10b981",
            hidden: true,
          },
          {
            id: "va-discover-states",
            label: "Discover States",
            description: "Automatically discover UI states",
            icon: <Search className="size-4" />,
            route: "/automation-builder/state-discovery",
            color: "#4ECDC4",
            hidden: true,
          },
          {
            id: "va-extraction",
            label: "Discover",
            description: "Discover states from web, desktop, or render logs",
            icon: <Globe className="size-4" />,
            route: "/automation-builder/extraction",
            color: "#4ECDC4",
            hidden: true,
          },
        ],
      },
      {
        id: "va-config-testing",
        label: "Config Testing",
        icon: <CheckCircle2 className="size-4" />,
        route: "/automation-builder/pattern-tests",
        color: "#FF6B6B",
        hidden: true,
        children: [
          {
            id: "va-pattern-tests",
            label: "Pattern Tests",
            description: "Test pattern recognition accuracy",
            icon: <Target className="size-4" />,
            route: "/automation-builder/pattern-tests",
            color: "#FF6B6B",
            hidden: true,
          },
          {
            id: "va-integration-tests",
            label: "Integration Tests",
            description: "End-to-end workflow testing",
            icon: <TestTube2 className="size-4" />,
            route: "/integration-testing",
            color: "#FF6B6B",
            hidden: true,
          },
          {
            id: "va-semantic-analysis",
            label: "Semantic Analysis",
            description: "Analyze UI element semantics",
            icon: <Scan className="size-4" />,
            route: "/automation-builder/semantic-analysis",
            color: "#FF6B6B",
            hidden: true,
          },
          {
            id: "va-rag-testing",
            label: "RAG Testing",
            description: "Test RAG element matching with SAM3/CLIP",
            icon: <Target className="size-4" />,
            route: "/automation-builder/rag-testing",
            color: "#FF6B6B",
            hidden: true,
          },
          {
            id: "va-workflow-runner",
            label: "Workflow Runner",
            description: "Execute and debug workflows",
            icon: <Play className="size-4" />,
            route: "/workflow-viz",
            color: "#FF6B6B",
            hidden: true,
          },
          {
            id: "va-captures",
            label: "Captures",
            description: "Execution recordings with input events",
            icon: <Camera className="size-4" />,
            route: "/captures",
            color: "#FF6B6B",
            hidden: true,
          },
        ],
      },
      {
        id: "va-qa-testing",
        label: "QA Testing",
        icon: <TestTube2 className="size-4" />,
        route: "/qa-dashboard",
        color: "#F59E0B",
        hidden: true,
        children: [
          {
            id: "va-qa-dashboard",
            label: "Dashboard",
            description: "QA testing overview and metrics",
            icon: <LayoutDashboard className="size-4" />,
            route: "/qa-dashboard",
            color: "#F59E0B",
            hidden: true,
          },
          {
            id: "va-test-runs",
            label: "Test Runs",
            description: "View test execution history",
            icon: <Play className="size-4" />,
            route: "/testing",
            color: "#F59E0B",
            hidden: true,
          },
          {
            id: "va-qa-runs",
            label: "QA Runs",
            description: "QA test run history",
            icon: <TestTube2 className="size-4" />,
            route: "/qa-dashboard/runs",
            color: "#F59E0B",
            hidden: true,
          },
          {
            id: "va-coverage",
            label: "Coverage",
            description: "Test coverage analysis",
            icon: <BarChart3 className="size-4" />,
            route: "/qa-dashboard/coverage",
            color: "#F59E0B",
            hidden: true,
          },
          {
            id: "va-deficiencies",
            label: "Deficiencies",
            description: "Track testing deficiencies",
            icon: <Target className="size-4" />,
            route: "/qa-dashboard/deficiencies",
            color: "#F59E0B",
            hidden: true,
          },
          {
            id: "va-compare",
            label: "Compare",
            description: "Compare test results",
            icon: <GitBranch className="size-4" />,
            route: "/qa-dashboard/compare",
            color: "#F59E0B",
            hidden: true,
          },
          {
            id: "va-execution-history",
            label: "Execution History",
            description: "View detailed execution tree events",
            icon: <Play className="size-4" />,
            route: "/execution-history",
            color: "#F59E0B",
            hidden: true,
          },
        ],
      },
      {
        id: "va-ai-tasks",
        label: "AI Tasks",
        icon: <Sparkles className="size-4" />,
        route: "/ai-tasks",
        color: "#9333EA",
        hidden: true,
        children: [
          {
            id: "va-ai-tasks-list",
            label: "All Tasks",
            description: "View all AI analysis tasks",
            icon: <Sparkles className="size-4" />,
            route: "/ai-tasks",
            color: "#9333EA",
            hidden: true,
          },
        ],
      },
      {
        id: "va-project-tools",
        label: "Project Tools",
        icon: <Box className="size-4" />,
        route: "/automation-builder/overview",
        color: "var(--brand-primary)",
        hidden: true,
        children: [
          {
            id: "va-overview",
            label: "Overview",
            description: "Project summary and quick access",
            icon: <LayoutDashboard className="size-4" />,
            route: "/automation-builder/overview",
            color: "var(--brand-primary)",
            hidden: true,
          },
          {
            id: "va-dependencies",
            label: "Dependencies",
            description: "View state and workflow relationships",
            icon: <GitBranch className="size-4" />,
            route: "/automation-builder/dependencies",
            color: "var(--brand-primary)",
            hidden: true,
          },
          {
            id: "va-documentation",
            label: "Documentation",
            description: "Auto-generated project docs",
            icon: <FileText className="size-4" />,
            route: "/automation-builder/documentation",
            color: "var(--brand-primary)",
            hidden: true,
          },
          {
            id: "va-automation-analytics",
            label: "Automation Analytics",
            description: "Performance metrics and insights",
            icon: <BarChart3 className="size-4" />,
            route: "/automation-builder/analytics",
            color: "var(--brand-primary)",
            hidden: true,
          },
          {
            id: "va-issues",
            label: "Issues",
            description: "Track and manage project issues",
            icon: <AlertCircle className="size-4" />,
            route: "/issues",
            color: "var(--brand-primary)",
            hidden: true,
          },
        ],
      },
      {
        id: "va-settings",
        label: "Settings",
        icon: <Settings className="size-4" />,
        route: "/automation-builder/settings",
        color: "#FFD700",
        hidden: true,
        children: [
          {
            id: "va-automation-settings",
            label: "Automation",
            description: "Configure automation preferences",
            icon: <Sliders className="size-4" />,
            route: "/automation-builder/settings",
            color: "#FFD700",
            hidden: true,
          },
          {
            id: "va-profile",
            label: "Profile",
            description: "Manage your account settings",
            icon: <Settings className="size-4" />,
            route: "/profile",
            color: "#FFD700",
            hidden: true,
          },
          {
            id: "va-pricing",
            label: "Pricing",
            description: "View plans and billing",
            icon: <CreditCard className="size-4" />,
            route: "/pricing",
            color: "#FFD700",
            hidden: true,
          },
        ],
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings className="size-5" />,
    route: "/settings",
    color: "#FFD700",
    children: [
      {
        id: "settings-account",
        label: "Account",
        description: "Connection and identity",
        icon: <Settings className="size-4" />,
        route: "/settings/account",
        color: "#FFD700",
      },
      {
        id: "settings-ai",
        label: "AI Providers",
        description: "AI provider configuration",
        icon: <Bot className="size-4" />,
        route: "/settings/ai",
        color: "#FFD700",
      },
      {
        id: "settings-agentic",
        label: "Advanced AI",
        description: "Memory, retry, routing",
        icon: <Brain className="size-4" />,
        route: "/settings/agentic",
        color: "#FFD700",
      },
      {
        id: "settings-self-healing",
        label: "Self-Healing",
        description: "Automation recovery",
        icon: <ShieldCheck className="size-4" />,
        route: "/settings/self-healing",
        color: "#FFD700",
      },
      {
        id: "settings-playwright",
        label: "Playwright",
        description: "Test configuration",
        icon: <FlaskConical className="size-4" />,
        route: "/settings/playwright",
        color: "#FFD700",
      },
      {
        id: "settings-mcp",
        label: "MCP Servers",
        description: "External tool servers",
        icon: <Wifi className="size-4" />,
        route: "/settings/mcp",
        color: "#FFD700",
      },
      {
        id: "settings-log-sources",
        label: "Log Sources",
        description: "Global log configuration",
        icon: <FolderOpen className="size-4" />,
        route: "/settings/log-sources",
        color: "#FFD700",
      },
      {
        id: "settings-general",
        label: "General",
        description: "Application preferences",
        icon: <Wrench className="size-4" />,
        route: "/settings/general",
        color: "#FFD700",
      },
      {
        id: "settings-storage",
        label: "Storage",
        description: "Local file management",
        icon: <HardDrive className="size-4" />,
        route: "/settings/storage",
        color: "#FFD700",
      },
      {
        id: "settings-backup",
        label: "Backup",
        description: "Export and restore data",
        icon: <Archive className="size-4" />,
        route: "/settings/backup",
        color: "#FFD700",
      },
      {
        id: "settings-updates",
        label: "Updates",
        description: "Version and updates",
        icon: <Download className="size-4" />,
        route: "/settings/updates",
        color: "#FFD700",
      },
      {
        id: "settings-debug",
        label: "Debug",
        description: "Diagnostics and debug",
        icon: <FlaskConical className="size-4" />,
        route: "/settings/debug",
        color: "#FFD700",
      },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: <Clock className="size-5" />,
    route: "/schedule",
    color: "#06B6D4",
  },
  {
    id: "help",
    label: "Help",
    icon: <HelpCircle className="size-5" />,
    route: "/help",
    color: "#9CA3AF",
  },
  {
    id: "admin",
    label: "Admin",
    icon: <Settings className="size-5" />,
    route: "/admin",
    color: "#FF6B6B",
    adminOnly: true,
    children: [
      {
        id: "admin-dashboard",
        label: "Dashboard",
        description: "Admin overview and metrics",
        icon: <LayoutDashboard className="size-4" />,
        route: "/admin",
        color: "#FF6B6B",
        adminOnly: true,
      },
      {
        id: "admin-annotations",
        label: "Annotations",
        description: "Manage training data annotations",
        icon: <Scan className="size-4" />,
        route: "/admin/annotations",
        color: "#FF6B6B",
        adminOnly: true,
      },
      {
        id: "admin-analysis",
        label: "GUI Analysis",
        description: "Analyze GUI elements globally",
        icon: <Search className="size-4" />,
        route: "/admin/analysis",
        color: "#FF6B6B",
        adminOnly: true,
      },
    ],
  },
];

// =============================================================================
// Project Switcher Component
// =============================================================================

interface ProjectSwitcherProps {
  isCollapsed: boolean;
  projects: Array<{ id: string; name: string }>;
  currentProject: { id: string; name: string } | null;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  loading?: boolean;
}

function ProjectSwitcher({
  isCollapsed,
  projects,
  currentProject,
  onProjectChange,
  onCreateProject,
  loading,
}: ProjectSwitcherProps) {
  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-md px-2 py-2",
          isCollapsed && "justify-center px-0"
        )}
      >
        <div className="flex size-8 shrink-0 animate-pulse items-center justify-center rounded-md bg-surface-hover" />
        {!isCollapsed && (
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-4 w-24 animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-16 animate-pulse rounded bg-surface-hover" />
          </div>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-tutorial-id="sidebar-project-switcher"
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors hover:bg-surface-hover",
            isCollapsed && "justify-center px-0"
          )}
        >
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor: "var(--brand-secondary)",
              color: "white",
            }}
          >
            <Workflow className="size-4" />
          </div>
          {!isCollapsed && (
            <>
              <div className="flex flex-1 flex-col items-start text-left">
                <span className="font-semibold text-text-primary">
                  {currentProject?.name || "Select Project"}
                </span>
                <span className="text-xs text-text-muted">
                  {projects.length} project{projects.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ChevronsUpDown className="size-4 shrink-0 text-text-muted" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => onProjectChange(project.id)}
            className={cn(
              currentProject?.id === project.id && "bg-surface-hover"
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex size-8 items-center justify-center rounded-md"
                style={{
                  backgroundColor: "var(--brand-secondary)",
                  color: "white",
                }}
              >
                <Workflow className="size-4" />
              </div>
              <span className="font-medium">{project.name}</span>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onCreateProject}
          data-tutorial-id="sidebar-create-project"
        >
          <div className="flex items-center gap-2 text-text-muted">
            <span>+ Create new project</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// Search Trigger Component
// =============================================================================

function SearchTrigger({ isCollapsed }: { isCollapsed: boolean }) {
  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary">
            <Search className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Search</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      data-tutorial-id="sidebar-search"
      className="flex h-9 w-full items-center gap-2 rounded-md border border-border-subtle bg-surface-canvas px-3 text-sm text-text-muted transition-colors hover:border-border-default hover:bg-surface-hover"
    >
      <Search className="size-4" />
      <span>Search...</span>
      <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border border-border-subtle bg-surface-canvas px-1.5 font-mono text-[10px] font-medium text-text-muted sm:flex">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );
}

// =============================================================================
// Navigation Item Button Component
// =============================================================================

interface NavItemButtonProps {
  item: NavItem;
  isCollapsed: boolean;
  isActive?: boolean;
  onClick?: () => void;
  mounted?: boolean;
}

function NavItemButton({
  item,
  isCollapsed,
  isActive,
  onClick,
  mounted,
}: NavItemButtonProps) {
  const content = (
    <button
      onClick={onClick}
      data-nav-id={item.id}
      data-tutorial-id={`nav-${item.id}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
        isActive
          ? "bg-surface-hover font-medium text-text-primary"
          : "text-text-muted hover:bg-surface-hover hover:text-text-primary",
        isCollapsed && "justify-center"
      )}
    >
      <span style={{ color: isActive ? item.color : undefined }}>
        {item.icon}
      </span>
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left">{item.label}</span>
          {mounted && item.hidden && (
            <Badge
              variant="outline"
              className="ml-auto h-5 px-1.5 text-[10px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
            >
              hidden
            </Badge>
          )}
          {item.badge && (
            <Badge
              variant="outline"
              className={cn(
                "ml-auto h-5 px-1.5 text-[10px] font-medium",
                item.badge === "beta" &&
                  "border-amber-500/30 bg-amber-500/10 text-amber-400",
                item.badge === "experimental" &&
                  "border-purple-500/30 bg-purple-500/10 text-purple-400"
              )}
            >
              {item.badge}
            </Badge>
          )}
        </>
      )}
    </button>
  );

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {item.label}
          {item.badge && (
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {item.badge}
            </Badge>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

// =============================================================================
// Nested Sub-Group Component (third level)
// =============================================================================

function NestedSubGroup({
  item,
  onNavigate,
  isRouteActive,
  mounted,
}: {
  item: NavItem;
  onNavigate: (route: string) => void;
  isRouteActive: (route: string, item: NavItem) => boolean;
  mounted: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isGroupActive = item.children?.some((child) =>
    isRouteActive(child.route, child)
  );

  React.useEffect(() => {
    if (isGroupActive) setIsOpen(true);
  }, [isGroupActive]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            isGroupActive
              ? "text-text-primary"
              : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
          )}
        >
          <span style={{ color: isGroupActive ? item.color : undefined }}>
            {item.icon}
          </span>
          <span className="flex-1 font-medium">{item.label}</span>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border-subtle pl-3 pt-0.5">
          {item.children?.map((grandchild) => {
            const isActive = isRouteActive(grandchild.route, grandchild);
            return (
              <button
                key={grandchild.id}
                onClick={() => onNavigate(grandchild.route)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                  isActive
                    ? "bg-surface-hover text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
                )}
              >
                <span
                  style={{ color: isActive ? grandchild.color : undefined }}
                >
                  {grandchild.icon}
                </span>
                <span className="flex-1">{grandchild.label}</span>
                {mounted && grandchild.hidden && (
                  <Badge
                    variant="outline"
                    className="h-3.5 px-1 text-[8px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
                  >
                    hidden
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// Collapsible Navigation Item Component
// =============================================================================

interface CollapsibleNavItemProps {
  item: NavItem;
  isCollapsed: boolean;
  onNavigate: (route: string) => void;
  isRouteActive: (route: string, item: NavItem) => boolean;
  mounted: boolean;
}

function CollapsibleNavItem({
  item,
  isCollapsed,
  onNavigate,
  isRouteActive,
  mounted,
}: CollapsibleNavItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isParentActive = isRouteActive(item.route, item);

  // Helper: check if any descendant is active (supports grandchildren)
  const isAnyDescendantActive = useCallback(
    (children?: NavItem[]): boolean => {
      if (!children) return false;
      return children.some(
        (child) =>
          isRouteActive(child.route, child) ||
          isAnyDescendantActive(child.children)
      );
    },
    [isRouteActive]
  );

  // Auto-open if any child or grandchild is active
  React.useEffect(() => {
    if (isAnyDescendantActive(item.children)) {
      setIsOpen(true);
    }
  }, [item.children, isAnyDescendantActive]);

  if (isCollapsed) {
    // Flatten children + grandchildren for collapsed dropdown
    const flatItems: NavItem[] = [];
    item.children?.forEach((child) => {
      if (child.children && child.children.length > 0) {
        flatItems.push(...child.children);
      } else {
        flatItems.push(child);
      }
    });

    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                data-nav-id={item.id}
                data-tutorial-id={`nav-${item.id}`}
                className={cn(
                  "flex size-10 items-center justify-center rounded-md transition-colors",
                  isParentActive
                    ? "bg-surface-hover text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
                )}
              >
                <span
                  style={{ color: isParentActive ? item.color : undefined }}
                >
                  {item.icon}
                </span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="w-56">
          {item.children?.map((child) =>
            child.children && child.children.length > 0 ? (
              <React.Fragment key={child.id}>
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-xs font-semibold text-text-muted">
                  {child.label}
                </div>
                {child.children.map((grandchild) => (
                  <DropdownMenuItem
                    key={grandchild.id}
                    onClick={() => onNavigate(grandchild.route)}
                    className={cn(
                      isRouteActive(grandchild.route, grandchild) &&
                        "bg-surface-hover"
                    )}
                  >
                    <span
                      className="mr-2"
                      style={{
                        color: isRouteActive(grandchild.route, grandchild)
                          ? grandchild.color
                          : undefined,
                      }}
                    >
                      {grandchild.icon}
                    </span>
                    {grandchild.label}
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            ) : (
              <DropdownMenuItem
                key={child.id}
                onClick={() => onNavigate(child.route)}
                className={cn(
                  isRouteActive(child.route, child) && "bg-surface-hover"
                )}
              >
                <span
                  className="mr-2"
                  style={{
                    color: isRouteActive(child.route, child)
                      ? child.color
                      : undefined,
                  }}
                >
                  {child.icon}
                </span>
                {child.label}
                {child.badge && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "ml-auto h-4 px-1 text-[10px]",
                      child.badge === "beta" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    )}
                  >
                    {child.badge}
                  </Badge>
                )}
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          data-nav-id={item.id}
          data-tutorial-id={`nav-${item.id}`}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
            isParentActive
              ? "bg-surface-hover/50 text-text-primary"
              : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
          )}
        >
          <span style={{ color: isParentActive ? item.color : undefined }}>
            {item.icon}
          </span>
          <span className="flex-1 text-left">{item.label}</span>
          {mounted && item.hidden && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
            >
              hidden
            </Badge>
          )}
          <ChevronRight
            className={cn(
              "size-4 shrink-0 transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="ml-4 flex flex-col gap-0.5 border-l border-border-subtle pl-3 pt-1">
          {item.children?.map((child) => {
            // If child has its own children, render as a nested collapsible
            if (child.children && child.children.length > 0) {
              return (
                <NestedSubGroup
                  key={child.id}
                  item={child}
                  onNavigate={onNavigate}
                  isRouteActive={isRouteActive}
                  mounted={mounted}
                />
              );
            }
            const isChildActive = isRouteActive(child.route, child);
            return (
              <button
                key={child.id}
                onClick={() => onNavigate(child.route)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  isChildActive
                    ? "bg-surface-hover text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
                )}
              >
                <span
                  style={{ color: isChildActive ? child.color : undefined }}
                >
                  {child.icon}
                </span>
                <span className="flex-1">{child.label}</span>
                {mounted && child.hidden && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[9px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
                  >
                    hidden
                  </Badge>
                )}
                {child.badge && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-4 px-1 text-[9px] font-medium",
                      child.badge === "beta" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-400",
                      child.badge === "experimental" &&
                        "border-purple-500/30 bg-purple-500/10 text-purple-400"
                    )}
                  >
                    {child.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// User Menu Component
// =============================================================================

interface UserMenuProps {
  isCollapsed: boolean;
  user: { username?: string; email: string } | null;
  onLogout: () => void;
  onExport: () => void;
  onImport: () => void;
  onDocs: () => void;
}

function UserMenu({
  isCollapsed,
  user,
  onLogout,
  onExport,
  onImport,
  onDocs,
}: UserMenuProps) {
  if (!user) return null;

  const initials = user.username
    ? user.username.slice(0, 2).toUpperCase()
    : user.email.slice(0, 2).toUpperCase();

  if (isCollapsed) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="flex size-10 items-center justify-center rounded-md transition-colors hover:bg-surface-hover">
                <Avatar className="size-8">
                  <AvatarFallback
                    className="text-xs"
                    style={{
                      backgroundColor: "var(--brand-primary)",
                      color: "white",
                    }}
                  >
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Account</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.username || user.email}</p>
            <p className="text-xs text-text-muted">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onExport}>
            <Download className="mr-2 size-4" />
            Export Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImport}>
            <Upload className="mr-2 size-4" />
            Import Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDocs}>
            <FileText className="mr-2 size-4" />
            Documentation
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onLogout} className="text-error">
            <LogOut className="mr-2 size-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-tutorial-id="sidebar-user-menu"
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-hover"
        >
          <Avatar className="size-8">
            <AvatarFallback
              className="text-xs"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "white",
              }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col items-start text-left">
            <span className="text-sm font-medium text-text-primary">
              {user.username || user.email.split("@")[0]}
            </span>
            <span className="truncate text-xs text-text-muted">
              {user.email}
            </span>
          </div>
          <ChevronDown className="size-4 shrink-0 text-text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={onExport}>
          <Download className="mr-2 size-4" />
          Export Project
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport}>
          <Upload className="mr-2 size-4" />
          Import Project
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDocs}>
          <FileText className="mr-2 size-4" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="text-error">
          <LogOut className="mr-2 size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// Help/Tutorial Button
// =============================================================================

function HelpButton({ isCollapsed }: { isCollapsed: boolean }) {
  const openTutorial = useTutorialStore((s) => s.openTutorial);

  const handleStartTutorial = useCallback(() => {
    const tutorial = getTutorialById("getting-started-web");
    if (tutorial) {
      openTutorial(tutorial, "contextual");
    }
  }, [openTutorial]);

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleStartTutorial}
            data-tutorial-id="sidebar-help"
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <BookOpen className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Help &amp; Tutorials</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={handleStartTutorial}
      data-tutorial-id="sidebar-help"
      className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
    >
      <BookOpen className="size-4" />
      <span className="text-sm">Help &amp; Tutorials</span>
    </button>
  );
}

// =============================================================================
// Collapse Toggle Button
// =============================================================================

function CollapseToggle({
  isCollapsed,
  onToggle,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggle}
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={onToggle}
      className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
    >
      <PanelLeftClose className="size-4" />
      <span className="text-sm">Collapse</span>
    </button>
  );
}

// =============================================================================
// Main Unified Sidebar Component
// =============================================================================

interface UnifiedSidebarProps {
  className?: string;
  projectId?: string | null;
}

export const UnifiedSidebar: React.FC<UnifiedSidebarProps> = ({
  className,
  projectId: propProjectId,
}) => {
  const { user, logout, loading: authLoading } = useAuth();
  const { isCollapsed, setIsCollapsed } = useSidebar();
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Prevent hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const { currentOrganization, organizations, loading, switchOrganization } =
    useOrganization();

  // Project management
  const {
    projectId: contextProjectId,
    setProjectId: setContextProjectId,
    setProjectName,
    loadConfiguration,
  } = useAutomation();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const createProject = useCreateProject();

  // Import handler
  const importer = useMemo(() => new ConfigImporter(), []);

  const handleExport = useCallback(() => {
    if (!user) {
      toast.error("Please log in to export your project");
      return;
    }
    setShowExportDialog(true);
  }, [user]);

  const handleImport = useCallback(async () => {
    if (!user) {
      toast.error("Please log in to import a project");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const result = await importer.loadFromFile(file);

        if (result.errors.length > 0) {
          toast.error("Import failed", {
            description: result.errors.join(", "),
          });
          return;
        }

        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => {
            toast.warning("Import warning", { description: warning });
          });
        }

        loadConfiguration(result);

        const zustandStore = useAutomationStore.getState();
        await zustandStore.loadConfiguration({
          name: result.name,
          workflows: result.workflows,
          states: result.states,
          transitions: result.transitions,
          images: result.images,
          categories: result.categories,
          settings: result.settings,
        });

        toast.success("Import successful", {
          description: `Loaded ${result.states.length} states, ${result.workflows?.length || 0} workflows`,
        });
      } catch (error) {
        toast.error("Import failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };

    input.click();
  }, [user, importer, loadConfiguration]);

  const handleLogout = useCallback(async () => {
    logout();
    router.push("/");
    toast.success("Logged out successfully");
  }, [logout, router]);

  const handleDocs = useCallback(() => {
    router.push("/docs");
  }, [router]);

  // Get project ID from prop, URL params, or context
  const projectId =
    propProjectId ?? searchParams?.get("project") ?? contextProjectId ?? null;

  const currentProject = projects.find((p) => p.id === projectId) ?? null;

  const handleProjectChange = useCallback(
    async (newProjectId: string) => {
      const loader = getProjectLoader();
      const success = await loader.load(newProjectId, {
        currentProjectId: contextProjectId,
      });

      if (!success) {
        toast.error("Failed to load project");
        return;
      }

      const newProject = projects.find((p) => p.id === newProjectId);
      setContextProjectId(newProjectId);
      if (newProject) {
        setProjectName(newProject.name);
      }
      const url = new URL(window.location.href);
      url.searchParams.set("project", newProjectId);
      router.push(url.pathname + url.search);
    },
    [contextProjectId, projects, setContextProjectId, setProjectName, router]
  );

  const handleCreateProject = useCallback(async () => {
    try {
      const newProject = await createProject.mutateAsync({
        name: `New Automation ${new Date().toLocaleDateString()}`,
        description: "A new automation workflow",
        configuration: {},
      });
      handleProjectChange(newProject.id);
      toast.success("Project created successfully");
    } catch (error: unknown) {
      console.error("Failed to create project:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create project"
      );
    }
  }, [createProject, handleProjectChange]);

  // Filter nav items based on admin status and hidden flag
  const isDevelopment = process.env.NODE_ENV === "development";
  const filterNavItems = useCallback(
    (items: NavItem[]): NavItem[] => {
      return items
        .filter((item) => {
          // hidden items only show in development
          if (item.hidden && (!mounted || !isDevelopment)) return false;
          if (authLoading || !user) return !item.adminOnly;
          return !item.adminOnly || user.is_superuser === true;
        })
        .map((item) => ({
          ...item,
          children: item.children ? filterNavItems(item.children) : undefined,
        }))
        .filter((item) => !item.children || item.children.length > 0);
    },
    [mounted, isDevelopment, authLoading, user]
  );

  const visibleNavItems = useMemo(() => {
    return filterNavItems(navItems);
  }, [filterNavItems]);

  const toggleCollapse = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("unified-sidebar-collapsed", JSON.stringify(newState));
  }, [isCollapsed, setIsCollapsed]);

  const isRouteActive = useCallback(
    (route: string, item: NavItem): boolean => {
      const checkRouteMatch = (routeToCheck: string): boolean => {
        if (routeToCheck.includes("?")) {
          const [basePath, query] = routeToCheck.split("?");
          const queryParams = new URLSearchParams(query);
          const currentParams = searchParams;
          const baseMatch = pathname === basePath;
          const categoryMatch =
            queryParams.get("category") === currentParams.get("category");
          const tabMatch = queryParams.get("tab") === currentParams.get("tab");
          return baseMatch && categoryMatch && tabMatch;
        } else {
          const currentHasParams = searchParams.toString().length > 0;
          return pathname === routeToCheck && !currentHasParams;
        }
      };

      if (item.children && item.children.length > 0) {
        return item.children.some(
          (child) =>
            checkRouteMatch(child.route) ||
            (child.children &&
              child.children.some((gc) => checkRouteMatch(gc.route)))
        );
      }

      return checkRouteMatch(route);
    },
    [pathname, searchParams]
  );

  const buildRoute = useCallback(
    (route: string): string => {
      if (route.includes(":projectId")) {
        if (!projectId) return "/dashboard";
        return route.replace(":projectId", projectId);
      }

      if (!projectId) return route;

      if (route.includes("?")) {
        return `${route}&project=${projectId}`;
      } else {
        return `${route}?project=${projectId}`;
      }
    },
    [projectId]
  );

  const handleNavigation = useCallback(
    (route: string) => {
      router.push(buildRoute(route));
    },
    [router, buildRoute]
  );

  const handleOrganizationChange = useCallback(
    async (orgId: string) => {
      try {
        await switchOrganization(orgId);
      } catch (error) {
        console.error("[UnifiedSidebar] Failed to switch organization:", error);
      }
    },
    [switchOrganization]
  );

  const handleCreateOrganization = useCallback(() => {
    setShowCreateOrgDialog(true);
  }, []);

  // Convert organizations to expected format
  const switcherOrganizations = useMemo(
    () =>
      organizations.map((org) => ({
        id: org.id,
        name: org.name,
        avatar_url: undefined,
        member_count: org.member_count,
        role: (org.owner_id === user?.id ? "owner" : "member") as
          | "owner"
          | "admin"
          | "member"
          | "viewer",
      })),
    [organizations, user?.id]
  );

  const switcherCurrentOrg = useMemo(
    () =>
      currentOrganization
        ? {
            id: currentOrganization.id,
            name: currentOrganization.name,
            avatar_url: undefined,
            member_count: currentOrganization.member_count,
            role: (currentOrganization.owner_id === user?.id
              ? "owner"
              : "member") as "owner" | "admin" | "member" | "viewer",
          }
        : null,
    [currentOrganization, user?.id]
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-sidebar="true"
        data-tutorial-id="sidebar-main"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border-subtle bg-surface-canvas transition-all duration-200 ease-linear",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
      >
        {/* Top Gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-brand-primary/5 via-brand-secondary/5 to-transparent pointer-events-none" />

        {/* Header - Logo */}
        <div
          className={cn(
            "relative flex flex-col gap-3 p-3 border-b border-border-subtle",
            isCollapsed && "items-center"
          )}
        >
          {isCollapsed ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src="/q-logo.png" alt="Qontinui" className="h-10 w-auto" />
          ) : (
            <div className="flex items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/q-logo.png" alt="Qontinui" className="h-9 w-auto" />
              <span className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
                ontinui
              </span>
            </div>
          )}
        </div>

        {/* Organization Switcher */}
        {!isCollapsed && (
          <div className="px-3 pt-3 pb-2 border-b border-border-subtle">
            {mounted ? (
              <OrganizationSwitcher
                organizations={switcherOrganizations}
                currentOrganization={switcherCurrentOrg}
                onOrganizationChange={handleOrganizationChange}
                onCreateOrganization={handleCreateOrganization}
                loading={loading}
                className="bg-surface-raised/50 border-border-default hover:bg-surface-raised hover:border-border-default"
              />
            ) : (
              <div className="h-10 w-full rounded-md bg-surface-raised/50 border border-border-default animate-pulse" />
            )}
          </div>
        )}

        {/* Project Switcher + Search */}
        <div
          className={cn(
            "flex flex-col gap-3 p-3 border-b border-border-subtle",
            isCollapsed && "items-center"
          )}
        >
          {mounted ? (
            <ProjectSwitcher
              isCollapsed={isCollapsed}
              projects={projects}
              currentProject={currentProject}
              onProjectChange={handleProjectChange}
              onCreateProject={handleCreateProject}
              loading={projectsLoading}
            />
          ) : (
            <div
              className={cn(
                "h-10 rounded-md bg-surface-raised/50 animate-pulse",
                isCollapsed ? "w-10" : "w-full"
              )}
            />
          )}
          <SearchTrigger isCollapsed={isCollapsed} />
        </div>

        {/* Navigation Area */}
        <ScrollArea className="flex-1 px-3">
          <nav
            data-tutorial-id="sidebar-nav"
            className={cn(
              "flex flex-col gap-1 py-3",
              isCollapsed && "items-center"
            )}
          >
            {visibleNavItems.map((item) =>
              item.children ? (
                <CollapsibleNavItem
                  key={item.id}
                  item={item}
                  isCollapsed={isCollapsed}
                  onNavigate={handleNavigation}
                  isRouteActive={isRouteActive}
                  mounted={mounted}
                />
              ) : (
                <NavItemButton
                  key={item.id}
                  item={item}
                  isCollapsed={isCollapsed}
                  isActive={isRouteActive(item.route, item)}
                  onClick={() => handleNavigation(item.route)}
                  mounted={mounted}
                />
              )
            )}
          </nav>
        </ScrollArea>

        {/* Bottom Gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-brand-secondary/5 to-transparent pointer-events-none" />

        {/* Footer */}
        <div
          className={cn(
            "relative flex flex-col gap-2 border-t border-border-subtle p-3",
            isCollapsed && "items-center"
          )}
        >
          <HelpButton isCollapsed={isCollapsed} />
          <UserMenu
            isCollapsed={isCollapsed}
            user={user}
            onLogout={handleLogout}
            onExport={handleExport}
            onImport={handleImport}
            onDocs={handleDocs}
          />
          <CollapseToggle isCollapsed={isCollapsed} onToggle={toggleCollapse} />
        </div>
      </aside>

      {/* Dialogs */}
      <CreateOrganizationDialog
        open={showCreateOrgDialog}
        onOpenChange={setShowCreateOrgDialog}
      />
      <ProjectExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
      />
    </TooltipProvider>
  );
};
