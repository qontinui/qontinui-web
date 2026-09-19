"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, CheckCircle2, CircleAlert, DollarSign, FileText, PencilLine, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { overviewData, money, percent, dateLabel, daysAway, Status } from "../types";

export function StatusPill({ status }: { status: Status }) {
  const Icon = status === "Done" ? CheckCircle2 : status === "At risk" ? CircleAlert : status === "In progress" ? TrendingUp : CalendarDays;
  return <Badge variant={status === "At risk" ? "destructive" : status === "Done" ? "default" : "secondary"} className="gap-1"><Icon className="size-3.5" />{status}</Badge>;
}

export function KpiCard({ label, value, detail, children, bridge }: { label: string; value: string; detail?: string; children?: ReactNode; bridge: string }) {
  return <Card data-ui-bridge-id={bridge}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tracking-tight">{value}</CardTitle></CardHeader><CardContent className="pt-0">{children}{detail && <p className="text-sm text-muted-foreground">{detail}</p>}</CardContent></Card>;
}

export function OverviewHeader() {
  const links = [["Summary", "/overview"], ["Timeline", "/overview/timeline"], ["Financials", "/overview/financials"], ["Diagrams", "/overview/diagrams"], ["Documents", "/overview/documents"], ["Wiki", "/overview/wiki"], ["Slides", "/overview/slides"]];
  return <header className="border-b bg-card/70" data-ui-bridge-id="overview.header"><div className="px-6 py-5"><p className="text-sm font-medium text-muted-foreground">Project overview</p><h1 className="text-2xl font-semibold tracking-tight">Customer Portal Modernization</h1><p className="mt-1 text-sm text-muted-foreground">A clearer, faster account experience for enterprise customers.</p><p className="mt-2 text-xs text-muted-foreground">Last updated 2 hours ago</p></div><nav className="flex gap-1 overflow-x-auto px-6" aria-label="Project sections" data-ui-bridge-id="overview.subnav">{links.map(([label, href]) => <Link key={href} href={href} className="whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground [&[aria-current=page]]:border-primary [&[aria-current=page]]:text-foreground">{label}</Link>)}</nav></header>;
}

export function SummaryPage({ canEdit = true }: { canEdit?: boolean }) {
  const data = overviewData;
  const progress = data.milestonesDone / data.milestonesTotal;
  const budgetDelta = (data.monthlyBudgetMicros ?? 0) - (data.spendThisMonthMicros ?? 0);
  return <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.summary.page">
    <div className="flex items-center justify-between"><div><p className="text-sm font-medium text-primary">Executive summary</p><h2 className="text-xl font-semibold">A calm view of where the work stands</h2></div>{canEdit && <button className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted" data-ui-bridge-id="overview.summary.edit-button"><PencilLine className="size-4" />Edit overview</button>}</div>
    <Card data-ui-bridge-id="overview.summary.intent"><CardHeader><CardTitle>About this project</CardTitle><CardDescription>Why this work matters to customers and the business.</CardDescription></CardHeader><CardContent>{data.intent ? <div className="max-w-3xl space-y-4 text-sm leading-7 text-muted-foreground">{data.intent.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div> : <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">The project&apos;s intent hasn&apos;t been written yet. {canEdit && <Link className="font-medium text-primary underline" href="#">Write it</Link>}</div>}</CardContent></Card>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Project indicators">
      <KpiCard label="Progress" value={`${data.milestonesDone} of ${data.milestonesTotal}`} detail="milestones done" bridge="overview.summary.kpi.progress"><Progress value={progress * 100} className="mb-2" aria-label={`${percent(progress)} complete`} /></KpiCard>
      <KpiCard label="Next milestone" value={data.nextMilestone?.title ?? "Not set"} detail={data.nextMilestone ? `${dateLabel(data.nextMilestone.date)} · ${daysAway(data.nextMilestone.date)} days away` : "No milestone planned"} bridge="overview.summary.kpi.next-milestone"><StatusPill status={data.nextMilestone?.status ?? "Planned"} /></KpiCard>
      <KpiCard label="Spend this month" value={money(data.spendThisMonthMicros)} detail={`${money(Math.abs(budgetDelta))} ${budgetDelta >= 0 ? "under" : "over"} budget`} bridge="overview.summary.kpi.spend"><div className="flex items-center gap-1 text-sm text-muted-foreground">{budgetDelta >= 0 ? <TrendingDown className="size-4 text-primary" /> : <TrendingUp className="size-4 text-destructive" />}vs. {money(data.monthlyBudgetMicros)} budget</div></KpiCard>
      <KpiCard label="Total spend to date" value={money(data.totalSpendMicros)} detail="Since project start" bridge="overview.summary.kpi.total-spend"><DollarSign className="size-5 text-muted-foreground" /></KpiCard>
    </section>
    <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
      <Card data-ui-bridge-id="overview.summary.goals"><CardHeader><CardTitle>Goals</CardTitle><CardDescription>Measures of success for the leadership team.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{data.goals?.length ? data.goals.map((goal) => <div key={goal.title} className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-medium">{goal.title}</h3><p className="mt-1 text-sm text-muted-foreground">{goal.description}</p></div><StatusPill status={goal.status} /></div>) : <p className="text-sm text-muted-foreground">The project&apos;s goals haven&apos;t been written yet.</p>}</CardContent></Card>
      <Card data-ui-bridge-id="overview.summary.recent-progress"><CardHeader><CardTitle>Recent progress</CardTitle><CardDescription>The latest completed work.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{data.recentProgress.map((item, index) => <div key={item.title}><div className="flex gap-3"><div className="mt-0.5"><CheckCircle2 className="size-4 text-primary" /></div><div className="min-w-0"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(item.date)} · {item.detail}</p></div></div>{index < data.recentProgress.length - 1 && <Separator className="mt-4" />}</div>)}</CardContent></Card>
    </div>
    <Card className="bg-muted/30" data-ui-bridge-id="overview.summary.materials"><CardContent className="flex items-center justify-between gap-4 p-5"><div className="flex items-center gap-3"><FileText className="size-5 text-muted-foreground" /><div><p className="text-sm font-medium">Materials for your next update</p><p className="text-sm text-muted-foreground">Review the latest timeline, financials, and presentation slides.</p></div></div><Link href="/overview/slides" className="inline-flex items-center gap-1 text-sm font-medium text-primary">Open slides <ArrowUpRight className="size-4" /></Link></CardContent></Card>
  </div>;
}
