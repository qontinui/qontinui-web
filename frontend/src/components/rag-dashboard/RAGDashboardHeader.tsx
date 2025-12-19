"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, Layers, Grid3X3, Clock, Loader2 } from "lucide-react";
import type { RAGDashboardStats } from "@/types/rag-dashboard";

interface RAGDashboardHeaderProps {
  stats: RAGDashboardStats | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function RAGDashboardHeader({
  stats,
  isLoading,
  error,
}: RAGDashboardHeaderProps) {
  if (error) {
    return (
      <Card className="bg-red-900/20 border-red-800">
        <CardContent className="p-6">
          <p className="text-red-400">Failed to load dashboard: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Embeddings */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[#00D9FF]/10">
                <Database className="w-5 h-5 text-[#00D9FF]" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Embeddings</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16 bg-gray-800" />
                ) : (
                  <p className="text-2xl font-bold text-white">
                    {stats?.total_embeddings ?? 0}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total States */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[#BD00FF]/10">
                <Layers className="w-5 h-5 text-[#BD00FF]" />
              </div>
              <div>
                <p className="text-sm text-gray-400">States</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16 bg-gray-800" />
                ) : (
                  <p className="text-2xl font-bold text-white">
                    {stats?.total_states ?? 0}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Patterns */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[#00FF88]/10">
                <Grid3X3 className="w-5 h-5 text-[#00FF88]" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Patterns</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16 bg-gray-800" />
                ) : (
                  <p className="text-2xl font-bold text-white">
                    {stats?.total_patterns ?? 0}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Last Sync */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Clock className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Last Sync</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-24 bg-gray-800" />
                ) : stats?.last_sync_at ? (
                  <p className="text-sm font-medium text-white">
                    {new Date(stats.last_sync_at).toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">Never</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Job Banner */}
      {stats?.active_job && (
        <Card className="bg-[#00D9FF]/5 border-[#00D9FF]/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-[#00D9FF] animate-spin" />
                <div>
                  <p className="text-sm font-medium text-white">
                    Processing in progress
                  </p>
                  <p className="text-xs text-gray-400">
                    {stats.active_job.processed_patterns} /{" "}
                    {stats.active_job.total_patterns} patterns
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#00D9FF] transition-all"
                    style={{
                      width: `${stats.active_job.progress_percent}%`,
                    }}
                  />
                </div>
                <Badge variant="outline" className="border-[#00D9FF] text-[#00D9FF]">
                  {Math.round(stats.active_job.progress_percent)}%
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
