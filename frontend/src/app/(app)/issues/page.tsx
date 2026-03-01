"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  Filter,
  RefreshCw,
  Bug,
  FileText,
  ImageIcon,
  Terminal,
  Brain,
} from "lucide-react";
import { useIssues, useIssueStats, useUpdateIssue } from "@/hooks/useIssues";
import { useProjects } from "@/hooks/use-projects";
import {
  ISSUE_SEVERITY_CONFIG,
  ISSUE_SOURCE_CONFIG,
  ISSUE_STATUS_CONFIG,
  IssueSeverity,
  IssueSourceType,
  IssueStatus,
  type DetectedIssue,
  type IssueFilters,
} from "@/types/detected-issue";
import { formatDistanceToNow } from "date-fns";

const severityOrder = ["critical", "high", "medium", "low"];

function IssueCard({
  issue,
  onStatusChange,
}: {
  issue: DetectedIssue;
  onStatusChange: (id: string, status: string, resolution?: string) => void;
}) {
  const severityConfig = ISSUE_SEVERITY_CONFIG[issue.severity as IssueSeverity];
  const statusConfig = ISSUE_STATUS_CONFIG[issue.status as IssueStatus];
  const sourceConfig =
    ISSUE_SOURCE_CONFIG[issue.source.type as IssueSourceType];

  const getSourceIcon = () => {
    switch (issue.source.type) {
      case "log":
        return <FileText className="w-3 h-3" />;
      case "screenshot":
        return <ImageIcon className="w-3 h-3" aria-hidden="true" />;
      case "console":
        return <Terminal className="w-3 h-3" />;
      case "ai_analysis":
        return <Brain className="w-3 h-3" />;
      default:
        return <Bug className="w-3 h-3" />;
    }
  };

  return (
    <Card className="bg-muted border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge
                className={`${severityConfig.bgColor} ${severityConfig.color} border`}
              >
                {severityConfig.label}
              </Badge>
              <Badge
                variant="outline"
                className={`${statusConfig.bgColor} ${statusConfig.color} border`}
              >
                {statusConfig.label}
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1">
                {getSourceIcon()}
                {sourceConfig.label}
              </Badge>
            </div>

            <h3 className="font-semibold text-foreground mb-1 truncate">
              {issue.title}
            </h3>

            {issue.description && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {issue.description}
              </p>
            )}

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {issue.file && (
                <span className="truncate max-w-[200px]" title={issue.file}>
                  {issue.file}
                  {issue.line && `:${issue.line}`}
                </span>
              )}
              <span>
                {formatDistanceToNow(new Date(issue.detected_at), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>

          {issue.status !== "resolved" && issue.status !== "skipped" && (
            <div className="flex gap-2">
              {issue.status === "detected" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStatusChange(issue.id, "in_progress")}
                  className="text-yellow-400 border-yellow-400/50 hover:bg-yellow-400/10"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  Start
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onStatusChange(issue.id, "resolved")}
                className="text-green-400 border-green-400/50 hover:bg-green-400/10"
              >
                <CheckCircle className="w-3 h-3 mr-1" />
                Resolve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onStatusChange(issue.id, "skipped")}
                className="text-muted-foreground hover:text-foreground"
              >
                <XCircle className="w-3 h-3" />
              </Button>
            </div>
          )}

          {issue.status === "resolved" && issue.resolution && (
            <div className="text-xs text-green-400 max-w-[200px]">
              {issue.resolution}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatsCards({ projectId }: { projectId?: string }) {
  const { data: stats, isLoading } = useIssueStats(projectId);

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="bg-muted border-border">
            <CardContent className="p-4">
              <div className="h-16 animate-pulse bg-border rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const unresolved =
    (stats.by_status["detected"] || 0) + (stats.by_status["in_progress"] || 0);
  const critical = stats.by_severity["critical"] || 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <Card className="bg-muted border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Issues</p>
              <p className="text-2xl font-bold text-foreground">
                {stats.total}
              </p>
            </div>
            <Bug className="w-8 h-8 text-blue-400" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Unresolved</p>
              <p className="text-2xl font-bold text-yellow-400">{unresolved}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-yellow-400" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Critical</p>
              <p className="text-2xl font-bold text-red-400">{critical}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Resolved Today</p>
              <p className="text-2xl font-bold text-green-400">
                {stats.resolved_today}
              </p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function IssuesPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<IssueFilters>({
    project_id: searchParams.get("project") || undefined,
    status: (searchParams.get("status") as IssueStatus) || undefined,
    severity: (searchParams.get("severity") as IssueSeverity) || undefined,
  });

  const { data: issuesData, isLoading, refetch } = useIssues(filters);
  const { data: projects } = useProjects();
  const updateIssueMutation = useUpdateIssue();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const handleStatusChange = async (
    id: string,
    status: string,
    resolution?: string
  ) => {
    try {
      await updateIssueMutation.mutateAsync({
        id,
        data: { status: status as IssueStatus, resolution },
      });
    } catch (error) {
      console.error("Failed to update issue:", error);
    }
  };

  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const issues = issuesData?.issues || [];
  const sortedIssues = [...issues].sort((a, b) => {
    const severityDiff =
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    if (severityDiff !== 0) return severityDiff;

    if (a.status === "resolved" && b.status !== "resolved") return 1;
    if (a.status !== "resolved" && b.status === "resolved") return -1;

    return (
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );
  });

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">
          Detected Issues
        </h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <StatsCards projectId={filters.project_id} />

        <div className="flex items-center gap-4 flex-wrap mb-6 p-4 rounded-lg bg-muted border border-border">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filters:</span>
          </div>

          <Select
            value={filters.project_id || "all"}
            onValueChange={(value) =>
              setFilters((f) => ({
                ...f,
                project_id: value === "all" ? undefined : value,
              }))
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects?.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.status || "all"}
            onValueChange={(value) =>
              setFilters((f) => ({
                ...f,
                status: value === "all" ? undefined : (value as IssueStatus),
              }))
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="detected">Detected</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.severity || "all"}
            onValueChange={(value) =>
              setFilters((f) => ({
                ...f,
                severity:
                  value === "all" ? undefined : (value as IssueSeverity),
              }))
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i} className="bg-muted border-border">
                <CardContent className="p-4">
                  <div className="h-20 animate-pulse bg-border rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : sortedIssues.length === 0 ? (
          <div className="p-8 text-center">
            <Bug className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground mb-2">
              No Issues Found
            </h3>
            <p className="text-sm text-muted-foreground">
              Issues detected during AI-assisted automation will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}

        {issuesData && issuesData.total > 0 && (
          <p className="text-sm text-muted-foreground mt-4 text-center">
            Showing {sortedIssues.length} of {issuesData.total} issues
          </p>
        )}
      </main>
    </div>
  );
}

export default function IssuesPage() {
  return (
    <Suspense fallback={null}>
      <IssuesPageContent />
    </Suspense>
  );
}
