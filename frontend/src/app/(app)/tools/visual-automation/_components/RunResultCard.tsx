import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import type { RunResult } from "../_types";

interface RunResultCardProps {
  result: RunResult;
}

export function RunResultCard({ result }: RunResultCardProps) {
  return (
    <Card
      className={`border ${
        result.success
          ? "bg-green-950/30 border-green-500/50"
          : "bg-red-950/30 border-red-500/50"
      }`}
    >
      <CardContent className="py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {result.success ? (
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            ) : (
              <XCircle className="w-6 h-6 text-red-400" />
            )}
            <div>
              <p className="font-medium text-foreground">
                {result.success
                  ? "Workflow started successfully"
                  : "Failed to start workflow"}
              </p>
              {result.success && result.taskRunId && (
                <p className="text-sm text-muted-foreground mt-1">
                  Task Run #{result.taskRunId}
                </p>
              )}
              {result.error && (
                <p className="text-sm text-red-400 mt-1">{result.error}</p>
              )}
            </div>
          </div>
          {result.success && (
            <Link href="/monitor">
              <Button
                variant="outline"
                className="border-green-500/50 text-green-400 hover:bg-green-950/50"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View Dashboard
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
