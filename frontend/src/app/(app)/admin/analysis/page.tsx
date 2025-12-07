"use client";

/**
 * GUI Element Analysis Page
 *
 * Admin page for running and viewing GUI element detection analysis
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LayoutDashboard, Shield, Sparkles, Grid3x3 } from "lucide-react";
import {
  AnalysisPanel,
  AnalysisResults,
  AnalysisJobList,
} from "@/components/analysis";
import type { AnalysisResponse } from "@/services/analysis";

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

export default function AnalysisPage() {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState<string>("");

  // Annotation sets
  const [annotationSets, setAnnotationSets] = useState<AnnotationSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  const [isLoadingSets, setIsLoadingSets] = useState(true);

  // Analysis results
  const [analysisResults, setAnalysisResults] =
    useState<AnalysisResponse | null>(null);

  // Protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/dashboard");
      return;
    }

    // Get access token
    if (user) {
      const fetchToken = async () => {
        console.log(
          "[AnalysisPage] User authenticated, getting access token..."
        );
        const accessToken = await getAccessToken();
        console.log(
          "[AnalysisPage] Access token:",
          accessToken ? `${accessToken.substring(0, 20)}...` : "null"
        );
        if (accessToken) {
          setToken(accessToken);
        }
      };
      fetchToken();
    }
  }, [user, authLoading, router, getAccessToken]);

  // Load annotation sets
  useEffect(() => {
    // Only run in browser (not during SSR)
    if (typeof window === "undefined") return undefined;

    if (token) {
      // Small delay to ensure DOM is fully loaded and avoid race conditions
      const timer = setTimeout(() => {
        loadAnnotationSets();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [token]);

  const loadAnnotationSets = async () => {
    try {
      setIsLoadingSets(true);
      // Use relative URL to leverage Next.js proxy and avoid CORS
      const fullUrl = "/api/v1/annotations/";

      console.log("[AnalysisPage] Loading annotation sets...");
      console.log("[AnalysisPage] Full URL:", fullUrl);
      console.log(
        "[AnalysisPage] Token:",
        token ? `${token.substring(0, 20)}...` : "missing"
      );
      console.log("[AnalysisPage] Token length:", token?.length);
      console.log(
        "[AnalysisPage] User:",
        user
          ? { id: user.id, email: user.email, is_superuser: user.is_superuser }
          : "not loaded"
      );

      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      console.log("[AnalysisPage] Request headers:", headers);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(fullUrl, {
        method: "GET",
        headers,
        credentials: "include",
        mode: "cors",
        signal: controller.signal,
      }).catch((fetchError) => {
        clearTimeout(timeoutId);
        console.error("[AnalysisPage] Fetch error details:", {
          name: fetchError.name,
          message: fetchError.message,
          stack: fetchError.stack,
          cause: fetchError.cause,
        });
        throw fetchError;
      });

      clearTimeout(timeoutId);

      console.log("[AnalysisPage] Response received:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[AnalysisPage] Error response:", errorText);
        throw new Error(
          `Failed to load annotation sets: ${response.status} ${errorText}`
        );
      }

      const data = await response.json();
      console.log("[AnalysisPage] Loaded annotation sets:", data);
      setAnnotationSets(data);

      // Select first set by default
      if (data.length > 0 && !selectedSetId) {
        setSelectedSetId(data[0].id);
      }
    } catch (error) {
      console.error("[AnalysisPage] Error loading annotation sets:", error);
      if (error instanceof Error) {
        console.error("[AnalysisPage] Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }
      // Don't show error toast - this is expected when backend is starting or no data exists
    } finally {
      setIsLoadingSets(false);
    }
  };

  const handleAnalysisComplete = (results: AnalysisResponse) => {
    setAnalysisResults(results);
    toast.success("Analysis complete! View results in the Results tab.");
  };

  const selectedSet = annotationSets.find((s) => s.id === selectedSetId);

  // Don't render until auth is confirmed
  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div className="container mx-auto py-8">
      {/* Navigation Links */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard")}
          className="hover:bg-primary/10"
        >
          <LayoutDashboard className="mr-2 h-4 w-4" />
          Dashboard
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/admin")}
          className="hover:bg-secondary/10"
        >
          <Shield className="mr-2 h-4 w-4" />
          Admin
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/admin/annotations")}
          className="hover:bg-accent/10"
        >
          Annotations
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/admin/region-analysis")}
          className="hover:bg-accent/10"
        >
          <Grid3x3 className="mr-2 h-4 w-4" />
          Region Analysis
        </Button>
      </div>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">GUI Element Analysis</h1>
        </div>
        <p className="text-muted-foreground">
          Run automated analysis to detect GUI elements using multiple detection
          methods
        </p>
      </div>

      {/* Annotation Set Selector */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Annotation Set</CardTitle>
          <CardDescription>Choose an annotation set to analyze</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingSets ? (
            <p className="text-sm text-muted-foreground">
              Loading annotation sets...
            </p>
          ) : annotationSets.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">
                No annotation sets found. Create one first.
              </p>
              <Button onClick={() => router.push("/admin/annotations")}>
                Go to Annotations
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select annotation set" />
                </SelectTrigger>
                <SelectContent>
                  {annotationSets.map((set) => (
                    <SelectItem key={set.id} value={set.id}>
                      <div className="flex flex-col items-start">
                        <span>{set.screenshot_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {set.image_width} × {set.image_height}px •{" "}
                          {set.annotations_count} annotation
                          {set.annotations_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedSet && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>
                    <span className="font-medium">Size:</span>{" "}
                    {selectedSet.image_width} × {selectedSet.image_height}px
                  </div>
                  <div>
                    <span className="font-medium">Annotations:</span>{" "}
                    {selectedSet.annotations_count} element
                    {selectedSet.annotations_count !== 1 ? "s" : ""}
                  </div>
                  <div>
                    <span className="font-medium">Created:</span>{" "}
                    {new Date(selectedSet.created_at).toLocaleString()}
                  </div>
                  {selectedSet.notes && (
                    <div>
                      <span className="font-medium">Notes:</span>{" "}
                      {selectedSet.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Content */}
      {selectedSetId && (
        <Tabs defaultValue="run" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="run">Run Analysis</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="run" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Configuration Panel */}
              <div className="lg:col-span-1">
                <AnalysisPanel
                  annotationSetId={selectedSetId}
                  token={token}
                  onAnalysisComplete={handleAnalysisComplete}
                />
              </div>

              {/* Preview */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Screenshot Preview</CardTitle>
                  <CardDescription>
                    {selectedSet?.screenshot_name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedSet && (
                    <div className="border rounded-lg overflow-hidden bg-muted">
                      <img
                        src={selectedSet.screenshot_url}
                        alt={selectedSet.screenshot_name}
                        className="w-full h-auto"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="results" className="space-y-6">
            {analysisResults ? (
              <AnalysisResults
                results={analysisResults}
                imageUrl={selectedSet?.screenshot_url}
                imageWidth={selectedSet?.image_width}
                imageHeight={selectedSet?.image_height}
              />
            ) : (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    <Sparkles className="mx-auto h-12 w-12 mb-4" />
                    <p>No analysis results yet</p>
                    <p className="text-sm mt-2">
                      Run an analysis to see results here
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <AnalysisJobList
              token={token}
              annotationSetId={selectedSetId}
              onJobSelect={(job) => {
                // Convert job to AnalysisResponse format
                const results: AnalysisResponse = {
                  analysis_job_id: job.id,
                  annotation_set_id: job.annotation_set_id,
                  analyzer_results: [],
                  fused_elements: job.fused_elements,
                  analyzer_statistics: job.analyzer_statistics || {},
                  fusion_stats: {
                    total_elements: job.total_fused_elements,
                    avg_confidence:
                      job.fused_elements.reduce(
                        (sum, e) => sum + e.confidence,
                        0
                      ) / job.fused_elements.length,
                    multi_vote_elements: job.fused_elements.filter(
                      (e) => e.votes > 1
                    ).length,
                  },
                  status: job.status,
                };
                setAnalysisResults(results);
              }}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
