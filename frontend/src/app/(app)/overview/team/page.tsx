"use client";

import { Users, Clock, UserPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/overview/KpiCard";
import { scenarioA } from "../mock-data";

export default function TeamPage() {
  const people = Array.from(new Set(scenarioA.timeEntries.map((entry) => entry.person)));
  const hours = scenarioA.timeEntries.reduce((sum, entry) => sum + entry.hours, 0);
  return <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.team.page">
    <div className="flex items-center justify-between"><div><p className="text-sm font-medium text-primary">Team</p><h2 className="text-xl font-semibold">People and effort</h2><p className="text-sm text-muted-foreground">Who is contributing and where time is going.</p></div><Button><UserPlus data-icon="inline-start" />Add person</Button></div>
    <section className="grid gap-4 md:grid-cols-3"><KpiCard label="Contributors" value={String(people.length)} bridge="overview.team.kpi.people"><Users className="size-5 text-muted-foreground" /></KpiCard><KpiCard label="Hours logged" value={String(hours)} detail="Across recorded entries" bridge="overview.team.kpi.hours"><Clock className="size-5 text-muted-foreground" /></KpiCard><KpiCard label="Billing model" value={scenarioA.settings.labourBilling === "unbilled" ? "Unbilled" : "Day rates"} detail="Configured in project settings" bridge="overview.team.kpi.billing" /></section>
    <Card><CardHeader><CardTitle>Contributors</CardTitle><CardDescription>Recorded effort by person.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{people.map((person) => { const personHours = scenarioA.timeEntries.filter((entry) => entry.person === person).reduce((sum, entry) => sum + entry.hours, 0); return <div key={person} className="flex items-center justify-between rounded-lg border p-4"><div><p className="font-medium">{person}</p><p className="text-sm text-muted-foreground">Project contributor</p></div><span className="text-sm font-medium">{personHours}h</span></div>; })}</CardContent></Card>
  </div>;
}
 
