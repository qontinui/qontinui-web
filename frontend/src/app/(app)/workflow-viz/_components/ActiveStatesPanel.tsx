import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Layers, Radio, WifiOff, Eye } from "lucide-react";
import {
  EXECUTION_EVENTS_UNAVAILABLE_MESSAGE,
  type ConnectionState,
  type ImageRecognitionEvent,
} from "@/hooks/useExecutionEvents";
import type { State, ImageAsset } from "@/contexts/automation-context/types";
import type { RunnerMonitor } from "@/lib/schemas/geometry";
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
  liveActiveStateIds: Set<string>;
  imageRecognitions: Map<string, ImageRecognitionEvent>;
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
  liveActiveStateIds,
  imageRecognitions,
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
            ) : connectionState === "unavailable" ? (
              <span className="text-muted-foreground flex items-center gap-1">
                <WifiOff className="h-3 w-3" />
                {EXECUTION_EVENTS_UNAVAILABLE_MESSAGE}
              </span>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1">
                <WifiOff className="h-3 w-3" />
                Disconnected - start runner to enable live perception
              </span>
            )
          ) : (
            <span className="text-muted-foreground">
              Step through the workflow to see its active states
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        <ActiveStatesCanvas
          states={states}
          images={images}
          monitors={monitors}
          mode={canvasMode}
          activeStateIds={isLiveMode ? liveActiveStateIds : activeStateIds}
          foundImages={isLiveMode ? imageRecognitions : undefined}
          connectionState={isLiveMode ? connectionState : undefined}
        />
      </CardContent>
    </Card>
  );
}
