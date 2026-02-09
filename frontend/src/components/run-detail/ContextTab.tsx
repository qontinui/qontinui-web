"use client";

import { useState } from "react";
import { useTaskRunKnowledge } from "@/lib/runner-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, BookOpen, ChevronDown, ChevronRight } from "lucide-react";

export function ContextTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunKnowledge(runId);
  const [expandedObservations, setExpandedObservations] = useState(true);
  const [expandedHypotheses, setExpandedHypotheses] = useState(true);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading context...
      </div>
    );
  }
  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }
  if (
    !data ||
    (data.observations.length === 0 && data.hypotheses.length === 0)
  ) {
    return (
      <div className="text-center py-12 text-text-muted">
        <BookOpen className="size-12 mx-auto mb-4" />
        <p>No context data for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.observations.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader
            className="cursor-pointer"
            onClick={() => setExpandedObservations(!expandedObservations)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              {expandedObservations ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Observations ({data.observations.length})
            </CardTitle>
          </CardHeader>
          {expandedObservations && (
            <CardContent>
              <ul className="space-y-2">
                {data.observations.map((obs: string, i: number) => (
                  <li
                    key={i}
                    className="text-sm text-text-secondary pl-4 border-l-2 border-border-subtle"
                  >
                    {obs}
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
      {data.hypotheses.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader
            className="cursor-pointer"
            onClick={() => setExpandedHypotheses(!expandedHypotheses)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              {expandedHypotheses ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Hypotheses ({data.hypotheses.length})
            </CardTitle>
          </CardHeader>
          {expandedHypotheses && (
            <CardContent>
              <ul className="space-y-2">
                {data.hypotheses.map((hyp: string, i: number) => (
                  <li
                    key={i}
                    className="text-sm text-text-secondary pl-4 border-l-2 border-brand-primary/30"
                  >
                    {hyp}
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
