import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: string;
  detail?: string;
  children?: ReactNode;
  bridge: string;
}

export function KpiCard({ label, value, detail, children, bridge }: KpiCardProps) {
  return (
    <Card data-ui-bridge-id={bridge}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {children}
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}
