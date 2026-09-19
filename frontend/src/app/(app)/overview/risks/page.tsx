"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/overview/KpiCard";
import { scenarioA } from "../mock-data";

export default function RisksPage() {
  const open = scenarioA.risks.filter((risk) => risk.status !== "Closed").length;
  const blocking = scenarioA.decisions.filter((decision) => decision.status === "Blocking").length;
  return <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.risks.page">
    <div><p className="text-sm font-medium text-primary">Risks and decisions</p><h2 className="text-xl font-semibold">What needs attention</h2><p className="text-sm text-muted-foreground">Surface blockers, mitigations, and decisions for the next update.</p></div>
    <section className="grid gap-4 md:grid-cols-3"><KpiCard label="Open risks" value={String(open)} bridge="overview.risks.kpi.open"><AlertTriangle className="size-5 text-muted-foreground" /></KpiCard><KpiCard label="Blocking decisions" value={String(blocking)} bridge="overview.risks.kpi.decisions"><Badge variant={blocking ? "destructive" : "default"}>{blocking ? "Needs attention" : "Clear"}</Badge></KpiCard><KpiCard label="Mitigations underway" value={String(scenarioA.risks.filter((risk) => risk.status === "Mitigating").length)} bridge="overview.risks.kpi.mitigating"><ShieldCheck className="size-5 text-primary" /></KpiCard></section>
    <Card><CardHeader><CardTitle>Risk register</CardTitle><CardDescription>Owners and mitigation plans.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{scenarioA.risks.map((risk) => <div key={risk.id} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-muted-foreground">{risk.code}</p><h3 className="font-medium">{risk.risk}</h3><p className="mt-1 text-sm text-muted-foreground">Consequence: {risk.consequence}</p><p className="mt-2 text-sm">Mitigation: {risk.mitigation}</p><p className="mt-2 text-xs text-muted-foreground">Owner: {risk.owner}</p></div><Badge variant={risk.status === "Open" ? "secondary" : "default"}>{risk.status}</Badge></div></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Decision log</CardTitle><CardDescription>Questions that affect delivery.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{scenarioA.decisions.map((decision) => <div key={decision.id} className="flex items-center justify-between gap-4 rounded-lg border p-4"><div><p className="text-xs font-medium text-muted-foreground">{decision.code} · Needed by {decision.neededBy}</p><p className="font-medium">{decision.question}</p>{decision.decision && <p className="mt-1 text-sm text-muted-foreground">Decision: {decision.decision}</p>}</div><Badge variant={decision.status === "Blocking" ? "destructive" : "secondary"}>{decision.status}</Badge></div>)}</CardContent></Card>
  </div>;
}
 
