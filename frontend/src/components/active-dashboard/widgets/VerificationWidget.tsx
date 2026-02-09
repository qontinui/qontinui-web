"use client";

import { useTaskRunVerification } from "@/lib/runner-api";
import type { VerificationResult } from "@/lib/runner-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

export function VerificationWidget({ runId }: { runId: string }) {
  const { data, isLoading } = useTaskRunVerification(runId);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-400" />
            Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const results = (data as VerificationResult[] | undefined) || [];
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="size-4 text-green-400" />
          Verification
          {results.length > 0 && (
            <Badge
              variant={failed === 0 ? "success" : "destructive"}
              className="text-xs"
            >
              {passed}/{results.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        <ScrollArea className="h-full">
          <div className="space-y-1.5">
            {results.map((r) => (
              <div key={r.id} className="flex items-start gap-2 text-xs">
                {r.passed ? (
                  <CheckCircle2 className="size-3.5 text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="size-3.5 text-red-500 mt-0.5 shrink-0" />
                )}
                <span className="text-text-secondary">{r.criterion}</span>
              </div>
            ))}
            {results.length === 0 && (
              <p className="text-xs text-text-muted">
                No verification results yet...
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
