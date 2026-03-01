"use client";

import React from "react";
import {
  AlertCircle,
  BarChart3,
  ExternalLink,
  TestTube,
  BookOpen,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SelectedWorkflowData } from "../dependencies-types";

interface SelectedWorkflowSheetProps {
  selectedWorkflow: SelectedWorkflowData;
  onClose: () => void;
}

export function SelectedWorkflowSheet({
  selectedWorkflow,
  onClose,
}: SelectedWorkflowSheetProps) {
  return (
    <div className="border-t bg-background p-4">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg">
              {selectedWorkflow.workflow.name}
            </h3>
            {selectedWorkflow.node.isCircular && (
              <Badge variant="destructive">
                <AlertCircle className="size-3" />
                Circular
              </Badge>
            )}
            {selectedWorkflow.impact.impactLevel === "critical" && (
              <Badge variant="destructive">
                <Zap className="size-3" />
                Critical
              </Badge>
            )}
          </div>
          {selectedWorkflow.workflow.category && (
            <Badge variant="outline">
              {selectedWorkflow.workflow.category}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {/* Quick Stats */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-2xl font-bold">
                {selectedWorkflow.workflow.actions.length}
              </div>
              <div className="text-xs text-muted-foreground">Actions</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-2xl font-bold">
                {selectedWorkflow.node.outDegree}
              </div>
              <div className="text-xs text-muted-foreground">Dependencies</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-2xl font-bold">
                {selectedWorkflow.node.inDegree}
              </div>
              <div className="text-xs text-muted-foreground">Dependents</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-2xl font-bold">
                {selectedWorkflow.impact.affectedCount}
              </div>
              <div className="text-xs text-muted-foreground">Impact</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 mt-4">
        <Button size="sm" variant="outline">
          <ExternalLink className="size-4" />
          Open in Editor
        </Button>
        <Button size="sm" variant="outline">
          <BarChart3 className="size-4" />
          View Metrics
        </Button>
        <Button size="sm" variant="outline">
          <TestTube className="size-4" />
          Run Tests
        </Button>
        <Button size="sm" variant="outline">
          <BookOpen className="size-4" />
          Documentation
        </Button>
      </div>
    </div>
  );
}
