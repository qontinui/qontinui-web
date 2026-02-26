"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Plus, Wifi, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useChatWebSocket } from "@/hooks/useChatWebSocket";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./chat.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfig;

export default function ChatPage() {
  usePageSpecs({ chat: pageSpec });
  const router = useRouter();
  const { connections } = useRealtimeConnections();
  const [isCreating, setIsCreating] = useState(false);
  const createTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const activeConnection = connections[0] || null;
  const isRunnerConnected = !!activeConnection;

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (createTimeoutRef.current) {
        clearTimeout(createTimeoutRef.current);
      }
    };
  }, []);

  const { createSession, isConnected: isChatWsConnected } = useChatWebSocket({
    connectionId: activeConnection?.id ?? null,
    onSessionCreated: useCallback(
      (id: string) => {
        if (createTimeoutRef.current) {
          clearTimeout(createTimeoutRef.current);
          createTimeoutRef.current = null;
        }
        setIsCreating(false);
        router.push(`/chat/${id}`);
      },
      [router]
    ),
  });

  const handleNewChat = useCallback(() => {
    if (!isRunnerConnected) return;
    setIsCreating(true);

    const sent = createSession();
    if (!sent) {
      // WebSocket not connected — reset immediately
      setIsCreating(false);
      return;
    }

    // Safety timeout: reset isCreating if no response within 15 seconds
    createTimeoutRef.current = setTimeout(() => {
      setIsCreating(false);
      createTimeoutRef.current = null;
    }, 15000);
  }, [isRunnerConnected, createSession]);

  return (
    <div
      data-ui-id="chat-page"
      className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white"
    >
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <MessageSquare className="w-6 h-6 text-purple-400" />
            <div>
              <h1 className="text-2xl font-bold text-text-primary">Chat</h1>
              <p className="text-xs text-text-muted">
                Plan features with Claude, then generate executable workflows
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              data-ui-id="chat-runner-status"
              className="flex items-center gap-1.5 text-xs"
            >
              {isRunnerConnected ? (
                <>
                  <Wifi className="size-3.5 text-green-400" />
                  <span className="text-green-400">Runner connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="size-3.5 text-red-400" />
                  <span className="text-red-400">Runner offline</span>
                </>
              )}
            </span>

            <Button
              data-ui-id="chat-new-btn"
              size="sm"
              onClick={handleNewChat}
              disabled={!isRunnerConnected || !isChatWsConnected || isCreating}
              className="gap-1.5 bg-brand-primary hover:bg-brand-primary/90"
            >
              {isCreating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              New Chat
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-6 mx-auto" style={{ maxWidth: "900px" }}>
        {!isRunnerConnected ? (
          <div className="flex flex-col items-center justify-center py-24 text-text-muted">
            <WifiOff className="size-16 mb-4 opacity-20" />
            <h2 className="text-lg font-medium text-text-secondary mb-2">
              Runner Not Connected
            </h2>
            <p className="text-sm text-center max-w-md">
              Connect a runner to start chatting with Claude. Go to{" "}
              <a href="/runners" className="text-brand-primary hover:underline">
                Runners
              </a>{" "}
              to set up a connection.
            </p>
          </div>
        ) : (
          <div data-ui-id="chat-session-list" className="space-y-4">
            {/* Empty state */}
            <div className="flex flex-col items-center justify-center py-24 text-text-muted">
              <MessageSquare className="size-16 mb-4 opacity-20" />
              <h2 className="text-lg font-medium text-text-secondary mb-2">
                Start a Conversation
              </h2>
              <p className="text-sm text-center max-w-md mb-6">
                Chat with Claude to plan features, discuss architecture, or
                brainstorm ideas. When you&apos;re ready, generate an executable
                workflow from the conversation.
              </p>
              <Button
                onClick={handleNewChat}
                disabled={!isChatWsConnected || isCreating}
                className="gap-2 bg-brand-primary hover:bg-brand-primary/90"
              >
                {isCreating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Start New Chat
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
