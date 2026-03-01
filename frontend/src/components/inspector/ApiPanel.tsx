"use client";

import type { CommandHistoryEntry } from "@/hooks/use-inspector";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Terminal,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
} from "lucide-react";

interface ApiPanelProps {
  apiAction: string;
  onApiActionChange: (a: string) => void;
  apiParams: string;
  onApiParamsChange: (p: string) => void;
  isSending: boolean;
  onSend: () => void;
  commandHistory: CommandHistoryEntry[];
  onClearHistory: () => void;
  lastResult: {
    success: boolean;
    data?: unknown;
    error?: string;
    duration?: number;
  } | null;
}

export function ApiPanel({
  apiAction,
  onApiActionChange,
  apiParams,
  onApiParamsChange,
  isSending,
  onSend,
  commandHistory,
  onClearHistory,
  lastResult,
}: ApiPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Request */}
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            Send Command
          </CardTitle>
          <CardDescription className="text-text-muted">
            Send raw commands to the SDK API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label
              htmlFor="ap-action"
              className="text-xs text-text-muted uppercase tracking-wider mb-1 block"
            >
              Action
            </label>
            <Input
              id="ap-action"
              placeholder="e.g. listTabs, getElements, connect..."
              value={apiAction}
              onChange={(e) => onApiActionChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSend()}
              className="bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted font-mono"
            />
          </div>

          <div>
            <label
              htmlFor="ap-params"
              className="text-xs text-text-muted uppercase tracking-wider mb-1 block"
            >
              Params (JSON)
            </label>
            <textarea
              id="ap-params"
              value={apiParams}
              onChange={(e) => onApiParamsChange(e.target.value)}
              placeholder="{}"
              rows={4}
              className="w-full resize-none rounded-lg border border-border-subtle/50 bg-surface-raised/50 px-3 py-2 text-sm text-white placeholder:text-text-muted font-mono focus:border-purple-500/50 focus:outline-none"
            />
          </div>

          <Button
            onClick={onSend}
            disabled={isSending || !apiAction.trim()}
            className="w-full bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Command
              </>
            )}
          </Button>

          {lastResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {lastResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span
                  className={`text-sm ${lastResult.success ? "text-green-400" : "text-red-400"}`}
                >
                  {lastResult.success ? "Success" : "Error"}
                </span>
                {lastResult.duration && (
                  <span className="text-xs text-text-muted ml-auto">
                    {lastResult.duration}ms
                  </span>
                )}
              </div>
              <pre className="text-xs text-text-muted bg-surface-canvas/80 rounded p-3 overflow-x-auto max-h-[300px] overflow-y-auto">
                {JSON.stringify(lastResult.data || lastResult.error, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Command History
            </CardTitle>
            {commandHistory.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClearHistory}
                className="text-text-muted hover:text-white"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {commandHistory.length === 0 ? (
            <div className="text-center py-12">
              <Terminal className="w-10 h-10 mx-auto mb-3 text-text-muted" />
              <p className="text-sm text-text-muted">No commands sent yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {commandHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="p-2.5 rounded-lg border border-border-subtle/30 bg-surface-canvas/30"
                >
                  <div className="flex items-center gap-2">
                    {entry.result.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-sm font-mono text-text-primary">
                      {entry.action}
                    </span>
                    {entry.result.duration && (
                      <span className="text-xs text-text-muted ml-auto">
                        {entry.result.duration}ms
                      </span>
                    )}
                  </div>
                  {entry.params && (
                    <p className="text-xs text-text-muted font-mono mt-1 truncate">
                      {JSON.stringify(entry.params)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
