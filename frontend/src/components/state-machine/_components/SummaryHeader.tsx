"use client";

import type { StateDiscoveryResult } from "@/types/state-machine";
import { SOURCE_TYPE_LABELS, SOURCE_TYPE_COLORS } from "@/types/state-machine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Layers,
  ArrowRight,
  Image as ImageIcon,
  Percent,
  Box,
} from "lucide-react";
import { StatCard } from "./StatCard";

interface SummaryHeaderProps {
  result: StateDiscoveryResult;
}

export function SummaryHeader({ result }: SummaryHeaderProps) {
  return (
    <Card className="bg-surface-raised/60 border-border-subtle">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">{result.name}</CardTitle>
            <Badge
              variant="outline"
              className={SOURCE_TYPE_COLORS[result.sourceType]}
            >
              {SOURCE_TYPE_LABELS[result.sourceType]}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <Percent className="h-4 w-4" />
                    <span>{Math.round(result.confidence * 100)}%</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Overall confidence score</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        {result.description && (
          <p className="text-sm text-text-muted mt-1">{result.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={<Layers className="h-4 w-4" />}
            label="States"
            value={result.stateCount}
          />
          <StatCard
            icon={<ImageIcon className="h-4 w-4" />}
            label="Images"
            value={result.imageCount}
          />
          <StatCard
            icon={<ArrowRight className="h-4 w-4" />}
            label="Transitions"
            value={result.transitionCount}
          />
          <StatCard
            icon={<Box className="h-4 w-4" />}
            label="Elements"
            value={result.uniqueElementCount}
          />
        </div>
      </CardContent>
    </Card>
  );
}
