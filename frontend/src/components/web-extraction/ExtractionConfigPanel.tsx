"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  ExternalLink,
} from "lucide-react";
import { useExtractionStore } from "@/stores/extraction-store";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useAutomation } from "@/contexts/automation-context";
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
import { toast } from "sonner";

interface ExtractionConfig {
  urls: string[];
  viewports: [number, number][];
  captureHoverStates: boolean;
  captureFocusStates: boolean;
  maxDepth: number;
  maxPages: number;
  authCookies?: Record<string, string>;
}

interface ExtractionConfigPanelProps {
  onStartExtraction: (
    runnerId: number,
    config: ExtractionConfig
  ) => Promise<void>;
  isConnecting: boolean;
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

export function ExtractionConfigPanel({
  onStartExtraction,
  isConnecting,
}: ExtractionConfigPanelProps) {
  const config = useExtractionStore((state) => state.config);
  const setConfig = useExtractionStore((state) => state.setConfig);
  const addUrl = useExtractionStore((state) => state.addUrl);
  const removeUrl = useExtractionStore((state) => state.removeUrl);
  const setViewports = useExtractionStore((state) => state.setViewports);

  const searchParams = useSearchParams();
  const { projectId: contextProjectId } = useAutomation();

  // State to hold the connect runner URL - computed after mount
  const [connectRunnerUrl, setConnectRunnerUrl] = useState("/connect-runner");

  // Compute the URL after component mounts (client-side only)
  useEffect(() => {
    // Read project ID from searchParams, context, or window.location
    let projectId = searchParams?.get("project") ?? null;

    if (!projectId && contextProjectId) {
      projectId = contextProjectId;
    }

    // Fallback to reading from window.location
    if (!projectId && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      projectId = url.searchParams.get("project");
    }

    if (projectId) {
      setConnectRunnerUrl(`/connect-runner?project=${projectId}`);
    } else {
      setConnectRunnerUrl("/connect-runner");
    }
  }, [searchParams, contextProjectId]);

  const [newUrl, setNewUrl] = useState("");
  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null);

  // Fetch active runner connections with real-time updates
  const { connections: activeConnections, isLoading: loadingConnections } =
    useRealtimeConnections();

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

    if (!selectedRunner.ws_connected) {
      toast.error(
        "Runner is not connected. Please ensure the Qontinui Runner application is running and connected."
      );
      return;
    }

    // Call parent's startExtraction with runner ID and config
    await onStartExtraction(selectedRunner.id, {
      urls: config.urls,
      viewports: config.viewports,
      captureHoverStates: config.captureHoverStates,
      captureFocusStates: config.captureFocusStates,
      maxDepth: config.maxDepth,
      maxPages: config.maxPages,
      authCookies: config.authCookies,
    });
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
                <div className="flex flex-col gap-2">
                  <span>
                    No runners connected. Please start the Qontinui Runner
                    application and connect it to this account.
                  </span>
                  <Link
                    href={connectRunnerUrl}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    Go to Connect Runner
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
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
                      <Server
                        className={`h-4 w-4 ${conn.ws_connected ? "text-green-500" : "text-yellow-500"}`}
                      />
                      <span>{conn.runner_name || `Runner ${conn.id}`}</span>
                      {!conn.ws_connected && (
                        <span className="text-xs text-yellow-600">
                          (not connected)
                        </span>
                      )}
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
        {(() => {
          const selectedRunner = activeConnections?.find(
            (conn) => conn.id.toString() === selectedRunnerId
          );
          const isWsConnected = selectedRunner?.ws_connected ?? false;
          const isDisabled =
            config.urls.length === 0 ||
            !selectedRunnerId ||
            isConnecting ||
            !isWsConnected;

          return (
            <Button
              size="lg"
              className="w-full"
              onClick={handleStartExtraction}
              disabled={isDisabled}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting to runner...
                </>
              ) : !isWsConnected && selectedRunnerId ? (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Runner Not Connected
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Start Extraction
                </>
              )}
            </Button>
          );
        })()}
      </div>
    </div>
  );
}
