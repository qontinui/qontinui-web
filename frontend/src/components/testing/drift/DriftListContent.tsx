"use client";

/**
 * DriftListContent — lists every `DriftEntry` for a run, grouped by `kind`.
 * Each row links to `/runs/[runId]/drift/[entryId]`.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  GitCompare,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchDriftReport,
  isSpecDrift,
  isVisualDrift,
  type DriftEntryView,
} from "./drift-api";
import { driftQueryKeys } from "./DriftEntryDetail";

const KIND_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  matcher: (entry: DriftEntryView) => boolean;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "visual",
    label: "Visual drift",
    matcher: isVisualDrift,
    icon: ImageIcon,
  },
  {
    key: "spec",
    label: "Semantic drift",
    matcher: isSpecDrift,
    icon: GitCompare,
  },
  {
    key: "other",
    label: "Other",
    matcher: (e) => !isVisualDrift(e) && !isSpecDrift(e),
    icon: HelpCircle,
  },
];

export interface DriftListContentProps {
  runId: string;
}

export function DriftListContent({ runId }: DriftListContentProps) {
  const router = useRouter();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: driftQueryKeys.byRun(runId),
    queryFn: () => fetchDriftReport(runId),
    staleTime: 30_000,
  });

  const groups = data
    ? KIND_GROUPS.map((g) => ({
        ...g,
        entries: data.entries.filter(g.matcher),
      })).filter((g) => g.entries.length > 0)
    : [];

  const totalCount = data?.entries.length ?? 0;

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/runs/${runId}`)}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="size-4 mr-1" />
              Back to run
            </Button>
            <div className="h-5 w-px bg-border-subtle" />
            <h1 className="text-lg font-semibold text-text-primary">
              Drift report
            </h1>
            {data ? (
              <Badge variant="outline">
                {totalCount} {totalCount === 1 ? "entry" : "entries"}
              </Badge>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : null}
            Refresh
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-5xl mx-auto space-y-6">
        {isLoading ? (
          <div className="text-center py-20 text-text-muted">
            <Loader2 className="size-6 animate-spin mx-auto mb-3" />
            Loading drift report...
          </div>
        ) : error ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-red-500">
                <AlertCircle className="size-4" />
                Failed to load drift report
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground break-words">
                {(error as Error).message}
              </p>
            </CardContent>
          </Card>
        ) : totalCount === 0 ? (
          <EmptyState />
        ) : (
          groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <group.icon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h2>
                <Badge variant="outline">{group.entries.length}</Badge>
              </div>
              <div className="space-y-2">
                {group.entries.map((entry) => (
                  <DriftRow key={entry.id} runId={runId} entry={entry} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function DriftRow({ runId, entry }: { runId: string; entry: DriftEntryView }) {
  const detail =
    typeof (entry as { detail?: unknown }).detail === "string"
      ? ((entry as { detail: string }).detail)
      : "(no detail)";
  return (
    <Link
      href={`/runs/${runId}/drift/${encodeURIComponent(entry.id)}`}
      className="block"
    >
      <Card className="transition hover:bg-muted/40">
        <CardContent className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm truncate">{entry.id}</span>
              <Badge variant="secondary">{entry.kind}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {detail}
            </p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">No drift detected</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          The runtime registry matched the authored spec and all visual
          baselines for this run.
        </p>
      </CardContent>
    </Card>
  );
}

export default DriftListContent;
