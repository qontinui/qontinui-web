"use client";

/**
 * DriftEntryDetail — dispatches a `DriftEntry` to the right kind-specific
 * renderer.
 *
 * Backends:
 *   GET /api/v1/runs/:runId/drift/:entryId -> DriftEntryView
 * (See drift-api.ts. As of Phase D2 this endpoint is a follow-up — the
 * fetcher will return a network error until backend wiring lands.)
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle, HelpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchDriftEntry,
  isSpecDrift,
  isVisualDrift,
  type DriftEntryView,
} from "./drift-api";
import { VisualDriftDetail } from "./VisualDriftDetail";
import { SpecDriftDetail } from "./SpecDriftDetail";

export const driftQueryKeys = {
  all: ["drift"] as const,
  byRun: (runId: string) => [...driftQueryKeys.all, "run", runId] as const,
  entry: (runId: string, entryId: string) =>
    [...driftQueryKeys.byRun(runId), "entry", entryId] as const,
};

export interface DriftEntryDetailProps {
  runId: string;
  entryId: string;
}

export function DriftEntryDetail({ runId, entryId }: DriftEntryDetailProps) {
  const router = useRouter();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: driftQueryKeys.entry(runId, entryId),
    queryFn: () => fetchDriftEntry(runId, entryId),
    staleTime: 30_000,
  });

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/runs/${runId}/drift`)}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="size-4 mr-1" />
              Back to drift
            </Button>
            <div className="h-5 w-px bg-border-subtle" />
            <h1 className="text-lg font-semibold text-text-primary truncate max-w-md">
              Drift entry
              <span className="ml-2 text-text-muted font-mono text-sm">
                {entryId}
              </span>
            </h1>
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

      <main className="p-6 max-w-5xl mx-auto">
        {isLoading ? (
          <LoaderPanel />
        ) : error ? (
          <ErrorPanel message={(error as Error).message} />
        ) : !data ? (
          <NotFoundPanel />
        ) : (
          <Dispatcher runId={runId} entry={data} />
        )}
      </main>
    </div>
  );
}

function Dispatcher({
  runId,
  entry,
}: {
  runId: string;
  entry: DriftEntryView;
}) {
  if (isVisualDrift(entry)) {
    return <VisualDriftDetail runId={runId} entry={entry} />;
  }
  if (isSpecDrift(entry)) {
    return <SpecDriftDetail runId={runId} entry={entry} />;
  }
  return <UnknownDriftDetail entry={entry} />;
}

function UnknownDriftDetail({ entry }: { entry: DriftEntryView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="size-4 text-muted-foreground" />
          Unknown drift kind
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          This drift entry uses a kind this UI does not yet render. The raw
          payload is shown below.
        </p>
        <pre className="text-xs font-mono whitespace-pre-wrap break-words rounded border bg-muted/40 p-3 max-h-96 overflow-auto">
          {JSON.stringify(entry, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

function LoaderPanel() {
  return (
    <div className="text-center py-20 text-text-muted">
      <Loader2 className="size-6 animate-spin mx-auto mb-3" />
      Loading drift entry...
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-red-500">
          <AlertCircle className="size-4" />
          Failed to load drift entry
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground break-words">{message}</p>
      </CardContent>
    </Card>
  );
}

function NotFoundPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="size-4 text-muted-foreground" />
          Drift entry not found
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          No drift entry exists at the requested path.
        </p>
      </CardContent>
    </Card>
  );
}

export default DriftEntryDetail;
