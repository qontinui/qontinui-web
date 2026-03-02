"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StateCoverage } from "@/services/testing-service";

interface CoverageTabProps {
  stateCoverage: StateCoverage[];
}

export function CoverageTab({ stateCoverage }: CoverageTabProps) {
  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <CardTitle>State Coverage Summary</CardTitle>
        <CardDescription>How many times each state was visited</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-3">
            {stateCoverage.map((state) => {
              const stateSuccessRate =
                state.times_visited > 0
                  ? (
                      (state.successful_visits / state.times_visited) *
                      100
                    ).toFixed(0)
                  : "0";

              return (
                <div
                  key={state.state_name}
                  className="flex items-center justify-between p-4 rounded-lg bg-background/50 border border-border"
                >
                  <div className="flex-1">
                    <div className="font-medium mb-2">{state.state_name}</div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Visited: {state.times_visited} times</span>
                      <span className="text-green-500">
                        Success: {state.successful_visits}
                      </span>
                      <span className="text-red-400">
                        Failed: {state.failed_visits}
                      </span>
                      <span>
                        Avg: {state.average_duration_ms.toFixed(0)}
                        ms
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500"
                        style={{
                          width: `${stateSuccessRate}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">
                      {stateSuccessRate}%
                    </span>
                  </div>
                </div>
              );
            })}

            {stateCoverage.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No state coverage data yet
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
