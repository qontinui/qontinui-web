/**
 * Analysis Panel Component
 *
 * Allows users to select analyzers, configure parameters, and run analysis on annotation sets
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Play, Settings2, ChevronDown, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  listAnalyzers,
  runAnalysis,
  runQuickAnalysis,
  type AnalyzerInfo,
  type AnalysisResponse,
} from "@/services/analysis";

interface AnalysisPanelProps {
  annotationSetId: string;
  token: string;
  onAnalysisComplete?: (results: AnalysisResponse) => void;
}

export function AnalysisPanel({
  annotationSetId,
  token,
  onAnalysisComplete,
}: AnalysisPanelProps) {
  const [analyzers, setAnalyzers] = useState<AnalyzerInfo[]>([]);
  const [selectedAnalyzers, setSelectedAnalyzers] = useState<Set<string>>(
    new Set()
  );
  const [analyzerConfigs, setAnalyzerConfigs] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [isLoadingAnalyzers, setIsLoadingAnalyzers] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  // Analysis options
  const [fuseResults, setFuseResults] = useState(true);
  const [saveToDatabase, setSaveToDatabase] = useState(true);
  const [overlapThreshold, setOverlapThreshold] = useState(0.5);
  const [runInParallel, setRunInParallel] = useState(true);

  // Load available analyzers
  useEffect(() => {
    loadAnalyzers();
  }, [token]);

  const loadAnalyzers = async () => {
    try {
      setIsLoadingAnalyzers(true);
      const data = await listAnalyzers(token);
      setAnalyzers(data);

      // Select only analyzers that work with single screenshots by default
      // (required_screenshots <= 1)
      const singleScreenshotAnalyzers = data
        .filter((a) => a.required_screenshots <= 1)
        .map((a) => a.name);

      setSelectedAnalyzers(new Set(singleScreenshotAnalyzers));

      // Initialize configs with default parameters
      const configs: Record<string, Record<string, unknown>> = {};
      data.forEach((analyzer) => {
        configs[analyzer.name] = { ...analyzer.default_parameters };
      });
      setAnalyzerConfigs(configs);
    } catch (error) {
      console.error("Error loading analyzers:", error);
      toast.error("Failed to load analyzers");
    } finally {
      setIsLoadingAnalyzers(false);
    }
  };

  const toggleAnalyzer = (name: string) => {
    const newSelected = new Set(selectedAnalyzers);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedAnalyzers(newSelected);
  };

  const updateAnalyzerConfig = (
    analyzerName: string,
    param: string,
    value: unknown
  ) => {
    setAnalyzerConfigs((prev) => ({
      ...prev,
      [analyzerName]: {
        ...prev[analyzerName],
        [param]: value,
      },
    }));
  };

  const handleRunAnalysis = async () => {
    if (selectedAnalyzers.size === 0) {
      toast.error("Please select at least one analyzer");
      return;
    }

    try {
      setIsRunning(true);

      const results = await runAnalysis(
        {
          annotation_set_id: annotationSetId,
          analyzer_names: Array.from(selectedAnalyzers),
          analyzer_configs: analyzerConfigs,
          parallel: runInParallel,
          fuse_results: fuseResults,
          overlap_threshold: overlapThreshold,
          save_to_database: saveToDatabase,
        },
        token
      );

      toast.success(
        `Analysis complete! Found ${results.fused_elements?.length || 0} elements`
      );

      if (onAnalysisComplete) {
        onAnalysisComplete(results);
      }
    } catch (error) {
      console.error("Error running analysis:", error);
      toast.error("Analysis failed: " + (error as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleQuickAnalysis = async () => {
    if (selectedAnalyzers.size === 0) {
      toast.error("Please select at least one analyzer");
      return;
    }

    try {
      setIsRunning(true);

      const results = await runQuickAnalysis(
        {
          annotation_set_id: annotationSetId,
          analyzers: Array.from(selectedAnalyzers),
          fuse_results: fuseResults,
        },
        token
      );

      toast.success(`Quick analysis complete!`);

      if (onAnalysisComplete) {
        onAnalysisComplete(results);
      }
    } catch (error) {
      console.error("Error running quick analysis:", error);
      toast.error("Quick analysis failed");
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoadingAnalyzers) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Group analyzers by type
  const analyzersByType = analyzers.reduce(
    (acc, analyzer) => {
      if (!acc[analyzer.type]) {
        acc[analyzer.type] = [];
      }
      acc[analyzer.type]?.push(analyzer);
      return acc;
    },
    {} as Record<string, AnalyzerInfo[]>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis Configuration</CardTitle>
        <CardDescription>
          Select analyzers and configure parameters to detect GUI elements
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Analyzer Selection */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Select Analyzers</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedAnalyzers(new Set(analyzers.map((a) => a.name)))
                }
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedAnalyzers(new Set())}
              >
                Clear All
              </Button>
            </div>
          </div>

          <ScrollArea className="h-96">
            <div className="space-y-4">
              {Object.entries(analyzersByType).map(([type, typeAnalyzers]) => (
                <div key={type} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-medium">
                      {type.replace("_", " ").toUpperCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {typeAnalyzers.length} analyzer
                      {typeAnalyzers.length > 1 ? "s" : ""}
                    </span>
                  </div>

                  {typeAnalyzers.map((analyzer) => (
                    <Collapsible key={analyzer.name}>
                      <div
                        className={`border rounded-lg p-3 transition-colors ${
                          selectedAnalyzers.has(analyzer.name)
                            ? "border-primary bg-accent"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={selectedAnalyzers.has(analyzer.name)}
                                onCheckedChange={() =>
                                  toggleAnalyzer(analyzer.name)
                                }
                              />
                              <div>
                                <div className="font-medium">
                                  {analyzer.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  v{analyzer.version}
                                  {analyzer.supports_multi_screenshot &&
                                    " • Multi-screenshot"}
                                  {analyzer.required_screenshots > 1 &&
                                    ` • Requires ${analyzer.required_screenshots}+ screenshots`}
                                </div>
                              </div>
                            </div>
                          </div>

                          {selectedAnalyzers.has(analyzer.name) &&
                            Object.keys(analyzer.default_parameters).length >
                              0 && (
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <Settings2 className="h-4 w-4 mr-2" />
                                  Configure
                                  <ChevronDown className="h-4 w-4 ml-2" />
                                </Button>
                              </CollapsibleTrigger>
                            )}
                        </div>

                        <CollapsibleContent className="mt-3">
                          <Separator className="mb-3" />
                          <div className="space-y-3 pl-8">
                            {Object.entries(analyzer.default_parameters).map(
                              ([param, defaultValue]) => (
                                <div key={param} className="space-y-2">
                                  <Label className="text-sm">
                                    {param.replace(/_/g, " ")}
                                  </Label>
                                  {typeof defaultValue === "boolean" ? (
                                    <Switch
                                      checked={
                                        (analyzerConfigs[analyzer.name]?.[
                                          param
                                        ] ?? defaultValue) as
                                          | boolean
                                          | undefined
                                      }
                                      onCheckedChange={(checked) =>
                                        updateAnalyzerConfig(
                                          analyzer.name,
                                          param,
                                          checked
                                        )
                                      }
                                    />
                                  ) : typeof defaultValue === "number" ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="number"
                                        value={
                                          (analyzerConfigs[analyzer.name]?.[
                                            param
                                          ] ?? defaultValue) as
                                            | string
                                            | number
                                            | readonly string[]
                                            | undefined
                                        }
                                        onChange={(e) =>
                                          updateAnalyzerConfig(
                                            analyzer.name,
                                            param,
                                            parseFloat(e.target.value)
                                          )
                                        }
                                        className="w-24"
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        Default: {defaultValue}
                                      </span>
                                    </div>
                                  ) : (
                                    <Input
                                      type="text"
                                      value={String(
                                        analyzerConfigs[analyzer.name]?.[
                                          param
                                        ] ?? defaultValue
                                      )}
                                      onChange={(e) =>
                                        updateAnalyzerConfig(
                                          analyzer.name,
                                          param,
                                          e.target.value
                                        )
                                      }
                                    />
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <Separator />

        {/* Analysis Options */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Analysis Options</Label>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="fuse-results">Fuse Results</Label>
                <p className="text-xs text-muted-foreground">
                  Combine results from multiple analyzers
                </p>
              </div>
              <Switch
                id="fuse-results"
                checked={fuseResults}
                onCheckedChange={setFuseResults}
              />
            </div>

            {fuseResults && (
              <div className="space-y-2 pl-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="overlap-threshold" className="text-sm">
                    Overlap Threshold
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {overlapThreshold}
                  </span>
                </div>
                <Slider
                  id="overlap-threshold"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[overlapThreshold]}
                  onValueChange={(value) => setOverlapThreshold(value[0] ?? 0)}
                />
                <p className="text-xs text-muted-foreground">
                  IoU threshold for grouping overlapping elements
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="parallel">Run in Parallel</Label>
                <p className="text-xs text-muted-foreground">
                  Execute analyzers concurrently
                </p>
              </div>
              <Switch
                id="parallel"
                checked={runInParallel}
                onCheckedChange={setRunInParallel}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="save-db">Save to Database</Label>
                <p className="text-xs text-muted-foreground">
                  Store results for later review
                </p>
              </div>
              <Switch
                id="save-db"
                checked={saveToDatabase}
                onCheckedChange={setSaveToDatabase}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Action Buttons */}
        <div className="space-y-2">
          <Button
            onClick={handleRunAnalysis}
            disabled={isRunning || selectedAnalyzers.size === 0}
            className="w-full"
            size="lg"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Running Analysis...
              </>
            ) : (
              <>
                <Play className="mr-2 h-5 w-5" />
                Run Full Analysis
              </>
            )}
          </Button>

          <Button
            onClick={handleQuickAnalysis}
            disabled={isRunning || selectedAnalyzers.size === 0}
            variant="outline"
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Quick Test (No DB)
              </>
            )}
          </Button>

          {selectedAnalyzers.size > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {selectedAnalyzers.size} analyzer
              {selectedAnalyzers.size > 1 ? "s" : ""} selected
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
