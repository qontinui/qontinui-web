"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  BarChart3,
  Globe,
  Maximize2,
  Layout,
  ArrowRight,
  AlertTriangle,
  Info,
  AlertCircle,
} from "lucide-react";
import type {
  UIBridgeState,
  UIBridgeTransition,
} from "@/lib/state-machine-builder/types";
import type {
  ValidationResult,
  IssueSeverity,
} from "@/lib/state-machine-builder/validation";

interface StatisticsPanelProps {
  states: UIBridgeState[];
  transitions: UIBridgeTransition[];
  validationResult?: ValidationResult;
  onSelectState?: (id: string | null) => void;
}

const severityConfig: Record<
  IssueSeverity,
  { Icon: typeof AlertCircle; color: string; badgeClass: string }
> = {
  error: {
    Icon: AlertCircle,
    color: "text-red-400",
    badgeClass: "border-red-500/30 bg-red-500/10 text-red-400",
  },
  warning: {
    Icon: AlertTriangle,
    color: "text-amber-400",
    badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  info: {
    Icon: Info,
    color: "text-blue-400",
    badgeClass: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
};

export function StatisticsPanel({
  states,
  transitions,
  validationResult,
  onSelectState,
}: StatisticsPanelProps) {
  const stats = useMemo(() => {
    const globalCount = states.filter((s) => s.isGlobal).length;
    const modalCount = states.filter((s) => s.isModal).length;
    const contentCount = states.length - globalCount - modalCount;

    const zoneCounts: Record<string, number> = {};
    states.forEach((s) => {
      const zone = s.positionZone || "unknown";
      zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
    });

    const avgConfidence =
      states.length > 0
        ? states.reduce((sum, s) => sum + (s.confidence ?? 0), 0) /
          states.filter((s) => s.confidence != null).length
        : 0;

    const totalFingerprints = states.reduce(
      (sum, s) => sum + s.fingerprints.length,
      0
    );

    const totalElements = states.reduce(
      (sum, s) => sum + (s.elements?.length ?? 0),
      0
    );

    return {
      globalCount,
      modalCount,
      contentCount,
      zoneCounts,
      avgConfidence,
      totalFingerprints,
      totalElements,
    };
  }, [states]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-5 text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
          Statistics
        </h3>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {states.length}
            </div>
            <div className="text-xs text-text-muted">States</div>
          </CardContent>
        </Card>
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {transitions.length}
            </div>
            <div className="text-xs text-text-muted">Transitions</div>
          </CardContent>
        </Card>
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {stats.totalFingerprints}
            </div>
            <div className="text-xs text-text-muted">Fingerprints</div>
          </CardContent>
        </Card>
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {stats.totalElements}
            </div>
            <div className="text-xs text-text-muted">Elements</div>
          </CardContent>
        </Card>
      </div>

      <Separator className="bg-border-subtle" />

      {/* State Types */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
          State Types
        </h4>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-text-secondary">
              <Globe className="size-3.5 text-green-400" />
              Global
            </span>
            <Badge
              variant="outline"
              className="border-green-500/30 bg-green-500/10 text-green-400"
            >
              {stats.globalCount}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-text-secondary">
              <Maximize2 className="size-3.5 text-purple-400" />
              Modal
            </span>
            <Badge
              variant="outline"
              className="border-purple-500/30 bg-purple-500/10 text-purple-400"
            >
              {stats.modalCount}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-text-secondary">
              <Layout className="size-3.5 text-blue-400" />
              Content
            </span>
            <Badge
              variant="outline"
              className="border-blue-500/30 bg-blue-500/10 text-blue-400"
            >
              {stats.contentCount}
            </Badge>
          </div>
        </div>
      </div>

      <Separator className="bg-border-subtle" />

      {/* Zone Distribution */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Position Zones
        </h4>
        <div className="space-y-1">
          {Object.entries(stats.zoneCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([zone, count]) => (
              <div
                key={zone}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-text-secondary capitalize">{zone}</span>
                <span className="text-text-muted">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Confidence */}
      {stats.avgConfidence > 0 && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Average Confidence
            </h4>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-surface-canvas overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500"
                  style={{ width: `${stats.avgConfidence * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-text-primary">
                {(stats.avgConfidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </>
      )}

      {/* Transition Action Types */}
      {transitions.length > 0 && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Action Types
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set(transitions.map((t) => t.action.type))).map(
                (actionType) => (
                  <Badge
                    key={actionType}
                    variant="outline"
                    className="border-border-subtle text-text-secondary text-xs"
                  >
                    <ArrowRight className="size-3 mr-1" />
                    {actionType}
                  </Badge>
                )
              )}
            </div>
          </div>
        </>
      )}

      {/* Validation */}
      {validationResult && validationResult.issues.length > 0 && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Validation
              </h4>
              <div className="flex gap-1">
                {(() => {
                  const counts: Record<IssueSeverity, number> = {
                    error: 0,
                    warning: 0,
                    info: 0,
                  };
                  for (const issue of validationResult.issues) {
                    counts[issue.severity]++;
                  }
                  return (
                    <>
                      {counts.error > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-red-500/30 bg-red-500/10 text-red-400"
                        >
                          {counts.error}
                        </Badge>
                      )}
                      {counts.warning > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-amber-500/30 bg-amber-500/10 text-amber-400"
                        >
                          {counts.warning}
                        </Badge>
                      )}
                      {counts.info > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-blue-500/30 bg-blue-500/10 text-blue-400"
                        >
                          {counts.info}
                        </Badge>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="space-y-1">
              {validationResult.issues.map((issue, i) => {
                const cfg = severityConfig[issue.severity];
                const SevIcon = cfg.Icon;
                return (
                  <button
                    key={i}
                    className="w-full flex items-start gap-2 text-left rounded-md px-2 py-1.5 hover:bg-surface-raised/50 transition-colors"
                    onClick={() => {
                      if (issue.stateId && onSelectState) {
                        onSelectState(issue.stateId);
                      }
                    }}
                  >
                    <SevIcon
                      className={`size-3.5 shrink-0 mt-0.5 ${cfg.color}`}
                    />
                    <span className="text-xs text-text-secondary">
                      {issue.message}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
