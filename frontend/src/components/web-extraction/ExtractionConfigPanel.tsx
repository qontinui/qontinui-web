"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  Trash2,
  Play,
  Monitor,
  Tablet,
  Smartphone,
  Server,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useExtractionStore } from "@/stores/extraction-store";
import { useActiveConnections } from "@/hooks/useRunners";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  RunnerWebSocket,
  type ExtractionStartedEvent,
  type ExtractionProgressEvent,
  type ExtractionStateDetectedEvent,
  type ExtractionElementDetectedEvent,
  type ExtractionCompleteEvent,
  type ExtractionErrorEvent,
} from "@/lib/runner-websocket";
import { toast } from "sonner";

interface ExtractionConfigPanelProps {
  onStart?: () => void;
}

const VIEWPORT_PRESETS: {
  name: string;
  icon: React.ReactNode;
  size: [number, number];
}[] = [
  {
    name: "Desktop",
    icon: <Monitor className="h-4 w-4" />,
    size: [1920, 1080],
  },
  { name: "Tablet", icon: <Tablet className="h-4 w-4" />, size: [768, 1024] },
  {
    name: "Mobile",
    icon: <Smartphone className="h-4 w-4" />,
    size: [375, 667],
  },
];

export function ExtractionConfigPanel({ onStart }: ExtractionConfigPanelProps) {
  const config = useExtractionStore((state) => state.config);
  const setConfig = useExtractionStore((state) => state.setConfig);
  const addUrl = useExtractionStore((state) => state.addUrl);
  const removeUrl = useExtractionStore((state) => state.removeUrl);
  const setViewports = useExtractionStore((state) => state.setViewports);
  const setStatus = useExtractionStore((state) => state.setStatus);
  const setError = useExtractionStore((state) => state.setError);
  const setSession = useExtractionStore((state) => state.setSession);
  const addState = useExtractionStore((state) => state.addState);
  const addElement = useExtractionStore((state) => state.addElement);
  const updateStats = useExtractionStore((state) => state.updateStats);

  const [newUrl, setNewUrl] = useState("");
  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const wsRef = useRef<RunnerWebSocket | null>(null);

  // Fetch active runner connections
  const { data: activeConnections, isLoading: loadingConnections } =
    useActiveConnections();

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.disconnect();
    };
  }, []);

  // Handle extraction events
  const handleExtractionStarted = useCallback(
    (data: ExtractionStartedEvent) => {
      setSession({
        extractionId: data.extraction_id,
        startedAt: data.timestamp,
        config: data.config,
      });
      setStatus("running");
      toast.success("Extraction started");
    },
    [setSession, setStatus]
  );

  const handleExtractionProgress = useCallback(
    (data: ExtractionProgressEvent) => {
      updateStats({
        pagesVisited: data.pages_visited,
        statesFound: data.states_found,
        elementsFound: data.elements_found,
      });
    },
    [updateStats]
  );

  const handleExtractionStateDetected = useCallback(
    (data: ExtractionStateDetectedEvent) => {
      addState(
        {
          id: data.state.id,
          name: data.state.name,
          stateType: data.state.state_type,
          bbox: data.state.bbox,
          screenshotId: data.state.screenshot_id,
          elementIds: data.state.element_ids,
        },
        data.thumbnail
      );
    },
    [addState]
  );

  const handleExtractionElementDetected = useCallback(
    (data: ExtractionElementDetectedEvent) => {
      addElement({
        id: data.element.id,
        elementType: data.element.element_type as any,
        bbox: data.element.bbox,
        text: data.element.text,
        tagName: data.element.tag_name,
      });
    },
    [addElement]
  );

  const handleExtractionComplete = useCallback(
    (data: ExtractionCompleteEvent) => {
      setStatus("complete");
      updateStats({
        pagesVisited: data.summary.total_pages,
        statesFound: data.summary.total_states,
        elementsFound: data.summary.total_elements,
        transitionsFound: data.summary.total_transitions,
      });
      toast.success("Extraction complete!");
      wsRef.current?.disconnect();
    },
    [setStatus, updateStats]
  );

  const handleExtractionError = useCallback(
    (data: ExtractionErrorEvent) => {
      setError(data.error);
      toast.error(`Extraction error: ${data.error}`);
      wsRef.current?.disconnect();
    },
    [setError]
  );

  const handleAddUrl = () => {
    if (newUrl && newUrl.startsWith("http")) {
      addUrl(newUrl);
      setNewUrl("");
    }
  };

  const handleToggleViewport = (size: [number, number]) => {
    const exists = config.viewports.some(
      (v) => v[0] === size[0] && v[1] === size[1]
    );
    if (exists) {
      setViewports(
        config.viewports.filter((v) => v[0] !== size[0] || v[1] !== size[1])
      );
    } else {
      setViewports([...config.viewports, size]);
    }
  };

  const handleStartExtraction = async () => {
    if (config.urls.length === 0) {
      toast.error("Please add at least one URL");
      return;
    }

    if (!selectedRunnerId) {
      toast.error("Please select a runner");
      return;
    }

    const selectedRunner = activeConnections?.find(
      (conn) => conn.id.toString() === selectedRunnerId
    );

    if (!selectedRunner) {
      toast.error("Selected runner not found");
      return;
    }

    setIsConnecting(true);

    try {
      // Connect to runner via WebSocket
      const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/v1/ws/runner/${selectedRunner.id}`;

      wsRef.current = new RunnerWebSocket({
        url: wsUrl,
        onConnect: () => {
          setIsConnecting(false);
          // Send extraction command
          wsRef.current?.send({
            type: "command",
            command: "start_web_extraction",
            params: {
              config: {
                urls: config.urls,
                viewports: config.viewports,
                capture_hover_states: config.captureHoverStates,
                capture_focus_states: config.captureFocusStates,
                capture_scroll_states: true,
                max_depth: config.maxDepth,
                max_pages: config.maxPages,
                auth_cookies: config.authCookies || {},
              },
            },
          });
          onStart?.();
        },
        onDisconnect: () => {
          setIsConnecting(false);
        },
        onError: () => {
          setIsConnecting(false);
          setError("Failed to connect to runner");
          toast.error("Failed to connect to runner");
        },
        onExtractionStarted: handleExtractionStarted,
        onExtractionProgress: handleExtractionProgress,
        onExtractionStateDetected: handleExtractionStateDetected,
        onExtractionElementDetected: handleExtractionElementDetected,
        onExtractionComplete: handleExtractionComplete,
        onExtractionError: handleExtractionError,
      });

      wsRef.current.connect();
    } catch (error) {
      setIsConnecting(false);
      setError("Failed to start extraction");
      toast.error("Failed to start extraction");
    }
  };

  const isViewportSelected = (size: [number, number]) =>
    config.viewports.some((v) => v[0] === size[0] && v[1] === size[1]);

  const hasActiveRunners = activeConnections && activeConnections.length > 0;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* URLs */}
      <Card>
        <CardHeader>
          <CardTitle>URLs to Extract</CardTitle>
          <CardDescription>
            Add the web pages you want to analyze
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="https://example.com"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
            />
            <Button onClick={handleAddUrl} size="icon">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {config.urls.map((url, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-muted rounded-md"
              >
                <span className="text-sm truncate flex-1">{url}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeUrl(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {config.urls.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No URLs added yet
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Viewports */}
      <Card>
        <CardHeader>
          <CardTitle>Viewports</CardTitle>
          <CardDescription>Select device sizes to capture</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {VIEWPORT_PRESETS.map((preset) => (
              <Badge
                key={preset.name}
                variant={
                  isViewportSelected(preset.size) ? "default" : "outline"
                }
                className="cursor-pointer py-2 px-3"
                onClick={() => handleToggleViewport(preset.size)}
              >
                {preset.icon}
                <span className="ml-2">{preset.name}</span>
                <span className="ml-1 text-xs opacity-70">
                  ({preset.size[0]}x{preset.size[1]})
                </span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Capture Options */}
      <Card>
        <CardHeader>
          <CardTitle>Capture Options</CardTitle>
          <CardDescription>Configure what to capture</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="hover-states">Capture hover states</Label>
            <Switch
              id="hover-states"
              checked={config.captureHoverStates}
              onCheckedChange={(checked) =>
                setConfig({ captureHoverStates: checked })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="focus-states">Capture focus states</Label>
            <Switch
              id="focus-states"
              checked={config.captureFocusStates}
              onCheckedChange={(checked) =>
                setConfig({ captureFocusStates: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
          <CardDescription>Control extraction scope</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="max-depth">Max depth</Label>
            <Input
              id="max-depth"
              type="number"
              min={1}
              max={20}
              value={config.maxDepth}
              onChange={(e) =>
                setConfig({ maxDepth: parseInt(e.target.value) || 5 })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-pages">Max pages</Label>
            <Input
              id="max-pages"
              type="number"
              min={1}
              max={1000}
              value={config.maxPages}
              onChange={(e) =>
                setConfig({ maxPages: parseInt(e.target.value) || 100 })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Runner Selection */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Runner
          </CardTitle>
          <CardDescription>
            Select a connected runner to perform the extraction
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingConnections ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading runners...
            </div>
          ) : !hasActiveRunners ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No runners connected. Please start the Qontinui Runner
                application and connect it to this account.
              </AlertDescription>
            </Alert>
          ) : (
            <Select
              value={selectedRunnerId || undefined}
              onValueChange={setSelectedRunnerId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a runner" />
              </SelectTrigger>
              <SelectContent>
                {activeConnections?.map((conn) => (
                  <SelectItem key={conn.id} value={conn.id.toString()}>
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-green-500" />
                      <span>{conn.runner_hostname || `Runner ${conn.id}`}</span>
                      <span className="text-xs text-muted-foreground">
                        ({conn.runner_os || "Unknown OS"})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Start Button */}
      <div className="md:col-span-2">
        <Button
          size="lg"
          className="w-full"
          onClick={handleStartExtraction}
          disabled={
            config.urls.length === 0 || !selectedRunnerId || isConnecting
          }
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Connecting to runner...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Start Extraction
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
