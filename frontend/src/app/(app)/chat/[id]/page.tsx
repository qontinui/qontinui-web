"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useChatWebSocket } from "@/hooks/useChatWebSocket";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessageArea } from "@/components/chat/ChatMessageArea";
import { ChatInput } from "@/components/chat/ChatInput";
import { WorkflowPreviewPanel } from "@/components/chat/WorkflowPreviewPanel";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

export default function ChatSessionPage() {
  const params = useParams();
  const router = useRouter();
  const taskRunId = params.id as string;

  const { connections } = useRealtimeConnections();
  const activeConnection = connections[0] || null;
  const isRunnerConnected = !!activeConnection;

  const [sessionName, setSessionName] = useState("New Chat");
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(false);
  const [generatedWorkflow, setGeneratedWorkflow] =
    useState<UnifiedWorkflow | null>(null);
  const [workflowError, setWorkflowError] = useState<string | undefined>();
  const [lastIncludeUIBridge, setLastIncludeUIBridge] = useState(false);

  const handleSessionCreated = useCallback((_id: string, taskName: string) => {
    setSessionName(taskName);
  }, []);

  const handleWorkflowGenerated = useCallback(
    (data: {
      taskRunId: string;
      success: boolean;
      workflow?: unknown;
      error?: string;
    }) => {
      if (data.success && data.workflow) {
        setGeneratedWorkflow(data.workflow as UnifiedWorkflow);
        setWorkflowError(undefined);
        setShowWorkflowPanel(true);
        toast.success("Workflow generated successfully");
      } else {
        setWorkflowError(data.error || "Unknown error");
        setShowWorkflowPanel(true);
        toast.error("Workflow generation failed");
      }
    },
    []
  );

  const {
    isConnected,
    sessionState,
    messages,
    streamingContent,
    sendMessage,
    interruptSession,
    closeSession,
    generateWorkflow,
    renameSession,
    loadSession,
    isGeneratingWorkflow,
  } = useChatWebSocket({
    connectionId: activeConnection?.id ?? null,
    onSessionCreated: handleSessionCreated,
    onWorkflowGenerated: handleWorkflowGenerated,
  });

  // Load session on mount (for existing sessions)
  useEffect(() => {
    if (taskRunId && activeConnection) {
      loadSession(taskRunId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskRunId, activeConnection?.id]);

  const handleSendMessage = useCallback(
    (content: string) => {
      sendMessage(content);
      // Auto-name after first message
      if (messages.length === 0 && sessionName === "New Chat") {
        const trimmed = content.trim().replace(/\n/g, " ");
        const autoName =
          "Chat: " +
          (trimmed.length > 34 ? trimmed.slice(0, 33) + "…" : trimmed);
        setSessionName(autoName);
        renameSession(taskRunId, autoName);
      }
    },
    [sendMessage, messages.length, sessionName, renameSession, taskRunId]
  );

  const handleInterrupt = useCallback(() => {
    interruptSession(taskRunId);
  }, [interruptSession, taskRunId]);

  const handleClose = useCallback(() => {
    closeSession(taskRunId);
    router.push("/chat");
  }, [closeSession, taskRunId, router]);

  const handleRename = useCallback(
    (name: string) => {
      setSessionName(name);
      renameSession(taskRunId, name);
    },
    [renameSession, taskRunId]
  );

  const handleGenerateWorkflow = useCallback(
    (includeUIBridge: boolean) => {
      setLastIncludeUIBridge(includeUIBridge);
      generateWorkflow(taskRunId, { includeUIBridge });
    },
    [generateWorkflow, taskRunId]
  );

  const handleExecute = useCallback(() => {
    if (!generatedWorkflow) return;
    // Save workflow then navigate to execute page
    toast.info("Execute workflow - coming soon");
  }, [generatedWorkflow]);

  const handleEditInBuilder = useCallback(() => {
    if (!generatedWorkflow) return;
    try {
      sessionStorage.setItem(
        "qontinui:editWorkflow",
        JSON.stringify(generatedWorkflow)
      );
    } catch {
      // Storage full or unavailable — navigate anyway, builder will show empty
    }
    router.push("/build/workflows");
  }, [generatedWorkflow, router]);

  const handleRegenerate = useCallback(() => {
    setGeneratedWorkflow(null);
    setWorkflowError(undefined);
    generateWorkflow(taskRunId, { includeUIBridge: lastIncludeUIBridge });
  }, [generateWorkflow, taskRunId, lastIncludeUIBridge]);

  const handleSaveWorkflow = useCallback(async () => {
    if (!generatedWorkflow) return;
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876"}/unified-workflows`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(generatedWorkflow),
        }
      );
      if (response.ok) {
        toast.success("Workflow saved to library");
      } else {
        toast.error("Failed to save workflow");
      }
    } catch {
      toast.error("Failed to save workflow");
    }
  }, [generatedWorkflow]);

  const isStreaming = sessionState === "processing";

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <ChatHeader
        sessionName={sessionName}
        sessionState={sessionState}
        isRunnerConnected={isRunnerConnected}
        onRename={handleRename}
        onClose={handleClose}
      />

      <div className="flex-1 flex min-h-0">
        {/* Chat panel */}
        <div
          className={`flex flex-col ${showWorkflowPanel ? "w-1/2" : "w-full"} transition-all duration-300`}
        >
          <div className="flex-1 flex flex-col min-h-0 max-w-3xl mx-auto w-full px-4">
            <ChatMessageArea
              messages={messages}
              streamingContent={streamingContent}
              isStreaming={isStreaming}
            />
          </div>

          <div className="max-w-3xl mx-auto w-full">
            <ChatInput
              sessionState={sessionState}
              onSendMessage={handleSendMessage}
              onInterrupt={handleInterrupt}
              onGenerateWorkflow={handleGenerateWorkflow}
              isGeneratingWorkflow={isGeneratingWorkflow}
              messageCount={messages.length}
              disabled={!isConnected}
            />
          </div>
        </div>

        {/* Workflow preview panel */}
        {showWorkflowPanel && (
          <div className="w-1/2 min-w-[360px]">
            <WorkflowPreviewPanel
              workflow={generatedWorkflow}
              isLoading={isGeneratingWorkflow}
              error={workflowError}
              onExecute={handleExecute}
              onEditInBuilder={handleEditInBuilder}
              onRegenerate={handleRegenerate}
              onSave={handleSaveWorkflow}
              onClose={() => setShowWorkflowPanel(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
