"use client";

import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PassRateGroup } from "../test-results-types";

interface PassRateChartProps {
  passRateHistory: PassRateGroup[];
}

export function PassRateChart({ passRateHistory }: PassRateChartProps) {
  if (passRateHistory.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="size-5" />
          Pass Rate History
        </CardTitle>
        <CardDescription>Pass rate over recent test runs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-48 flex items-end gap-2">
          {passRateHistory.map((group, index) => (
            <div
              key={index}
              className="flex-1 flex flex-col items-center gap-2"
            >
              <div className="w-full flex items-end justify-center h-full">
                <div
                  className={cn(
                    "w-full rounded-t",
                    group.passRate >= 80
                      ? "bg-green-500"
                      : group.passRate >= 50
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  )}
                  style={{ height: `${group.passRate}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">{group.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
