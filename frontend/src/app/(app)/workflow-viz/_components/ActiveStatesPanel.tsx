import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Layers, Loader2, Radio, WifiOff, Eye, History } from "lucide-react";
import type {
  ConnectionState,
  ImageRecognitionEvent,
} from "@/hooks/useExecutionEvents";
import type { State, ImageAsset } from "@/contexts/automation-context/types";
import type { RunnerMonitor } from "@/lib/schemas/geometry";
import type { TestRunSummary, HistoricalResult } from "../types";
import { ActiveStatesCanvas } from "@/components/workflow-viz/ActiveStatesCanvas";

interface ActiveStatesPanelProps {
  states: State[];
  images: ImageAsset[];
  monitors: RunnerMonitor[];
  isLiveMode: boolean;
  onLiveModeChange: (checked: boolean) => void;
  canvasMode: "perception" | "config";
  onCanvasModeChange: (checked: boolean) => void;
  liveActiveStateIdsArray: string[];
  activeStateIds: string[];
  isConnected: boolean;
  connectionState: ConnectionState;
  testRuns: TestRunSummary[];
  selectedTestRunId: string | null;
  onTestRunChange: (value: string | null) => void;
  loadingTestRuns: boolean;
  loadingHistoricalData: boolean;
  historicalResults: HistoricalResult[];
  liveActiveStateIds: Set<string>;
  historicalActiveStateIds: Set<string>;
  imageRecognitions: Map<string, ImageRecognitionEvent>;
  historicalFoundImages: Map<string, ImageRecognitionEvent>;
}

export function ActiveStatesPanel({
  states,
  images,
  monitors,
  isLiveMode,
  onLiveModeChange,
  canvasMode,
  onCanvasModeChange,
  liveActiveStateIdsArray,
  activeStateIds,
  isConnected,
  connectionState,
  testRuns,
  selectedTestRunId,
  onTestRunChange,
  loadingTestRuns,
  loadingHistoricalData,
  historicalResults,
  liveActiveStateIds,
  historicalActiveStateIds,
  imageRecognitions,
  historicalFoundImages,
}: ActiveStatesPanelProps) {
  return (
    <Card className="lg:col-span-2 flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>Active States</span>
            {/* Live Mode Toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="live-mode"
                checked={isLiveMode}
                onCheckedChange={onLiveModeChange}
              />
              <Label
                htmlFor="live-mode"
                className="text-sm font-normal cursor-pointer"
              >
                {isLiveMode ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <Radio className="h-3 w-3 animate-pulse" />
                    Live
                  </span>
                ) : (
                  <span className="text-muted-foreground">Playback</span>
                )}
              </Label>
            </div>
            {/* Canvas Mode Toggle */}
            <div className="flex items-center gap-2 ml-4 pl-4 border-l">
              <Switch
                id="canvas-mode"
                checked={canvasMode === "config"}
                onCheckedChange={onCanvasModeChange}
              />
              <Label
                htmlFor="canvas-mode"
                className="text-sm font-normal cursor-pointer"
              >
                {canvasMode === "perception" ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Eye className="h-3 w-3" />
                    Perception
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-blue-600">
                    <Layers className="h-3 w-3" />
                    Config
                  </span>
                )}
              </Label>
            </div>
          </div>
          <Badge variant="outline">
            {isLiveMode
              ? `${liveActiveStateIdsArray.length} active`
              : `${activeStateIds.length} active`}
          </Badge>
        </CardTitle>
        <CardDescription>
          {canvasMode === "config" ? (
            <span className="text-blue-600 flex items-center gap-1">
              <Layers className="h-3 w-3" />
              Showing configured positions
            </span>
          ) : isLiveMode ? (
            isConnected ? (
              <span className="text-green-600">
                Connected - watching for execution events
              </span>
            ) : connectionState === "connecting" ||
              connectionState === "reconnecting" ? (
              <span className="text-yellow-600">Connecting to runner...</span>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1">
                <WifiOff className="h-3 w-3" />
                Disconnected - start runner to enable live perception
              </span>
            )
          ) : (
            <div className="flex items-center gap-3">
              <History className="h-3 w-3 text-purple-600" />
              <span className="text-purple-600">Historical Playback</span>
              {loadingTestRuns ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Select
                  value={selectedTestRunId || ""}
                  onValueChange={(value) => onTestRunChange(value || null)}
                >
                  <SelectTrigger className="h-7 w-[250px] text-xs">
                    <SelectValue placeholder="Select a test run..." />
                  </SelectTrigger>
                  <SelectContent>
                    {testRuns.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No test runs available
                      </div>
                    ) : (
                      testRuns.map((run) => (
                        <SelectItem key={run.id} value={run.id}>
                          <span className="flex items-center gap-2">
                            <Badge
                              variant={
                                run.status === "completed"
                                  ? "default"
                                  : run.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-[10px] px-1 py-0"
                            >
                              {run.status}
                            </Badge>
                            <span className="truncate">
                              {new Date(run.started_at).toLocaleDateString()}{" "}
                              {run.workflow_name || run.run_name}
                            </span>
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
              {loadingHistoricalData && (
                <Loader2 className="h-3 w-3 animate-spin text-purple-600" />
              )}
              {historicalResults.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {historicalResults.length} results
                </Badge>
              )}
            </div>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        <ActiveStatesCanvas
          states={states}
          images={images}
          monitors={monitors}
          mode={canvasMode}
          activeStateIds={
            isLiveMode
              ? liveActiveStateIds
              : canvasMode === "perception" && selectedTestRunId
                ? historicalActiveStateIds
                : activeStateIds
          }
          foundImages={
            isLiveMode
              ? imageRecognitions
              : canvasMode === "perception" && selectedTestRunId
                ? historicalFoundImages
                : undefined
          }
          connectionState={isLiveMode ? connectionState : undefined}
        />
      </CardContent>
    </Card>
  );
}
