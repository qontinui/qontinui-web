"use client";

import { lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageSquare,
  Wrench,
  Globe,
  Activity,
  Zap,
  Eye,
  Camera,
  FileCode,
  Settings,
  Loader2,
} from "lucide-react";

const AiSessionTab = lazy(() =>
  import("@/components/run-detail/AiSessionTab").then((m) => ({
    default: m.AiSessionTab,
  }))
);
const McpCallsTab = lazy(() =>
  import("@/components/run-detail/McpCallsTab").then((m) => ({
    default: m.McpCallsTab,
  }))
);
const ApiRequestsTab = lazy(() =>
  import("@/components/run-detail/ApiRequestsTab").then((m) => ({
    default: m.ApiRequestsTab,
  }))
);
const EventsTab = lazy(() =>
  import("@/components/run-detail/EventsTab").then((m) => ({
    default: m.EventsTab,
  }))
);
const ActionsTab = lazy(() =>
  import("@/components/run-detail/ActionsTab").then((m) => ({
    default: m.ActionsTab,
  }))
);
const ImageRecognitionTab = lazy(() =>
  import("@/components/run-detail/ImageRecognitionTab").then((m) => ({
    default: m.ImageRecognitionTab,
  }))
);
const ScreenshotsTab = lazy(() =>
  import("@/components/run-detail/ScreenshotsTab").then((m) => ({
    default: m.ScreenshotsTab,
  }))
);
const DomSnapshotsTab = lazy(() =>
  import("@/components/run-detail/DomSnapshotsTab").then((m) => ({
    default: m.DomSnapshotsTab,
  }))
);
const ConfigurationTab = lazy(() =>
  import("@/components/run-detail/ConfigurationTab").then((m) => ({
    default: m.ConfigurationTab,
  }))
);

function SubTabFallback() {
  return (
    <div className="text-center py-8 text-text-muted">
      <Loader2 className="size-4 animate-spin mx-auto mb-2" />
      Loading...
    </div>
  );
}

interface DataLogsTabProps {
  runId: string;
}

export function DataLogsTab({ runId }: DataLogsTabProps) {
  return (
    <Tabs defaultValue="ai-session">
      <TabsList className="flex-wrap gap-y-1">
        <span className="text-[10px] uppercase tracking-wider text-text-muted px-2 py-1 select-none">
          AI
        </span>
        <TabsTrigger value="ai-session" className="gap-1.5">
          <MessageSquare className="size-3.5" />
          AI Session
        </TabsTrigger>

        <span className="mx-1 h-4 w-px bg-border-subtle/50" />
        <span className="text-[10px] uppercase tracking-wider text-text-muted px-2 py-1 select-none">
          Execution
        </span>
        <TabsTrigger value="mcp-calls" className="gap-1.5">
          <Wrench className="size-3.5" />
          MCP Calls
        </TabsTrigger>
        <TabsTrigger value="api-requests" className="gap-1.5">
          <Globe className="size-3.5" />
          API Requests
        </TabsTrigger>
        <TabsTrigger value="events" className="gap-1.5">
          <Activity className="size-3.5" />
          Events
        </TabsTrigger>
        <TabsTrigger value="actions" className="gap-1.5">
          <Zap className="size-3.5" />
          Actions
        </TabsTrigger>
        <TabsTrigger value="image-recognition" className="gap-1.5">
          <Eye className="size-3.5" />
          Recognition
        </TabsTrigger>

        <span className="mx-1 h-4 w-px bg-border-subtle/50" />
        <span className="text-[10px] uppercase tracking-wider text-text-muted px-2 py-1 select-none">
          Captures
        </span>
        <TabsTrigger value="screenshots" className="gap-1.5">
          <Camera className="size-3.5" />
          Screenshots
        </TabsTrigger>
        <TabsTrigger value="dom-snapshots" className="gap-1.5">
          <FileCode className="size-3.5" />
          Snapshots
        </TabsTrigger>

        <span className="mx-1 h-4 w-px bg-border-subtle/50" />
        <span className="text-[10px] uppercase tracking-wider text-text-muted px-2 py-1 select-none">
          Config
        </span>
        <TabsTrigger value="configuration" className="gap-1.5">
          <Settings className="size-3.5" />
          Config
        </TabsTrigger>
      </TabsList>

      <TabsContent value="ai-session" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <AiSessionTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="mcp-calls" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <McpCallsTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="api-requests" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <ApiRequestsTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="events" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <EventsTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="actions" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <ActionsTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="image-recognition" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <ImageRecognitionTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="screenshots" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <ScreenshotsTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="dom-snapshots" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <DomSnapshotsTab runId={runId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="configuration" className="mt-4">
        <Suspense fallback={<SubTabFallback />}>
          <ConfigurationTab runId={runId} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
