"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/overview/KpiCard";
import { StatusPill } from "@/components/overview/StatusPill";
import { formatDate, daysUntil } from "../types";
import { scenarioA } from "../mock-data";

export default function TimelinePage() {
  const data = scenarioA;
  const currentPhase = data.phases.find((p) => p.status === "In progress");
  const plannedEnd = data.phases[data.phases.length - 1]?.plannedEnd;

  return (
    <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.timeline.page">
      <div>
        <p className="text-sm font-medium text-primary">Timeline</p>
        <h2 className="text-xl font-semibold">Project schedule and milestones</h2>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Timeline indicators">
        <KpiCard
          label="Planned start"
          value={formatDate(data.phases[0]?.plannedStart ?? "2026-01-01")}
          bridge="overview.timeline.kpi.start"
        />
        <KpiCard
          label="Planned finish"
          value={formatDate(plannedEnd ?? "2026-12-31")}
          bridge="overview.timeline.kpi.finish"
        />
        <KpiCard
          label="Current phase"
          value={currentPhase?.name ?? "Planning"}
          detail={`Ends ${formatDate(currentPhase?.plannedEnd ?? "2026-12-31")}`}
          bridge="overview.timeline.kpi.phase"
        >
          <StatusPill status={currentPhase?.status ?? "Planned"} />
        </KpiCard>
        <KpiCard
          label="Forecast status"
          value="On track"
          detail={`${daysUntil(plannedEnd ?? "2026-12-31")} days until planned finish`}
          bridge="overview.timeline.kpi.forecast"
        />
      </section>

      <Card data-ui-bridge-id="overview.timeline.gantt">
        <CardHeader>
          <CardTitle>Gantt chart</CardTitle>
          <CardDescription>Project phases with planned and actual timelines.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.phases.map((phase) => {
            const startDate = new Date(phase.plannedStart);
            const endDate = new Date(phase.plannedEnd);
            const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            const durationWeeks = Math.ceil(durationDays / 7);

            return (
              <div key={phase.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <h4 className="font-medium">{phase.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(phase.plannedStart)} → {formatDate(phase.plannedEnd)} ({durationWeeks} weeks)
                    </p>
                  </div>
                  <StatusPill status={phase.status} />
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${
                      phase.status === "Done"
                        ? "bg-primary"
                        : phase.status === "In progress"
                          ? "bg-yellow-500/60"
                          : "bg-muted-foreground/40"
                    }`}
                    style={{ width: phase.status === "Done" ? "100%" : "30%" }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card data-ui-bridge-id="overview.timeline.milestones">
        <CardHeader>
          <CardTitle>Milestones</CardTitle>
          <CardDescription>Key events and checkpoints.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.milestones.map((milestone) => (
              <div key={milestone.id} className="flex items-center justify-between border-l-2 border-primary pl-4">
                <div>
                  <p className="font-medium">{milestone.title}</p>
                  <p className="text-sm text-muted-foreground">{formatDate(milestone.date)}</p>
                </div>
                <StatusPill status={milestone.status} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card data-ui-bridge-id="overview.timeline.gates">
        <CardHeader>
          <CardTitle>Gates</CardTitle>
          <CardDescription>Phase exit criteria and approval points.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.gates.map((gate) => (
              <div key={gate.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h4 className="font-medium">{gate.name}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{gate.criteria}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Planned: {formatDate(gate.plannedDate)}
                      {gate.actualDate && ` • Actual: ${formatDate(gate.actualDate)}`}
                    </p>
                    {gate.note && <p className="mt-2 text-sm">{gate.note}</p>}
                  </div>
                  <Badge
                    variant={
                      gate.status === "Passed"
                        ? "default"
                        : gate.status === "Failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {gate.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
