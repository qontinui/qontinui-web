"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useExtractionStore } from "@/stores/extraction-store";
import { ExtractionConfigPanel } from "./ExtractionConfigPanel";
import { ExtractionProgress } from "./ExtractionProgress";
import { LivePreview } from "./LivePreview";
import { StateList } from "./StateList";
import { ExportPanel } from "./ExportPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  RunnerWebSocket,
  type ExtractionStartedEvent,
  type ExtractionProgressEvent,
  type ExtractionStateDetectedEvent,
  type ExtractionElementDetectedEvent,
  type ExtractionCompleteEvent,
  type ExtractionErrorEvent,
  type CommandResponseEvent,
} from "@/lib/runner-websocket";
import { toast } from "sonner";

export function WebExtractionPage() {
  const status = useExtractionStore((state) => state.status);
  const stats = useExtractionStore((state) => state.stats);
  const setStatus = useExtractionStore((state) => state.setStatus);
  const setError = useExtractionStore((state) => state.setError);
  const setSession = useExtractionStore((state) => state.setSession);
  const addState = useExtractionStore((state) => state.addState);
  const addElement = useExtractionStore((state) => state.addElement);
  const updateStats = useExtractionStore((state) => state.updateStats);

  const [activeTab, setActiveTab] = useState("config");
  const [isConnecting, setIsConnecting] = useState(false);

  // WebSocket ref lives here so it persists across tab switches
  const wsRef = useRef<RunnerWebSocket | null>(null);

  // Cleanup WebSocket on actual page unmount only
  // We track whether a connection is active to prevent cleanup from disconnecting it
  const isConnectingRef = useRef(false);

  useEffect(() => {
    return () => {
      // Only disconnect on actual unmount, not during Strict Mode double-invocation
      // Check if there's an active WebSocket that should be cleaned up
      if (wsRef.current && !isConnectingRef.current) {
        console.log(
          "[WebExtractionPage] Unmount cleanup - disconnecting WebSocket"
        );
        wsRef.current.disconnect();
      }
    };
  }, []);

  // Handle extraction events
  const handleExtractionStarted = useCallback(
    (data: ExtractionStartedEvent) => {
      // Create a full ExtractionSession from the WebSocket event data
      setSession({
        id: data.extraction_id,
        projectId: "", // Will be filled in if needed
        sourceUrls: data.config.urls,
        config: {
          urls: data.config.urls,
          viewports: data.config.viewports,
          captureHoverStates: true,
          captureFocusStates: true,
          maxDepth: 5,
          maxPages: 100,
          authCookies: {},
        },
        status: "running",
        stats: {
          pagesVisited: 0,
          statesFound: 0,
          elementsFound: 0,
          transitionsFound: 0,
        },
        errorMessage: null,
        createdAt: data.timestamp,
        startedAt: data.timestamp,
        completedAt: null,
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
      // Create a full ExtractedState from the WebSocket event data
      addState(
        {
          id: data.state.id,
          name: data.state.name,
          stateType: data.state.state_type as any, // WebSocket may send string not matching enum
          bbox: data.state.bbox,
          screenshotId: data.state.screenshot_id,
          elementIds: data.state.element_ids,
          detectionMethod: "visual",
          confidence: 1.0,
          semanticRole: null,
          ariaLabel: null,
          sourceUrl: "",
        },
        data.thumbnail
      );
    },
    [addState]
  );

  const handleExtractionElementDetected = useCallback(
    (data: ExtractionElementDetectedEvent) => {
      // Create a full ExtractedElement from the WebSocket event data
      addElement({
        id: data.element.id,
        elementType: data.element.element_type as any, // WebSocket may send string not matching enum
        bbox: data.element.bbox,
        textContent: data.element.text || null,
        placeholder: null,
        selector: "",
        isInteractive: true,
        isEnabled: true,
        isVisible: true,
        semanticRole: null,
        ariaLabel: null,
        name: data.element.tag_name || null,
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
      // Reset connecting ref before disconnect
      isConnectingRef.current = false;
      wsRef.current?.disconnect();
    },
    [setStatus, updateStats]
  );

  const handleExtractionError = useCallback(
    (data: ExtractionErrorEvent) => {
      setError(data.error);
      toast.error(`Extraction error: ${data.error}`);
      // Reset connecting ref before disconnect
      isConnectingRef.current = false;
      wsRef.current?.disconnect();
    },
    [setError]
  );

  // Handle command response from runner
  const handleCommandResponse = useCallback(
    (data: CommandResponseEvent) => {
      console.log("[WebExtraction] Command response received:", data);
      console.log(
        "[WebExtraction] Command:",
        data.command,
        "Result:",
        data.result
      );

      // Handle start_web_extraction command response
      if (
        data.command === "start_web_extraction" ||
        data.command === "unknown"
      ) {
        // Check for success - handle both explicit success and implicit (no error)
        const isSuccess =
          data.result?.success === true ||
          (data.result && !data.result.error && data.result.success !== false);

        if (isSuccess) {
          // Extraction started successfully
          const extractionId =
            data.result?.extraction_id || `extraction-${Date.now()}`;
          console.log(
            "[WebExtraction] Extraction started with ID:",
            extractionId
          );

          // Initialize session with the extraction ID
          setSession({
            id: extractionId,
            projectId: "",
            sourceUrls: [],
            config: {
              urls: [],
              viewports: [[1920, 1080]],
              captureHoverStates: true,
              captureFocusStates: true,
              maxDepth: 5,
              maxPages: 100,
              authCookies: {},
            },
            status: "running",
            stats: {
              pagesVisited: 0,
              statesFound: 0,
              elementsFound: 0,
              transitionsFound: 0,
            },
            errorMessage: null,
            createdAt: data.timestamp,
            startedAt: data.timestamp,
            completedAt: null,
          });
          setStatus("running");
          toast.success("Web extraction started on runner");
        } else if (data.result?.error || data.result?.success === false) {
          // Extraction failed to start
          const errorMessage =
            data.result?.error || "Failed to start extraction";
          console.error("[WebExtraction] Failed to start:", errorMessage);
          setError(errorMessage);
          toast.error(`Failed to start extraction: ${errorMessage}`);
          // Reset connecting ref before disconnect
          isConnectingRef.current = false;
          wsRef.current?.disconnect();
        }
      }
    },
    [setSession, setStatus, setError]
  );

  // Start extraction with a runner
  const startExtraction = useCallback(
    async (
      runnerId: number,
      config: {
        urls: string[];
        viewports: [number, number][];
        captureHoverStates: boolean;
        captureFocusStates: boolean;
        maxDepth: number;
        maxPages: number;
        authCookies?: Record<string, string>;
      }
    ) => {
      setIsConnecting(true);

      // Mark that we're connecting to prevent cleanup from disconnecting
      isConnectingRef.current = true;

      try {
        // Get authentication token for WebSocket connection
        let token: string | null = null;
        try {
          const tokenResponse = await fetch("/api/v1/ws-token", {
            credentials: "include",
          });
          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            token = tokenData.token || null;
          }
        } catch (tokenError) {
          console.error(
            "[WebExtraction] Failed to get WebSocket token:",
            tokenError
          );
        }

        if (!token) {
          toast.error("Authentication failed. Please log in again.");
          setIsConnecting(false);
          return;
        }

        // Connect to runner via WebSocket
        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
        const apiHost = apiUrl.replace(/^https?:\/\//, "");
        const wsUrl = `${wsProtocol}://${apiHost}/api/v1/automation/ws/runner/command/${runnerId}`;

        console.log("[WebExtraction] API URL:", apiUrl);
        console.log("[WebExtraction] Connecting to WebSocket:", wsUrl);
        console.log("[WebExtraction] Runner ID:", runnerId);

        wsRef.current = new RunnerWebSocket({
          url: wsUrl,
          token: token,
          onConnect: () => {
            console.log("[WebExtraction] onConnect START");
            console.log("[WebExtraction] setIsConnecting(false)");
            setIsConnecting(false);

            // Send extraction command
            console.log("[WebExtraction] Sending extraction command...");
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
            console.log("[WebExtraction] Command sent, switching tab...");

            // Switch to preview tab after command is sent
            // This is safe because wsRef lives in this component, not in ExtractionConfigPanel
            setActiveTab("preview");
            console.log("[WebExtraction] onConnect END");
          },
          onDisconnect: () => {
            console.log("[WebExtraction] WebSocket disconnected");
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
          onCommandResponse: handleCommandResponse,
        });

        wsRef.current.connect();
      } catch (error) {
        setIsConnecting(false);
        setError("Failed to start extraction");
        toast.error("Failed to start extraction");
      }
    },
    [
      handleExtractionStarted,
      handleExtractionProgress,
      handleExtractionStateDetected,
      handleExtractionElementDetected,
      handleExtractionComplete,
      handleExtractionError,
      handleCommandResponse,
      setError,
    ]
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Web Extraction</h1>
          <p className="text-muted-foreground">
            Extract GUI elements and states from web applications
          </p>
        </div>
        {status === "running" && (
          <ExtractionProgress
            pagesVisited={stats.pagesVisited}
            statesFound={stats.statesFound}
            elementsFound={stats.elementsFound}
          />
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="preview" disabled={status === "idle"}>
            Live Preview
          </TabsTrigger>
          <TabsTrigger value="states" disabled={stats.statesFound === 0}>
            States ({stats.statesFound})
          </TabsTrigger>
          <TabsTrigger value="export" disabled={status !== "complete"}>
            Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-6">
          <ExtractionConfigPanel
            onStartExtraction={startExtraction}
            isConnecting={isConnecting}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Live Preview</CardTitle>
                  <CardDescription>
                    View detected elements and states in real-time
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LivePreview />
                </CardContent>
              </Card>
            </div>
            <div>
              <StateList />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="states" className="mt-6">
          <StateList expanded />
        </TabsContent>

        <TabsContent value="export" className="mt-6">
          <ExportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
