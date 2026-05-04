"use client";

import { useRouter } from "next/navigation";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import {
  Layers,
  TestTube2,
  FileCode,
  CheckCircle2,
  Terminal,
  BookOpen,
  FileText,
  Compass,
  ArrowRight,
} from "lucide-react";

// =============================================================================
// Builder Definitions
// =============================================================================

interface BuilderCard {
  id: string;
  title: string;
  description: string;
  route: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  devOnly?: boolean;
}

const BUILDERS: BuilderCard[] = [
  // ---------------------------------------------------------------------------
  // Launch-ready (always visible)
  // ---------------------------------------------------------------------------
  {
    id: "tests",
    title: "Tests",
    description:
      "Python script and repository tests with AI generation and execution",
    route: "/build/tests",
    icon: TestTube2,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
  },
  {
    id: "checks",
    title: "Checks",
    description:
      "Verification checks and check groups for linting, formatting, type checking, and security",
    route: "/build/checks",
    icon: CheckCircle2,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/20",
  },
  {
    id: "playwright-tests",
    title: "Playwright Tests",
    description:
      "Playwright browser test scripts with AI generation and live execution",
    route: "/build/playwright-tests",
    icon: FileCode,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  {
    id: "shell-commands",
    title: "Shell Commands",
    description:
      "Reusable shell commands for build, deploy, git, and system tasks",
    route: "/build/shell-commands",
    icon: Terminal,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/20",
  },
  {
    id: "contexts",
    title: "Contexts",
    description:
      "AI context documents that provide domain knowledge to workflow prompts",
    route: "/build/contexts",
    icon: BookOpen,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/20",
  },
  {
    id: "tasks",
    title: "Tasks",
    description:
      "AI task prompts that define what the agent should accomplish in a step",
    route: "/build/tasks",
    icon: FileText,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
  },

  // ---------------------------------------------------------------------------
  // Dev-only (hidden in production)
  // ---------------------------------------------------------------------------
  {
    id: "state-explorer",
    title: "State Explorer",
    description:
      "Configure and launch AI-driven UI state exploration sessions",
    route: "/build/state-explorer",
    icon: Compass,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/20",
    devOnly: true,
  },
];

// =============================================================================
// Builder Card Component
// =============================================================================

function BuilderCardItem({
  builder,
  isDev,
  onClick,
}: {
  builder: BuilderCard;
  isDev: boolean;
  onClick: () => void;
}) {
  const Icon = builder.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-start gap-4 p-5 rounded-xl border ${builder.borderColor} bg-background hover:bg-muted/50 hover:border-opacity-60 text-left transition-all`}
    >
      <div
        className={`flex items-center justify-center w-10 h-10 rounded-lg border ${builder.borderColor} ${builder.bgColor} shrink-0`}
      >
        <Icon className={`w-5 h-5 ${builder.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {builder.title}
          </h3>
          {isDev && builder.devOnly && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
              Dev
            </span>
          )}
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {builder.description}
        </p>
      </div>
    </button>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function TemplatesPage() {
  const discoveredSpec = useDiscoveredSpec("templates");
  usePageSpecs(
    discoveredSpec ? { templates: discoveredSpec.config as SpecConfig } : {}
  );
  const router = useRouter();
  const isDev = process.env.NODE_ENV === "development";

  const launchReady = BUILDERS.filter((b) => !b.devOnly);
  const devOnly = BUILDERS.filter((b) => b.devOnly);
  const visibleDevOnly = isDev ? devOnly : [];

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">
            Step Builders
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Launch-ready cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {launchReady.map((builder) => (
            <BuilderCardItem
              key={builder.id}
              builder={builder}
              isDev={isDev}
              onClick={() => router.push(builder.route)}
            />
          ))}
        </div>

        {/* Dev-only section */}
        {visibleDevOnly.length > 0 && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border-subtle" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Development
              </span>
              <div className="h-px flex-1 bg-border-subtle" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {visibleDevOnly.map((builder) => (
                <BuilderCardItem
                  key={builder.id}
                  builder={builder}
                  isDev={isDev}
                  onClick={() => router.push(builder.route)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
