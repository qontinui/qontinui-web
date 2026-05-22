"use client";

/**
 * Region Analysis Page
 *
 * Admin page for running and viewing region detection analysis (including grid detection)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Grid3x3 } from "lucide-react";
import {
  RegionAnalysisPanel,
  RegionAnalysisResults,
  RegionJobList,
} from "@/components/region-analysis";
import type { RegionAnalysisResponse } from "@/services/regionAnalysis";

interface AnnotationSet {
  id: string;
  screenshot_name: string;
  screenshot_url: string;
  image_width: number;
  image_height: number;
  notes?: string;
  created_at: string;
  annotations_count: number;
}

export default function RegionAnalysisPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState<string>("");

  // Annotation sets
  const [annotationSets, setAnnotationSets] = useState<AnnotationSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  const [isLoadingSets, setIsLoadingSets] = useState(true);

  // Analysis results
  const [analysisResults, setAnalysisResults] =
    useState<RegionAnalysisResponse | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"run" | "results" | "history">(
    "run"
  );

  useEffect(() => {
    if (user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
      return;
    }

    if (user) {
      setToken("cookie-auth");
    }
  }, [user, router]);

  // Load annotation sets
  useEffect(() => {
    if (token) {
      loadAnnotationSets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAnnotationSets is stable, only reload when token changes
  }, [token]);

  const loadAnnotationSets = async () => {
    try {
      setIsLoadingSets(true);
      // Use relative URL through Next.js proxy with credentials for cookie auth
      const response = await fetch("/api/v1/annotations/sets", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load annotation sets");
      }

      const data = await response.json();
      setAnnotationSets(data);

      // Select first set by default
      if (data.length > 0 && !selectedSetId) {
        setSelectedSetId(data[0].id);
      }
    } catch (error) {
      console.error("Error loading annotation sets:", error);
      toast.error("Failed to load annotation sets");
    } finally {
      setIsLoadingSets(false);
    }
  };

  const handleAnalysisComplete = (results: RegionAnalysisResponse) => {
    setAnalysisResults(results);
    toast.success("Region analysis complete! View results in the Results tab.");
  };

  const selectedSet = annotationSets.find((s) => s.id === selectedSetId);

  // Don't render until auth is confirmed
  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin")}
          >
            Admin
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">Region Analysis</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
          Annotation Set
        </div>
        <div className="px-6 py-3 border-b border-border">
          {isLoadingSets ? (
            <p className="text-sm text-muted-foreground">
              Loading annotation sets...
            </p>
          ) : annotationSets.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4 text-sm">
                No annotation sets found. Run an extraction first.
              </p>
              <Button
                size="sm"
                onClick={() => router.push("/automation-builder/extraction")}
              >
                Go to Extraction
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Select annotation set" />
                </SelectTrigger>
                <SelectContent>
                  {annotationSets.map((set) => (
                    <SelectItem key={set.id} value={set.id}>
                      <div className="flex flex-col items-start">
                        <span>{set.screenshot_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {set.image_width} x {set.image_height}px •{" "}
                          {set.annotations_count} annotation
                          {set.annotations_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedSet && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    <span className="font-medium" data-content-role="label">
                      Size:
                    </span>{" "}
                    <span
                      data-content-role="metric"
                      data-content-label="image-dimensions"
                      className="tabular-nums"
                    >
                      {selectedSet.image_width} x {selectedSet.image_height}px
                    </span>
                  </span>
                  <span>
                    <span className="font-medium" data-content-role="label">
                      Elements:
                    </span>{" "}
                    <span
                      data-content-role="metric"
                      data-content-label="annotations-count"
                      className="tabular-nums"
                    >
                      {selectedSet.annotations_count}
                    </span>
                  </span>
                  <span>
                    <span className="font-medium" data-content-role="label">
                      Created:
                    </span>{" "}
                    <span data-content-role="body-text">
                      {new Date(selectedSet.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  {selectedSet.notes && (
                    <span
                      data-content-role="description"
                      className="truncate max-w-xs"
                    >
                      {selectedSet.notes}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {selectedSetId && (
          <>
            <div className="flex items-center gap-1 px-6 py-2 border-b border-border shrink-0">
              {(
                [
                  { key: "run", label: "Run Analysis" },
                  { key: "results", label: "Results" },
                  { key: "history", label: "History" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    activeTab === key
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-6">
              {activeTab === "run" && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1">
                    <RegionAnalysisPanel
                      annotationSetId={selectedSetId}
                      token={token}
                      onAnalysisComplete={handleAnalysisComplete}
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
                      Screenshot Preview — {selectedSet?.screenshot_name}
                    </div>
                    {selectedSet && (
                      <div className="border border-border rounded-b-lg overflow-hidden bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element -- External URL from backend, dimensions unknown */}
                        <img
                          src={selectedSet.screenshot_url}
                          alt={selectedSet.screenshot_name}
                          className="w-full h-auto"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "results" && (
                <>
                  {analysisResults ? (
                    <RegionAnalysisResults
                      results={analysisResults}
                      imageUrl={selectedSet?.screenshot_url}
                      imageWidth={selectedSet?.image_width}
                      imageHeight={selectedSet?.image_height}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Grid3x3 className="h-8 w-8 mb-2" />
                      <p className="text-sm">No region analysis results yet</p>
                      <p className="text-xs mt-1">
                        Run a region analysis to see results here
                      </p>
                    </div>
                  )}
                </>
              )}

              {activeTab === "history" && (
                <RegionJobList
                  token={token}
                  annotationSetId={selectedSetId}
                  onJobSelect={(job) => {
                    const results: RegionAnalysisResponse = {
                      analysis_job_id: job.id,
                      annotation_set_id: job.annotation_set_id,
                      analyzer_results: [],
                      fused_regions: job.fused_regions,
                      analyzer_statistics: job.analyzer_statistics || {},
                      fusion_stats: {
                        total_regions: job.total_fused_regions,
                        avg_confidence:
                          job.fused_regions.reduce(
                            (sum, r) => sum + r.confidence,
                            0
                          ) / job.fused_regions.length,
                        multi_vote_regions: job.fused_regions.filter(
                          (r) => r.votes > 1
                        ).length,
                        total_grid_cells: job.total_grid_cells,
                      },
                      status: job.status,
                    };
                    setAnalysisResults(results);
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
