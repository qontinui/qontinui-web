"use client";

import React from "react";
import {
  Database,
  Clock,
  Activity,
  GitBranch,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HistoricalDataStatusProps } from "@/types/integration-tests";

export const HistoricalDataStatus: React.FC<HistoricalDataStatusProps> = ({
  stats,
  loading = false,
  error = null,
}) => {
  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "Never";

    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

    return date.toLocaleDateString();
  };

  return (
    <Card className="bg-white border border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Database className="w-4 h-4" />
          Historical Data
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">
                Error loading data
              </p>
              <p className="text-xs text-red-700 mt-1">{error}</p>
            </div>
          </div>
        ) : !stats ? (
          <div className="text-center py-8 text-gray-500">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No historical data available</p>
            <p className="text-xs mt-1">Run automations to collect data</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Automation Runs */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">Automation runs</span>
              </div>
              <span className="text-sm font-semibold text-gray-900">
                {formatNumber(stats.automationRunsCount)}
              </span>
            </div>

            {/* Total Actions */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">Total actions</span>
              </div>
              <span className="text-sm font-semibold text-gray-900">
                {formatNumber(stats.totalActionsCount)}
              </span>
            </div>

            {/* State Coverage */}
            <div className="p-2 rounded-lg bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">State coverage</span>
                <span className="text-sm font-semibold text-gray-900">
                  {stats.stateCoveragePercentage.toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    stats.stateCoveragePercentage >= 80
                      ? "bg-green-500"
                      : stats.stateCoveragePercentage >= 50
                        ? "bg-yellow-500"
                        : "bg-orange-500"
                  }`}
                  style={{
                    width: `${Math.min(100, stats.stateCoveragePercentage)}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-500">
                  {stats.uniqueStatesCount} states covered
                </span>
                <span className="text-xs text-gray-500">
                  {formatNumber(stats.transitionsRecorded)} transitions
                </span>
              </div>
            </div>

            {/* Last Updated */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-100">
              <Clock className="w-4 h-4 text-blue-600" />
              <div className="flex-1">
                <span className="text-xs text-blue-700">Last updated</span>
                <p className="text-sm font-medium text-blue-900">
                  {formatDate(stats.lastUpdated)}
                </p>
              </div>
            </div>

            {/* Info Note */}
            <div className="pt-2 border-t">
              <p className="text-xs text-gray-500 leading-relaxed">
                Historical data is used to simulate automation runs. Tests
                randomly select from recorded matches for realistic variation.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HistoricalDataStatus;
