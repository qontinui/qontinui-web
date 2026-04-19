"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Copy, Info } from "lucide-react";

/**
 * Top-of-page callout that shows the environment variables a server-mode
 * runner needs in order to register against this backend.
 */
export function RunnerSetupCallout() {
  const [copied, setCopied] = useState(false);

  const backendUrl = useMemo(() => {
    if (typeof window === "undefined") return "<backend-url>";
    return window.location.origin;
  }, []);

  const envBlock = `QONTINUI_SERVER_MODE=1
QONTINUI_WEB_BACKEND_URL=${backendUrl}
QONTINUI_RUNNER_TOKEN=<paste-token-here>`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(envBlock);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable; fail silently.
    }
  };

  return (
    <Card className="bg-surface-raised border-border-subtle p-5">
      <div className="flex items-start gap-3">
        <Info
          className="w-5 h-5 text-brand-primary shrink-0 mt-0.5"
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white mb-1">
            Runner setup instructions
          </h3>
          <p className="text-sm text-text-muted mb-3">
            To run a server-mode runner that registers with this backend, start
            the runner with these environment variables set. Use a token you
            create below for <code>QONTINUI_RUNNER_TOKEN</code>.
          </p>
          <div className="relative">
            <pre className="bg-surface-canvas border border-border-subtle rounded-md p-3 text-xs text-text-muted font-mono overflow-x-auto pr-20">
              {envBlock}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="absolute top-2 right-2 h-7 px-2 text-xs border-border-default"
              aria-label="Copy setup environment variables to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
