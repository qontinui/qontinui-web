"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2 } from "lucide-react";
import type { RAGExportStatus } from "@/services/rag-export-service";

interface StatusCardProps {
  exportStatus: RAGExportStatus | null;
  isLoadingStatus: boolean;
}

export function StatusCard({ exportStatus, isLoadingStatus }: StatusCardProps) {
  return (
    <Card className="bg-surface-canvas border-border-subtle">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-brand-primary" />
            <div>
              <CardTitle>RAG Export</CardTitle>
              <CardDescription>
                Export project for semantic search and AI automation
              </CardDescription>
            </div>
          </div>
          {exportStatus && (
            <Badge
              variant="outline"
              className="border-brand-primary/50 text-brand-primary"
            >
              v{exportStatus.metadata.version}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoadingStatus ? (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading project stats...
          </div>
        ) : exportStatus ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatBox
              label="Elements"
              value={exportStatus.stats.element_count}
            />
            <StatBox label="States" value={exportStatus.stats.state_count} />
            <StatBox
              label="Workflows"
              value={exportStatus.stats.workflow_count}
            />
            <StatBox
              label="Transitions"
              value={exportStatus.stats.transition_count}
            />
          </div>
        ) : (
          <p className="text-text-muted">Unable to load project stats</p>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-canvas rounded-lg p-3 border border-border-default">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-text-muted">{label}</p>
    </div>
  );
}
