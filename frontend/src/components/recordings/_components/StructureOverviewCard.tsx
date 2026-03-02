"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { type DiscoveredStateStructure } from "@/types/recording";

interface StructureOverviewCardProps {
  structure: DiscoveredStateStructure;
}

export function StructureOverviewCard({
  structure,
}: StructureOverviewCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Structure Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total States</p>
            <p className="text-2xl font-bold">{structure.stats.total_states}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Transitions</p>
            <p className="text-2xl font-bold">
              {structure.stats.total_transitions}
            </p>
          </div>
        </div>
        <Separator />
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">High Confidence</span>
            <Badge variant="outline" className="text-green-600">
              {structure.stats.high_confidence_states}
            </Badge>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Medium Confidence</span>
            <Badge variant="outline" className="text-yellow-600">
              {structure.stats.medium_confidence_states}
            </Badge>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Low Confidence</span>
            <Badge variant="outline" className="text-red-600">
              {structure.stats.low_confidence_states}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
