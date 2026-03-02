"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, AlertTriangle, Shield } from "lucide-react";
import { useBackendVerificationResults } from "@/hooks/useTaskRunsBackend";
import { IterationCard } from "./_components/IterationCard";
import { SummaryBanner } from "./_components/SummaryBanner";

interface VerificationResultsTabProps {
  taskId: string;
}

export default function VerificationResultsTab({
  taskId,
}: VerificationResultsTabProps) {
  const { data, isLoading, error } = useBackendVerificationResults(taskId);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-6">
          <div className="text-center py-8 text-text-muted">
            <div className="flex items-center justify-center gap-2">
              <Clock className="w-5 h-5 animate-spin" />
              Loading verification results...
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-6">
          <div className="text-center py-8 text-red-400">
            <AlertTriangle className="w-8 h-8 mx-auto mb-3" />
            <p>Error loading verification results</p>
            <p className="text-sm text-text-muted mt-1">
              {(error as Error).message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.count === 0) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-6">
          <div className="text-center py-8 text-text-muted">
            <Shield className="w-12 h-12 mx-auto mb-4 text-text-muted/50" />
            <p>No verification results recorded for this task</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SummaryBanner data={data} />

      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-lg">Verification Iterations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...data.results]
              .sort((a, b) => b.iteration - a.iteration)
              .map((result) => (
                <IterationCard key={result.id} result={result} />
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
