"use client";

import {
  useTaskRunVerification,
  type VerificationResult,
} from "@/lib/runner-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import { formatDate } from "./utils";

export function VerificationTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunVerification(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading verification results...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading verification: {error}
      </div>
    );
  }

  const results = data?.results ?? [];

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <ShieldCheck className="size-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No verification results for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result: VerificationResult) => (
        <Card key={result.id} className="bg-muted/50 border-border">
          <CardContent className="py-3.5 px-4">
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                {result.passed ? (
                  <CheckCircle2 className="size-5 text-green-500" />
                ) : (
                  <XCircle className="size-5 text-red-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    data-content-role="label"
                    data-content-label="verification criterion"
                    className="text-sm font-medium text-foreground"
                  >
                    {result.criterion}
                  </span>
                  <Badge
                    variant={result.passed ? "success" : "destructive"}
                    className="text-xs"
                  >
                    {result.passed ? "Passed" : "Failed"}
                  </Badge>
                  {result.confidence != null && (
                    <span
                      data-content-role="metric"
                      data-content-label="verification confidence"
                      className="text-xs text-muted-foreground"
                    >
                      {Math.round(result.confidence * 100)}% confidence
                    </span>
                  )}
                </div>
                {result.observation && (
                  <p className="text-sm text-muted-foreground mt-1.5">
                    {result.observation}
                  </p>
                )}
                <div
                  data-content-role="metric"
                  data-content-label="verification timestamp"
                  className="text-xs text-muted-foreground mt-1.5"
                >
                  Checked at {formatDate(result.verified_at)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
