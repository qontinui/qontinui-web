import React from "react";
import { Gauge, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ComplexityAnalysis } from "@/services/workflow-complexity-analyzer";
import { ComplexityGauge } from "./ComplexityGauge";
import { getComplexityColor } from "../workflow-metrics-panel-utils";
import type { ComplexityTableRow } from "../workflow-metrics-panel-types";

interface ComplexityTabProps {
  complexityMetrics: ComplexityAnalysis;
  complexityTableData: ComplexityTableRow[];
}

export function ComplexityTab({
  complexityMetrics,
  complexityTableData,
}: ComplexityTabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Complexity Gauge */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Complexity Score
          </CardTitle>
          <CardDescription>Overall workflow complexity rating</CardDescription>
        </CardHeader>
        <CardContent>
          <ComplexityGauge
            score={complexityMetrics.complexityScore}
            rating={complexityMetrics.complexityRating}
          />
          <Separator className="my-4" />
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rating:</span>
              <Badge
                variant="outline"
                style={{
                  borderColor: getComplexityColor(
                    complexityMetrics.complexityRating
                  ),
                }}
              >
                {complexityMetrics.complexityRating.toUpperCase()}
              </Badge>
            </div>
            {complexityMetrics.hasCycles && (
              <div className="flex items-center gap-2 text-orange-500">
                <AlertCircle className="h-4 w-4" />
                <span>Contains cycles (loops)</span>
              </div>
            )}
            {complexityMetrics.disconnectedComponents > 1 && (
              <div className="flex items-center gap-2 text-orange-500">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {complexityMetrics.disconnectedComponents} disconnected
                  components
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Complexity Metrics Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Metrics</CardTitle>
          <CardDescription>Complexity breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {complexityTableData.map((item) => (
                <div key={item.metric} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{item.metric}</span>
                    <span className="text-sm font-bold">{item.value}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                  <Separator />
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
