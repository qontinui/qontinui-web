"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Layers,
  Route,
  Activity,
  AlertTriangle,
  Clock,
  Target,
} from "lucide-react";
import type {
  IntegrationTestResponse,
  IntegrationTestRun,
  ExecutionStep,
} from "@/types/integration-testing";
import { resolveName } from "../utils";

interface StatBadgeProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "blue" | "purple" | "green" | "yellow" | "red" | "gray";
}

function StatBadge({ icon, label, value, color }: StatBadgeProps) {
  const colorClasses = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    green: "bg-green-500/10 text-green-400 border-green-500/20",
    yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    gray: "bg-surface-raised/10 text-text-muted border-border-subtle",
  };

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border ${colorClasses[color]}`}
    >
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <div className="text-xs text-text-muted">{label}</div>
        <div className="text-lg font-bold">{value}</div>
      </div>
    </div>
  );
}

interface SummaryHeaderProps {
  run: IntegrationTestResponse | IntegrationTestRun;
  getStatusBadge: () => React.ReactNode;
  formatDuration: (ms: number) => string;
  showPlaybackToggle?: boolean;
  onToggleVisualMode?: () => void;
  nameMap?: Map<string, string>;
}

export function SummaryHeader({
  run,
  getStatusBadge,
  formatDuration,
  showPlaybackToggle,
  onToggleVisualMode,
  nameMap,
}: SummaryHeaderProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-xl text-white">
              {run.workflow_name}
            </CardTitle>
            {getStatusBadge()}
          </div>
          {showPlaybackToggle && onToggleVisualMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleVisualMode}
              className="border-brand-primary/30 text-brand-primary hover:bg-brand-primary/10"
            >
              <Activity className="w-4 h-4 mr-2" />
              Visual Playback
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Statistics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatBadge
            icon={<Layers className="w-4 h-4" />}
            label="States"
            value={`${run.coverage_data.states_covered}/${run.coverage_data.total_states}`}
            color="blue"
          />
          <StatBadge
            icon={<Route className="w-4 h-4" />}
            label="Transitions"
            value={`${run.coverage_data.transitions_covered}/${run.coverage_data.total_transitions}`}
            color="purple"
          />
          <StatBadge
            icon={<Activity className="w-4 h-4" />}
            label="Actions"
            value={
              "summary" in run
                ? `${run.summary.successful_actions}/${run.summary.total_actions}`
                : String(
                    run.steps.filter((s: ExecutionStep) => s.type === "action")
                      .length
                  )
            }
            color="green"
          />
          <StatBadge
            icon={<Target className="w-4 h-4" />}
            label="Coverage"
            value={`${run.coverage_data.coverage_percentage.toFixed(0)}%`}
            color={
              run.coverage_data.coverage_percentage >= 80
                ? "green"
                : run.coverage_data.coverage_percentage >= 50
                  ? "yellow"
                  : "red"
            }
          />
          <StatBadge
            icon={<Clock className="w-4 h-4" />}
            label="Duration"
            value={formatDuration(run.duration_ms)}
            color="gray"
          />
          <StatBadge
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Warnings"
            value={String(run.stochasticity_warnings.length)}
            color={run.stochasticity_warnings.length > 0 ? "yellow" : "gray"}
          />
        </div>

        {/* Initial and Final States */}
        <div className="mt-4 pt-4 border-t border-border-subtle/50">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-text-muted mb-2">Initial States</div>
              <div className="flex flex-wrap gap-1">
                {run.initial_states.length > 0 ? (
                  run.initial_states.map((state: string) => (
                    <Badge
                      key={state}
                      variant="outline"
                      className="text-xs border-blue-500/30 text-blue-400"
                    >
                      {resolveName(state, nameMap)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-text-muted">None</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted mb-2">Final States</div>
              <div className="flex flex-wrap gap-1">
                {run.final_states.length > 0 ? (
                  run.final_states.map((state: string) => (
                    <Badge
                      key={state}
                      variant="outline"
                      className="text-xs border-green-500/30 text-green-400"
                    >
                      {resolveName(state, nameMap)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-text-muted">None</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
