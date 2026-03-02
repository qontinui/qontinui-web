"use client";

import { useState } from "react";
import { formatVariableValue } from "@/hooks/useWorkflowVariables";
import type {
  WorkflowVariable,
  VariableScope,
} from "@/types/workflow-variables";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Copy,
  ChevronDown,
  ChevronRight,
  Activity,
  Database,
  Globe,
} from "lucide-react";
import { toast } from "sonner";

function getScopeBadgeVariant(
  scope: VariableScope
): "default" | "secondary" | "outline" {
  switch (scope) {
    case "execution":
      return "default";
    case "workflow":
      return "secondary";
    case "global":
      return "outline";
    default:
      return "default";
  }
}

function getScopeIcon(scope: VariableScope) {
  switch (scope) {
    case "execution":
      return <Activity className="w-3 h-3" />;
    case "workflow":
      return <Database className="w-3 h-3" />;
    case "global":
      return <Globe className="w-3 h-3" />;
    default:
      return null;
  }
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 1) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

export function VariableRow({ variable }: { variable: WorkflowVariable }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isComplex =
    typeof variable.value === "object" && variable.value !== null;

  const handleCopy = async () => {
    try {
      const text =
        typeof variable.value === "object"
          ? JSON.stringify(variable.value, null, 2)
          : String(variable.value);
      await navigator.clipboard.writeText(text);
      toast.success(`Copied "${variable.name}" to clipboard`);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <>
      <TableRow className="hover:bg-surface-raised/50 transition-colors">
        <TableCell className="w-8">
          {isComplex && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-6 w-6 p-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          )}
        </TableCell>

        <TableCell className="font-mono text-sm text-white">
          {variable.name}
        </TableCell>

        <TableCell className="max-w-md">
          <div className="font-mono text-sm text-text-secondary truncate">
            {formatVariableValue(variable.value, 80)}
          </div>
        </TableCell>

        <TableCell>
          <Badge
            variant={getScopeBadgeVariant(variable.scope)}
            className="gap-1"
          >
            {getScopeIcon(variable.scope)}
            {variable.scope}
          </Badge>
        </TableCell>

        <TableCell className="text-sm text-text-muted">
          {variable.type}
        </TableCell>

        <TableCell className="text-sm text-text-muted">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                {formatRelativeTime(variable.last_updated)}
              </TooltipTrigger>
              <TooltipContent>
                {new Date(variable.last_updated).toLocaleString()}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>

        <TableCell className="text-right">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8 w-8 p-0"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy value</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
      </TableRow>

      {isExpanded && isComplex && (
        <TableRow>
          <TableCell colSpan={7} className="bg-surface-canvas/50 p-4">
            <pre className="text-xs text-text-secondary overflow-x-auto">
              {JSON.stringify(variable.value, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

interface VariableTableProps {
  variables: WorkflowVariable[];
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
}

export function VariableTable({
  variables,
  emptyIcon,
  emptyTitle,
  emptyDescription,
}: VariableTableProps) {
  if (variables.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto text-text-muted mb-4 flex items-center justify-center">
          {emptyIcon}
        </div>
        <h3 className="text-xl font-semibold text-text-secondary mb-2">
          {emptyTitle}
        </h3>
        <p className="text-text-muted">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Last Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {variables.map((variable) => (
          <VariableRow
            key={`${variable.scope}-${variable.name}`}
            variable={variable}
          />
        ))}
      </TableBody>
    </Table>
  );
}
