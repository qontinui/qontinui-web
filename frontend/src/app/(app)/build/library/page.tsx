"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  usePlaywrightScripts,
  useSavedApiRequests,
  useChecks,
  useContexts,
  useScripts,
  useShellCommands,
  usePrompts,
  useMacros,
  type LibraryItem,
} from "@/lib/runner-api";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Library,
  Search,
  Filter,
  Clock,
  Workflow,
  TestTube2,
  Globe,
  CheckSquare,
  Brain,
  FileCode,
  Terminal,
  MessageSquare,
  Package,
  Zap,
} from "lucide-react";

type AssetType =
  | "all"
  | "workflow"
  | "test"
  | "api-request"
  | "check"
  | "context"
  | "script"
  | "shell-command"
  | "prompt"
  | "macro";

const TYPE_CONFIG: Record<
  Exclude<AssetType, "all">,
  { label: string; icon: React.ElementType; color: string }
> = {
  workflow: { label: "Workflow", icon: Workflow, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  test: { label: "Test", icon: TestTube2, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  "api-request": { label: "API Request", icon: Globe, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  check: { label: "Check", icon: CheckSquare, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  context: { label: "Context", icon: Brain, color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  script: { label: "Script", icon: FileCode, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  "shell-command": { label: "Shell Command", icon: Terminal, color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  prompt: { label: "Prompt", icon: MessageSquare, color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  macro: { label: "Macro", icon: Zap, color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getBuilderRoute(assetType: string): string | null {
  const routes: Record<string, string> = {
    workflow: "/build/workflows",
    test: "/build/tests",
    "api-request": "/build/api-requests",
    check: "/build/checks",
    context: "/build/contexts",
    script: "/build/scripts",
    "shell-command": "/build/shell-commands",
    prompt: "/build/scripts",
    macro: "/build/macros",
  };
  return routes[assetType] ?? null;
}

export default function LibraryPage() {
  const router = useRouter();
  const workflows = useUnifiedWorkflows();
  const tests = usePlaywrightScripts();
  const apiRequests = useSavedApiRequests();
  const checks = useChecks();
  const contexts = useContexts();
  const scripts = useScripts();
  const shellCommands = useShellCommands();
  const prompts = usePrompts();
  const macros = useMacros();

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType>("all");

  const isOffline =
    workflows.isOffline ||
    tests.isOffline ||
    apiRequests.isOffline ||
    checks.isOffline ||
    contexts.isOffline;

  const isLoading =
    workflows.isLoading &&
    tests.isLoading &&
    apiRequests.isLoading &&
    checks.isLoading &&
    contexts.isLoading &&
    scripts.isLoading &&
    shellCommands.isLoading &&
    prompts.isLoading &&
    macros.isLoading;

  const allItems = useMemo(() => {
    const items: (LibraryItem & { assetType: Exclude<AssetType, "all"> })[] = [];

    if (workflows.data) {
      workflows.data.forEach((w) =>
        items.push({
          id: w.id,
          name: w.name,
          type: "workflow",
          description: w.description,
          updated_at: w.modified_at,
          created_at: w.created_at,
          assetType: "workflow",
        })
      );
    }

    const sources: {
      data: LibraryItem[] | null;
      assetType: Exclude<AssetType, "all">;
    }[] = [
      { data: tests.data, assetType: "test" },
      { data: apiRequests.data, assetType: "api-request" },
      { data: checks.data?.map(c => ({ ...c, type: "check" })) ?? null, assetType: "check" },
      { data: contexts.data, assetType: "context" },
      { data: scripts.data, assetType: "script" },
      { data: shellCommands.data?.map(c => ({ ...c, type: "shell-command" })) ?? null, assetType: "shell-command" },
      { data: prompts.data, assetType: "prompt" },
      { data: macros.data, assetType: "macro" },
    ];

    for (const source of sources) {
      if (source.data) {
        source.data.forEach((item) =>
          items.push({ ...item, assetType: source.assetType })
        );
      }
    }

    return items;
  }, [
    workflows.data,
    tests.data,
    apiRequests.data,
    checks.data,
    contexts.data,
    scripts.data,
    shellCommands.data,
    prompts.data,
    macros.data,
  ]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of allItems) {
      counts[item.assetType] = (counts[item.assetType] ?? 0) + 1;
    }
    return counts;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (typeFilter !== "all") {
      items = items.filter((item) => item.assetType === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q))
      );
    }
    return items;
  }, [allItems, typeFilter, searchQuery]);

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Library className="w-6 h-6 text-brand-primary" />
            <h1 className="text-2xl font-bold text-text-primary">
              Asset Library
            </h1>
            <Badge variant="secondary">{allItems.length} items</Badge>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
            <Input
              placeholder="Search across all assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-surface-raised/50 border-border-subtle"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-text-muted" />
            <div className="flex flex-wrap gap-1">
              <Button
                variant={typeFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter("all")}
              >
                All
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                  {allItems.length}
                </Badge>
              </Button>
              {(Object.keys(TYPE_CONFIG) as Exclude<AssetType, "all">[]).map(
                (type) => {
                  const count = typeCounts[type] ?? 0;
                  if (count === 0) return null;
                  const config = TYPE_CONFIG[type];
                  return (
                    <Button
                      key={type}
                      variant={typeFilter === type ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTypeFilter(type)}
                    >
                      <config.icon className="size-3" />
                      {config.label}
                      <Badge
                        variant="secondary"
                        className="ml-1 text-[10px] px-1.5"
                      >
                        {count}
                      </Badge>
                    </Button>
                  );
                }
              )}
            </div>
          </div>
        </div>

        {/* Item List */}
        {isLoading ? (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-28 w-full bg-surface-raised/50 rounded-lg"
              />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-12 text-center">
              <Package className="w-12 h-12 mx-auto mb-3 text-text-muted" />
              <h3 className="text-lg font-medium text-text-secondary mb-1">
                {searchQuery || typeFilter !== "all"
                  ? "No matching assets"
                  : "No assets yet"}
              </h3>
              <p className="text-sm text-text-muted">
                {searchQuery
                  ? "Try a different search term or filter"
                  : "Create workflows, tests, and other assets to see them here."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => {
              const config = TYPE_CONFIG[item.assetType];
              const TypeIcon = config.icon;
              return (
                <Card
                  key={`${item.assetType}-${item.id}`}
                  className="bg-surface-raised/50 border-border-subtle/50 cursor-pointer transition-all hover:border-brand-primary/40 hover:bg-surface-raised/80"
                  onClick={() => {
                    const route = getBuilderRoute(item.assetType);
                    if (route) {
                      router.push(`${route}?id=${item.id}`);
                    }
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${config.color}`}
                        >
                          <TypeIcon className="size-4" />
                        </div>
                        <h3 className="font-medium text-text-primary truncate text-sm">
                          {item.name}
                        </h3>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${config.color}`}
                      >
                        {config.label}
                      </Badge>
                    </div>
                    {item.description && (
                      <p className="text-xs text-text-muted line-clamp-2 mb-2">
                        {item.description}
                      </p>
                    )}
                    {(item.updated_at || item.created_at) && (
                      <div className="flex items-center gap-1 text-xs text-text-muted">
                        <Clock className="size-3" />
                        {formatDate(item.updated_at || item.created_at)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div data-content-role="status" data-content-label="filtered items count" className="mt-4 text-sm text-text-muted text-center">
          {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
          {searchQuery && ` matching "${searchQuery}"`}
          {typeFilter !== "all" && ` in ${TYPE_CONFIG[typeFilter].label}`}
        </div>
      </main>
    </div>
  );
}
