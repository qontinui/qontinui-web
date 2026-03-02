import type { Checkpoint } from "@/lib/runner-api";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle,
  CheckSquare,
  Code,
  Eye,
  FileCode,
  FileSearch,
  FileType,
  Flag,
  GitBranch,
  Globe,
  List,
  MessageSquare,
  MousePointer2,
  Navigation,
  Package,
  Play,
  Search,
  Settings,
  Terminal,
  TestTube2,
} from "lucide-react";

export type WorkflowPhase = "setup" | "verification" | "agentic" | "completion";

export interface ParsedStepData {
  iconType?: string;
  workSummary?: string;
  summary?: string;
  error?: string;
  progress?: {
    current: number;
    total: number | null;
    type: string;
    description?: string;
  };
}

export interface StageData {
  phase: WorkflowPhase;
  displayName: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  steps: Checkpoint[];
  iteration: number | null;
}

export const PHASE_ORDER: Record<string, number> = {
  setup: 0,
  verification: 1,
  agentic: 2,
  completion: 3,
};

export const PHASE_LABELS: Record<WorkflowPhase, string> = {
  setup: "Setup",
  verification: "Verification",
  agentic: "Agentic",
  completion: "Completion",
};

export const PHASE_ICONS: Record<WorkflowPhase, LucideIcon> = {
  setup: Settings,
  verification: CheckSquare,
  agentic: Bot,
  completion: Flag,
};

export const PHASE_COLORS: Record<WorkflowPhase, { bg: string; text: string }> =
  {
    setup: { bg: "bg-blue-500/10", text: "text-blue-400" },
    verification: { bg: "bg-purple-500/10", text: "text-purple-400" },
    agentic: { bg: "bg-green-500/10", text: "text-green-400" },
    completion: { bg: "bg-teal-500/10", text: "text-teal-400" },
  };

export const STEP_TYPE_ICONS: Record<
  string,
  { icon: LucideIcon; bg: string; text: string }
> = {
  // AI steps
  ai_session: {
    icon: MessageSquare,
    bg: "bg-amber-500/10",
    text: "text-amber-400",
  },
  ai: { icon: MessageSquare, bg: "bg-amber-500/10", text: "text-amber-400" },
  ai_analysis: {
    icon: MessageSquare,
    bg: "bg-amber-500/10",
    text: "text-amber-400",
  },
  prompt: {
    icon: MessageSquare,
    bg: "bg-amber-500/10",
    text: "text-amber-400",
  },
  // Setup/scripting steps
  script: { icon: FileCode, bg: "bg-emerald-500/10", text: "text-emerald-400" },
  state: { icon: Navigation, bg: "bg-blue-500/10", text: "text-blue-400" },
  workflow: {
    icon: GitBranch,
    bg: "bg-purple-500/10",
    text: "text-purple-400",
  },
  workflow_ref: {
    icon: GitBranch,
    bg: "bg-purple-500/10",
    text: "text-purple-400",
  },
  // Interaction steps
  gui_action: {
    icon: MousePointer2,
    bg: "bg-orange-500/10",
    text: "text-orange-400",
  },
  action: {
    icon: MousePointer2,
    bg: "bg-orange-500/10",
    text: "text-orange-400",
  },
  automation: {
    icon: MousePointer2,
    bg: "bg-orange-500/10",
    text: "text-orange-400",
  },
  shell_command: {
    icon: Terminal,
    bg: "bg-gray-500/10",
    text: "text-gray-400",
  },
  shell: { icon: Terminal, bg: "bg-gray-500/10", text: "text-gray-400" },
  api_request: { icon: Globe, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  // Test steps
  test: { icon: TestTube2, bg: "bg-green-500/10", text: "text-green-400" },
  test_playwright: {
    icon: TestTube2,
    bg: "bg-green-500/10",
    text: "text-green-400",
  },
  playwright: {
    icon: TestTube2,
    bg: "bg-green-500/10",
    text: "text-green-400",
  },
  test_vision: { icon: Eye, bg: "bg-green-500/10", text: "text-green-400" },
  test_python: { icon: Code, bg: "bg-green-500/10", text: "text-green-400" },
  test_repository: {
    icon: Package,
    bg: "bg-green-500/10",
    text: "text-green-400",
  },
  // Check steps
  check: { icon: AlertTriangle, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  check_lint: {
    icon: AlertTriangle,
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
  },
  check_typecheck: {
    icon: FileType,
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
  },
  check_build: { icon: Package, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  check_group: {
    icon: CheckCircle,
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
  },
  check_ci_cd: {
    icon: GitBranch,
    bg: "bg-purple-500/10",
    text: "text-purple-400",
  },
  log_watch: { icon: FileSearch, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  error_resolved: {
    icon: CheckCircle,
    bg: "bg-green-500/10",
    text: "text-green-400",
  },
  // Other
  screenshot: { icon: Camera, bg: "bg-pink-500/10", text: "text-pink-400" },
  // AWAS step types
  awas_discover: { icon: Search, bg: "bg-teal-500/10", text: "text-teal-400" },
  awas_execute: { icon: Play, bg: "bg-teal-500/10", text: "text-teal-400" },
  awas_check_support: {
    icon: CheckCircle,
    bg: "bg-teal-500/10",
    text: "text-teal-400",
  },
  awas_list_actions: {
    icon: List,
    bg: "bg-teal-500/10",
    text: "text-teal-400",
  },
  awas_extract_elements: {
    icon: FileSearch,
    bg: "bg-teal-500/10",
    text: "text-teal-400",
  },
};

export const PROGRESS_COLORS: Record<string, { bar: string; text: string }> = {
  file_progress: { bar: "bg-blue-500", text: "text-blue-400" },
  analysis_progress: { bar: "bg-purple-500", text: "text-purple-400" },
  test_progress: { bar: "bg-green-500", text: "text-green-400" },
  review_progress: { bar: "bg-amber-500", text: "text-amber-400" },
  iteration_progress: { bar: "bg-cyan-500", text: "text-cyan-400" },
  default: { bar: "bg-text-muted", text: "text-text-muted" },
};
