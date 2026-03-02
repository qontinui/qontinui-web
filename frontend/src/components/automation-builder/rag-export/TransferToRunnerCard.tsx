"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  AlertCircle,
  Loader2,
  Monitor,
  Brain,
  CheckCircle2,
} from "lucide-react";
import type { RunnerConnection } from "@/types/runner";
import type { EmbeddingProgress } from "@/services/rag-export-service";

interface TransferToRunnerCardProps {
  activeConnections: RunnerConnection[] | undefined;
  connectionsLoading: boolean;
  selectedRunnerId: string | null;
  setSelectedRunnerId: (id: string | null) => void;
  isExporting: boolean;
  isTransferring: boolean;
  exportProgress: number;
  embeddingProgress: EmbeddingProgress | null;
  onTransfer: () => void;
}

export function TransferToRunnerCard({
  activeConnections,
  connectionsLoading,
  selectedRunnerId,
  setSelectedRunnerId,
  isExporting,
  isTransferring,
  exportProgress,
  embeddingProgress,
  onTransfer,
}: TransferToRunnerCardProps) {
  return (
    <Card className="bg-surface-canvas border-border-subtle">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-brand-primary" />
          <div>
            <CardTitle className="text-lg">Transfer to Runner</CardTitle>
            <CardDescription>
              Send RAG config directly to a connected desktop runner
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connectionsLoading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking for connected runners...
          </div>
        ) : activeConnections && activeConnections.length > 0 ? (
          <>
            <div className="space-y-2">
              <Label>Select Runner</Label>
              <Select
                value={selectedRunnerId || undefined}
                onValueChange={setSelectedRunnerId}
              >
                <SelectTrigger
                  className="bg-surface-canvas border-border-default"
                  data-ui-id="automation-rag-runner-select"
                >
                  <SelectValue placeholder="Choose a runner..." />
                </SelectTrigger>
                <SelectContent>
                  {activeConnections.map((conn) => (
                    <SelectItem key={conn.id} value={String(conn.id)}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full" />
                        {conn.runner_name}
                        {conn.project_name && (
                          <span className="text-text-muted">
                            ({conn.project_name})
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={onTransfer}
              disabled={isTransferring || !selectedRunnerId}
              className="w-full bg-gradient-to-r from-brand-primary to-brand-secondary hover:opacity-90 text-white"
              data-ui-id="automation-rag-transfer-btn"
            >
              {isTransferring ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Transferring...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Transfer to Runner
                </>
              )}
            </Button>
          </>
        ) : (
          <NoRunnersMessage />
        )}

        {(isExporting || isTransferring) && exportProgress > 0 && (
          <div className="space-y-2">
            <Progress value={exportProgress} className="h-2" />
            <p className="text-sm text-text-muted text-center">
              {isTransferring ? "Transferring" : "Exporting"}...{" "}
              {exportProgress}%
            </p>
          </div>
        )}

        {embeddingProgress && (
          <EmbeddingProgressSection progress={embeddingProgress} />
        )}
      </CardContent>
    </Card>
  );
}

function NoRunnersMessage() {
  return (
    <div className="bg-surface-canvas rounded-lg p-4 border border-border-default">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
        <div>
          <p className="font-medium text-yellow-400">No runners connected</p>
          <p className="text-sm text-text-muted mt-1">
            Download and connect the Qontinui Runner to transfer configs
            directly.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-border-default"
            onClick={() => (window.location.href = "/connect-runner")}
            data-ui-id="automation-rag-connect-btn"
          >
            <Monitor className="w-4 h-4 mr-2" />
            Connect Runner
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmbeddingProgressSection({
  progress,
}: {
  progress: EmbeddingProgress;
}) {
  return (
    <div className="bg-surface-canvas rounded-lg p-4 border border-border-default space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-brand-primary" />
          <span className="font-medium text-white">Generating Embeddings</span>
        </div>
        <Badge
          variant="outline"
          className={
            progress.status === "completed"
              ? "border-green-500/50 text-green-400"
              : progress.status === "failed"
                ? "border-red-500/50 text-red-400"
                : "border-brand-primary/50 text-brand-primary"
          }
        >
          {progress.status}
        </Badge>
      </div>

      {progress.status === "in_progress" && (
        <>
          <Progress value={progress.percent || 0} className="h-2" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">{progress.message}</span>
            <span className="text-text-muted">{progress.percent || 0}%</span>
          </div>
          {progress.elements_processed !== undefined &&
            progress.total_elements !== undefined && (
              <p className="text-xs text-text-muted">
                {progress.elements_processed} / {progress.total_elements}{" "}
                elements
              </p>
            )}
        </>
      )}

      {progress.status === "completed" && (
        <div className="flex items-center gap-2 text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm">{progress.message}</span>
        </div>
      )}

      {progress.status === "failed" && (
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{progress.message}</span>
        </div>
      )}
    </div>
  );
}
