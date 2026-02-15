"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Layers,
  Terminal,
  Globe,
  BookOpen,
  Zap,
  Code2,
  Library,
  FileCode,
  TestTube2,
  ArrowRight,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useChecksList,
  useCheckGroupsList,
  useShellCommandsList,
  useApiRequestsList,
  useContextsList,
  useMacrosList,
} from "@/hooks/useLibrary";
import {
  useScriptsList,
  useRunnerScriptletsList,
  useTestsList,
} from "@/components/builders/hooks/useRunnerEntity";

// =============================================================================
// Library Categories
// =============================================================================

const libraryTypes = [
  {
    name: "Scripts",
    description: "Playwright browser automation scripts for testing and interaction.",
    href: "/build/scripts",
    icon: FileCode,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    countKey: "scripts" as const,
  },
  {
    name: "Tests",
    description: "Automated tests including Playwright, Python, and vision-based testing.",
    href: "/build/tests",
    icon: TestTube2,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    countKey: "tests" as const,
  },
  {
    name: "Checks",
    description: "Verification checks for linting, formatting, type checking, and more.",
    href: "/build/checks",
    icon: ShieldCheck,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    countKey: "checks" as const,
  },
  {
    name: "Check Groups",
    description: "Organized collections of checks that run together as a suite.",
    href: "/build/check-groups",
    icon: Layers,
    color: "text-teal-400",
    bgColor: "bg-teal-500/10",
    countKey: "checkGroups" as const,
  },
  {
    name: "Shell Commands",
    description: "Reusable shell commands for system-level automation tasks.",
    href: "/build/shell-commands",
    icon: Terminal,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    countKey: "shellCommands" as const,
  },
  {
    name: "API Requests",
    description: "Saved HTTP requests for interacting with APIs and services.",
    href: "/build/api-requests",
    icon: Globe,
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    countKey: "apiRequests" as const,
  },
  {
    name: "Contexts",
    description: "AI context documents for domain knowledge and instructions.",
    href: "/build/contexts",
    icon: BookOpen,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    countKey: "contexts" as const,
  },
  {
    name: "Macros",
    description: "Sequential action macros combining clicks, keystrokes, and navigation.",
    href: "/build/macros",
    icon: Zap,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    countKey: "macros" as const,
  },
  {
    name: "Scriptlets",
    description: "Reusable code snippets for inline logic and data transformations.",
    href: "/build/scriptlets",
    icon: Code2,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    countKey: "scriptlets" as const,
  },
];

// =============================================================================
// Page
// =============================================================================

export default function LibraryPage() {
  // Fetch counts from all sources
  const { data: checks } = useChecksList();
  const { data: checkGroups } = useCheckGroupsList();
  const { data: shellCommands } = useShellCommandsList();
  const { data: apiRequests } = useApiRequestsList();
  const { data: contexts } = useContextsList();
  const { data: macros } = useMacrosList();
  const { data: scripts } = useScriptsList();
  const { data: scriptlets } = useRunnerScriptletsList();
  const { data: tests } = useTestsList();

  const counts: Record<string, number> = {
    scripts: scripts?.length ?? 0,
    tests: tests?.length ?? 0,
    checks: checks?.length ?? 0,
    checkGroups: checkGroups?.length ?? 0,
    shellCommands: shellCommands?.length ?? 0,
    apiRequests: apiRequests?.length ?? 0,
    contexts: contexts?.length ?? 0,
    macros: macros?.length ?? 0,
    scriptlets: scriptlets?.length ?? 0,
  };

  const totalItems = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Library className="size-8 text-text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Library</h1>
          <p className="text-sm text-text-muted">
            Manage reusable automation components
          </p>
        </div>
        <Badge variant="outline" className="text-sm tabular-nums">
          {totalItems} total items
        </Badge>
      </div>

      {/* Category Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {libraryTypes.map((item) => {
          const Icon = item.icon;
          const count = counts[item.countKey] ?? 0;

          return (
            <Link key={item.name} href={item.href}>
              <Card className="h-full transition-all hover:border-border-subtle hover:bg-surface-raised/40 cursor-pointer border-border-subtle/50 bg-surface-raised/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex size-10 items-center justify-center rounded-lg ${item.bgColor} shrink-0`}>
                      <Icon className={`size-5 ${item.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-text-primary">{item.name}</h3>
                        <Badge variant="secondary" className="text-[10px] px-1.5 tabular-nums">
                          {count}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-muted mt-1 line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                    <ArrowRight className="size-4 text-text-muted shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
