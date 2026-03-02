import React from "react";
import { Filter, RefreshCw, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FilterStatus } from "../_hooks/useTemplateCandidates";

interface CandidateStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface ReviewPanelHeaderProps {
  stats: CandidateStats;
  filterStatus: FilterStatus;
  onFilterChange: (status: FilterStatus) => void;
  onRefresh: () => void;
  loading: boolean;
  onGenerateStateMachine: () => void;
}

export function ReviewPanelHeader({
  stats,
  filterStatus,
  onFilterChange,
  onRefresh,
  loading,
  onGenerateStateMachine,
}: ReviewPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">Template Candidates</h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{stats.total} total</Badge>
          <Badge variant="secondary" className="text-yellow-600">
            {stats.pending} pending
          </Badge>
          <Badge variant="secondary" className="text-green-600">
            {stats.approved} approved
          </Badge>
          <Badge variant="secondary" className="text-red-600">
            {stats.rejected} rejected
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select
            value={filterStatus}
            onValueChange={(v) => onFilterChange(v as FilterStatus)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="modified">Modified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw
            className={cn("h-4 w-4 mr-2", loading && "animate-spin")}
          />
          Refresh
        </Button>

        {stats.approved > 0 && (
          <Button size="sm" onClick={onGenerateStateMachine}>
            <GitBranch className="h-4 w-4 mr-2" />
            Generate State Machine
          </Button>
        )}
      </div>
    </div>
  );
}
