/**
 * Region Analysis Job List Component
 *
 * Displays a list of region analysis jobs with filtering and detail viewing
 */

"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Eye,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Grid3x3,
} from "lucide-react";
import { toast } from "sonner";
import {
  listRegionAnalysisJobs,
  getRegionAnalysisJob,
  deleteRegionAnalysisJob,
  type RegionAnalysisJob,
  type RegionAnalysisJobDetail,
} from "@/services/regionAnalysis";
import { RegionAnalysisResults } from "./RegionAnalysisResults";

interface RegionJobListProps {
  token: string;
  annotationSetId?: string;
  onJobSelect?: (job: RegionAnalysisJobDetail) => void;
}

export function RegionJobList({
  token,
  annotationSetId,
  onJobSelect,
}: RegionJobListProps) {
  const [jobs, setJobs] = useState<RegionAnalysisJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedJob, setSelectedJob] =
    useState<RegionAnalysisJobDetail | null>(null);
  const [jobToDelete, setJobToDelete] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const pageSize = 20;

  useEffect(() => {
    loadJobs();
  }, [token, annotationSetId, statusFilter, page]);

  const loadJobs = async () => {
    try {
      setIsLoading(true);
      const data = await listRegionAnalysisJobs(token, {
        annotation_set_id: annotationSetId,
        status: statusFilter === "all" ? undefined : statusFilter,
        page,
        page_size: pageSize,
      });
      setJobs(data.jobs);
      setTotal(data.total);
    } catch (error) {
      console.error("Error loading jobs:", error);
      toast.error("Failed to load region analysis jobs");
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewJob = async (jobId: string) => {
    try {
      setIsLoadingDetail(true);
      const job = await getRegionAnalysisJob(jobId, token);
      setSelectedJob(job);

      if (onJobSelect) {
        onJobSelect(job);
      }
    } catch (error) {
      console.error("Error loading job details:", error);
      toast.error("Failed to load job details");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete) return;

    try {
      await deleteRegionAnalysisJob(jobToDelete, token);
      toast.success("Region analysis job deleted");
      setJobToDelete(null);
      loadJobs();

      // Close detail dialog if deleted job was open
      if (selectedJob?.id === jobToDelete) {
        setSelectedJob(null);
      }
    } catch (error) {
      console.error("Error deleting job:", error);
      toast.error("Failed to delete job");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<
      string,
      "default" | "secondary" | "destructive" | "outline"
    > = {
      completed: "default",
      running: "secondary",
      failed: "destructive",
      pending: "outline",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Grid3x3 className="h-5 w-5" />
                Region Analysis History
              </CardTitle>
              <CardDescription>
                {total} region analysis job{total !== 1 ? "s" : ""}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>

              <Button onClick={loadJobs} variant="outline" size="icon">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No region analysis jobs found</p>
              {statusFilter !== "all" && (
                <Button
                  variant="link"
                  onClick={() => setStatusFilter("all")}
                  className="mt-2"
                >
                  Clear filter
                </Button>
              )}
            </div>
          ) : (
            <>
              <ScrollArea className="h-96">
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 border rounded hover:bg-accent transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusIcon(job.status)}
                          <span className="font-medium truncate">
                            {job.analyzers_used.join(", ")}
                          </span>
                          {getStatusBadge(job.status)}
                        </div>

                        <div className="text-xs text-muted-foreground space-y-1">
                          <div className="flex items-center gap-2">
                            {job.total_fused_regions > 0
                              ? `${job.total_fused_regions} fused region${
                                  job.total_fused_regions > 1 ? "s" : ""
                                }`
                              : `${job.total_regions_found} detection${
                                  job.total_regions_found > 1 ? "s" : ""
                                }`}
                            {job.total_grid_cells > 0 && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Grid3x3 className="h-3 w-3" />
                                  {job.total_grid_cells} cell
                                  {job.total_grid_cells > 1 ? "s" : ""}
                                </span>
                              </>
                            )}
                            {job.fusion_enabled && (
                              <>
                                <span>•</span>
                                <span>Fusion enabled</span>
                              </>
                            )}
                          </div>
                          <div>{new Date(job.created_at).toLocaleString()}</div>
                          {job.error_message && (
                            <div className="text-red-500 line-clamp-1">
                              Error: {job.error_message}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          onClick={() => handleViewJob(job.id)}
                          variant="ghost"
                          size="icon"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          onClick={() => setJobToDelete(job.id)}
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Pagination */}
              {total > pageSize && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Showing {(page - 1) * pageSize + 1} -{" "}
                    {Math.min(page * pageSize, total)} of {total}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      variant="outline"
                      size="sm"
                    >
                      Previous
                    </Button>
                    <Button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page * pageSize >= total}
                      variant="outline"
                      size="sm"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Job Detail Dialog */}
      <Dialog
        open={!!selectedJob}
        onOpenChange={(open) => !open && setSelectedJob(null)}
      >
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Region Analysis Job Details</DialogTitle>
            <DialogDescription>
              {selectedJob && (
                <>
                  Job ID: {selectedJob.id} •{" "}
                  {new Date(selectedJob.created_at).toLocaleString()}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {isLoadingDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : selectedJob ? (
            <div className="space-y-4">
              {/* Job Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="font-medium">Status</div>
                      <div className="text-muted-foreground">
                        {selectedJob.status}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Analyzers</div>
                      <div className="text-muted-foreground">
                        {selectedJob.analyzers_used.join(", ")}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Fusion</div>
                      <div className="text-muted-foreground">
                        {selectedJob.fusion_enabled ? "Enabled" : "Disabled"}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Regions Found</div>
                      <div className="text-muted-foreground">
                        {selectedJob.total_regions_found} total,{" "}
                        {selectedJob.total_fused_regions} fused
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">Grid Cells</div>
                      <div className="text-muted-foreground flex items-center gap-1">
                        <Grid3x3 className="h-3 w-3" />
                        {selectedJob.total_grid_cells} cell
                        {selectedJob.total_grid_cells !== 1 ? "s" : ""}
                      </div>
                    </div>
                    {selectedJob.started_at && (
                      <div>
                        <div className="font-medium">Started</div>
                        <div className="text-muted-foreground">
                          {new Date(selectedJob.started_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                    {selectedJob.completed_at && (
                      <div>
                        <div className="font-medium">Completed</div>
                        <div className="text-muted-foreground">
                          {new Date(selectedJob.completed_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Results */}
              {selectedJob.fused_regions &&
                selectedJob.fused_regions.length > 0 && (
                  <RegionAnalysisResults
                    results={{
                      analysis_job_id: selectedJob.id,
                      annotation_set_id: selectedJob.annotation_set_id,
                      analyzer_results: [], // Not included in job detail
                      fused_regions: selectedJob.fused_regions,
                      analyzer_statistics:
                        selectedJob.analyzer_statistics || {},
                      fusion_stats: {
                        total_regions: selectedJob.total_fused_regions,
                        avg_confidence:
                          selectedJob.fused_regions.reduce(
                            (sum, r) => sum + r.confidence,
                            0
                          ) / selectedJob.fused_regions.length,
                        multi_vote_regions: selectedJob.fused_regions.filter(
                          (r) => r.votes > 1
                        ).length,
                        total_grid_cells: selectedJob.total_grid_cells,
                      },
                      status: selectedJob.status,
                    }}
                  />
                )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!jobToDelete}
        onOpenChange={(open) => !open && setJobToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Region Analysis Job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this region analysis job and all its
              results. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteJob}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
