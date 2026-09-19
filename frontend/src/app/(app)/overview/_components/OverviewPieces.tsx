"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scenarioA } from "../mock-data";

export function OverviewHeader() {
  return null;
}

export function SummaryPage({ canEdit: _canEdit = false }: { canEdit?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>{scenarioA.settings.projectName}</CardTitle></CardHeader>
      <CardContent className="text-sm text-muted-foreground">Use the project overview navigation to explore the latest status.</CardContent>
    </Card>
  );
}

export function OverviewSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-4"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>;
}
