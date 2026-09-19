"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  DollarSign,
  FileText,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { KpiCard } from "@/components/overview/KpiCard";
import { StatusPill } from "@/components/overview/StatusPill";
import { EmptyState } from "@/components/overview/EmptyState";
import { formatDate, formatPercent, formatMoney, daysUntil } from "./types";
import { scenarioA } from "./mock-data";

export default function SummaryPage() {
  const data = scenarioA;
  const { settings } = data;

  const progress = data.phases.filter((p) => p.status === "Done").length / data.phases.length;
  const budgetCost = data.costs.reduce((sum, c) => sum + c.amountMicros, 0);
  const monthlySpend = data.costs
    .filter((c) => c.date.startsWith("2026-09"))
    .reduce((sum, c) => sum + c.amountMicros, 0);

  return (
    <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.summary.page">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Executive summary</p>
          <h2 className="text-xl font-semibold">A calm view of where the work stands</h2>
        </div>
      </div>

      {data.about ? (
        <Card data-ui-bridge-id="overview.summary.about">
          <CardHeader>
            <CardTitle>About this project</CardTitle>
            <CardDescription>Why this work matters to customers and the business.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-3xl space-y-4 text-sm leading-7 text-muted-foreground">
              {data.about.split("\n\n").map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="The project's intent hasn&apos;t been written yet."
          action={
            <Link href="#" className="text-sm font-medium text-primary underline">
              Write it
            </Link>
          }
        />
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Project indicators">
        <KpiCard
          label="Progress"
          value={`${data.phases.filter((p) => p.status === "Done").length} of ${data.phases.length}`}
          detail="phases done"
          bridge="overview.summary.kpi.progress"
        >
          <Progress value={progress * 100} className="mb-2" aria-label={`${formatPercent(progress)} complete`} />
        </KpiCard>

        <KpiCard
          label="Current phase"
          value={data.phases.find((p) => p.status === "In progress")?.name ?? "Planning"}
          detail={`${daysUntil(data.phases.find((p) => p.status === "In progress")?.plannedEnd ?? "2026-12-31")} days remaining`}
          bridge="overview.summary.kpi.phase"
        >
          <StatusPill status={data.phases.find((p) => p.status === "In progress")?.status ?? "Planned"} />
        </KpiCard>

        <KpiCard
          label="Spend this month"
          value={formatMoney(monthlySpend, settings.baseCurrency)}
          detail="Sep 2026"
          bridge="overview.summary.kpi.spend"
        >
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <TrendingUp className="size-4 text-primary" />
            vs. previous month
          </div>
        </KpiCard>

        <KpiCard
          label="Total spend to date"
          value={formatMoney(budgetCost, settings.baseCurrency)}
          detail="Since project start"
          bridge="overview.summary.kpi.total-spend"
        >
          <DollarSign className="size-5 text-muted-foreground" />
        </KpiCard>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
        {data.goals && data.goals.length > 0 ? (
          <Card data-ui-bridge-id="overview.summary.goals">
            <CardHeader>
              <CardTitle>Goals</CardTitle>
              <CardDescription>Measures of success for the leadership team.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {data.goals.map((goal) => (
                <div key={goal.title} className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium">{goal.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{goal.description}</p>
                  </div>
                  <StatusPill status={goal.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <EmptyState title="The project's goals haven&apos;t been written yet." />
        )}

        {data.recentProgress && data.recentProgress.length > 0 ? (
          <Card data-ui-bridge-id="overview.summary.recent-progress">
            <CardHeader>
              <CardTitle>Recent progress</CardTitle>
              <CardDescription>The latest completed work.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {data.recentProgress.map((item, index) => (
                <div key={item.title}>
                  <div className="flex gap-3">
                    <div className="mt-0.5">
                      <CheckCircle2 className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(item.date)} · {item.detail}
                      </p>
                    </div>
                  </div>
                  {index < data.recentProgress.length - 1 && <Separator className="mt-4" />}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="bg-muted/30" data-ui-bridge-id="overview.summary.materials">
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <FileText className="size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Materials for your next update</p>
              <p className="text-sm text-muted-foreground">Review the latest timeline, financials, and presentation slides.</p>
            </div>
          </div>
          <Link
            href="/overview/slides"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Open slides <ArrowUpRight className="size-4" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
