"use client";

import {
  Play,
  Edit,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TestSuite } from "@/services/workflow-testing-service";
import type { SuiteStatistics } from "../test-suite-manager-types";

interface SuiteCardProps {
  suite: TestSuite;
  stats: SuiteStatistics;
  isRunning: boolean;
  onRun: (id: string) => void;
  onEdit: (suite: TestSuite) => void;
  onDelete: (id: string) => void;
}

export function SuiteCard({
  suite,
  stats,
  isRunning,
  onRun,
  onEdit,
  onDelete,
}: SuiteCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle>{suite.name}</CardTitle>
            {suite.description && (
              <CardDescription>{suite.description}</CardDescription>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => onRun(suite.id)}
              variant="secondary"
              size="sm"
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 className="animate-spin" />
                  Running
                </>
              ) : (
                <>
                  <Play />
                  Run
                </>
              )}
            </Button>
            <Button onClick={() => onEdit(suite)} variant="outline" size="sm">
              <Edit />
            </Button>
            <DestructiveButton
              onClick={() => onDelete(suite.id)}
              size="sm"
            >
              <Trash2 />
            </DestructiveButton>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {/* Total tests */}
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{stats.totalTests}</p>
              <p className="text-xs text-muted-foreground">Total Tests</p>
            </div>
          </div>

          {/* Pass rate */}
          <div className="flex items-center gap-2">
            {stats.passRate >= 80 ? (
              <CheckCircle2 className="size-4 text-green-500" />
            ) : stats.passRate >= 50 ? (
              <Clock className="size-4 text-yellow-500" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <div>
              <p className="text-2xl font-bold">
                {stats.passRate > 0 ? `${stats.passRate.toFixed(0)}%` : "N/A"}
              </p>
              <p className="text-xs text-muted-foreground">Pass Rate</p>
            </div>
          </div>

          {/* Last run */}
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                {stats.lastRun
                  ? new Date(stats.lastRun).toLocaleDateString()
                  : "Never"}
              </p>
              <p className="text-xs text-muted-foreground">Last Run</p>
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Badge variant="outline">
            {suite.executionOrder === "parallel" ? "Parallel" : "Sequential"}
          </Badge>
          {suite.stopOnFailure && (
            <Badge variant="outline">Stop on Failure</Badge>
          )}
        </div>

        {/* Tags */}
        {suite.tags && suite.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {suite.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
