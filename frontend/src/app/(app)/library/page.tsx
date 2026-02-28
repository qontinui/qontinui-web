"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Terminal,
  BookOpen,
  Code2,
  FileCode,
  TestTube2,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useChecksList,
  useShellCommandsList,
  useContextsList,
} from "@/hooks/useLibrary";
import {
  usePlaywrightTestsList,
  useRunnerPromptSnippetsList,
  useTestsList,
} from "@/components/builders/hooks/useRunnerEntity";

// =============================================================================
// Library Categories
// =============================================================================

const libraryTypes = [
  {
    name: "Playwright Tests",
    description:
      "Playwright browser automation tests for testing and interaction.",
    href: "/build/playwright-tests",
    icon: FileCode,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    countKey: "playwrightTests" as const,
  },
  {
    name: "Tests",
    description:
      "Automated tests including Playwright, Python, and vision-based testing.",
    href: "/build/tests",
    icon: TestTube2,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    countKey: "tests" as const,
  },
  {
    name: "Checks",
    description:
      "Verification checks and check groups for linting, formatting, and more.",
    href: "/build/checks",
    icon: ShieldCheck,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    countKey: "checks" as const,
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
    name: "Contexts",
    description: "AI context documents for domain knowledge and instructions.",
    href: "/build/contexts",
    icon: BookOpen,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    countKey: "contexts" as const,
  },
  {
    name: "Prompt Snippets",
    description:
      "Reusable prompt snippets for inline logic and data transformations.",
    href: "/build/playwright-tests",
    icon: Code2,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    countKey: "promptSnippets" as const,
  },
];

// =============================================================================
// Page
// =============================================================================

export default function LibraryPage() {
  // Fetch counts from all sources
  const { data: checks } = useChecksList();
  const { data: shellCommands } = useShellCommandsList();
  const { data: contexts } = useContextsList();
  const { data: playwrightTests } = usePlaywrightTestsList();
  const { data: promptSnippets } = useRunnerPromptSnippetsList();
  const { data: tests } = useTestsList();

  const counts: Record<string, number> = {
    playwrightTests: playwrightTests?.length ?? 0,
    tests: tests?.length ?? 0,
    checks: checks?.length ?? 0,
    shellCommands: shellCommands?.length ?? 0,
    contexts: contexts?.length ?? 0,
    promptSnippets: promptSnippets?.length ?? 0,
  };

  const totalItems = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Step Library</h1>
        <Badge variant="outline" className="text-sm tabular-nums">
          {totalItems} total items
        </Badge>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {/* Category Grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {libraryTypes.map((item) => {
            const Icon = item.icon;
            const count = counts[item.countKey] ?? 0;

            return (
              <Link key={item.name} href={item.href}>
                <Card className="h-full transition-all hover:bg-muted cursor-pointer border-border bg-background">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex size-10 items-center justify-center rounded-lg ${item.bgColor} shrink-0`}
                      >
                        <Icon className={`size-5 ${item.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">
                            {item.name}
                          </h3>
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 tabular-nums"
                          >
                            {count}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
