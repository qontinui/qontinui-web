"use client";

import React, { useState } from "react";
import { Terminal, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  generateStepId,
  type CommandStep,
  type WorkflowPhase,
} from "@/types/unified-workflow";

// =============================================================================
// Curl Parser
// =============================================================================

interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  contentType?: string;
}

function parseCurl(input: string): ParsedCurl | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("curl")) return null;

  // Remove line continuations
  const cmd = trimmed.replace(/\\\s*\n/g, " ").replace(/\s+/g, " ");

  let method = "GET";
  let url = "";
  const headers: Record<string, string> = {};
  let body: string | undefined;

  // Tokenize respecting quotes
  const tokens: string[] = [];
  let current = "";
  let inQuote = "";
  for (const ch of cmd) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = "";
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " ") {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "curl") continue;

    if (token === "-X" || token === "--request") {
      method = tokens[++i]?.toUpperCase() ?? "GET";
    } else if (token === "-H" || token === "--header") {
      const header = tokens[++i] ?? "";
      const colonIdx = header.indexOf(":");
      if (colonIdx > 0) {
        const key = header.slice(0, colonIdx).trim();
        const val = header.slice(colonIdx + 1).trim();
        headers[key] = val;
      }
    } else if (
      token === "-d" ||
      token === "--data" ||
      token === "--data-raw" ||
      token === "--data-binary"
    ) {
      body = tokens[++i] ?? "";
      if (method === "GET") method = "POST";
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      url = token;
    } else if (!token.startsWith("-") && !url) {
      // Might be URL without flags
      if (token.includes("://") || token.includes(".")) {
        url = token;
      }
    }
  }

  if (!url) return null;

  const contentType = headers["Content-Type"] ?? headers["content-type"];

  return { method, url, headers, body, contentType };
}

// =============================================================================
// Component
// =============================================================================

interface CurlImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (step: CommandStep, phase: WorkflowPhase) => void;
}

export function CurlImportDialog({
  isOpen,
  onClose,
  onImport,
}: CurlImportDialogProps) {
  const [curlInput, setCurlInput] = useState("");
  const [parsed, setParsed] = useState<ParsedCurl | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [targetPhase, setTargetPhase] = useState<WorkflowPhase>("setup");

  const handleParse = () => {
    setParseError(null);
    const result = parseCurl(curlInput);
    if (result) {
      setParsed(result);
    } else {
      setParseError(
        "Could not parse curl command. Make sure it starts with 'curl' and includes a URL."
      );
      setParsed(null);
    }
  };

  const handleImport = () => {
    if (!parsed) return;

    // Build a shell command step with the curl command
    const step: CommandStep = {
      id: generateStepId(),
      type: "command",
      phase: targetPhase as "setup" | "verification" | "completion",
      name: `API: ${parsed.method} ${(() => {
        try {
          return new URL(parsed.url).pathname;
        } catch {
          return parsed.url;
        }
      })()}`,
      command: curlInput.trim(),
    };

    onImport(step, targetPhase);
    setCurlInput("");
    setParsed(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] flex flex-col gap-0 p-0">
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b border-zinc-800">
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            Import from curl
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label
              htmlFor="cid-curl-input"
              className="block text-xs font-medium text-zinc-400 mb-1.5"
            >
              Paste curl command
            </label>
            <Textarea
              id="cid-curl-input"
              value={curlInput}
              onChange={(e) => {
                setCurlInput(e.target.value);
                setParsed(null);
                setParseError(null);
              }}
              placeholder={
                "curl -X POST https://api.example.com/data \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"key\": \"value\"}'"
              }
              className="min-h-[120px] font-mono text-sm bg-zinc-800 border-zinc-700 text-zinc-200"
            />
          </div>

          <Button
            size="sm"
            onClick={handleParse}
            disabled={!curlInput.trim()}
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            Parse
          </Button>

          {parseError && <p className="text-xs text-red-400">{parseError}</p>}

          {parsed && (
            <div className="space-y-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <div className="flex items-center gap-2">
                <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
                  {parsed.method}
                </Badge>
                <span className="text-sm text-zinc-300 font-mono truncate">
                  {parsed.url}
                </span>
              </div>

              {Object.keys(parsed.headers).length > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-zinc-500 uppercase">
                    Headers
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {Object.entries(parsed.headers).map(([k, v]) => (
                      <div key={k} className="text-xs font-mono">
                        <span className="text-zinc-400">{k}:</span>{" "}
                        <span className="text-zinc-300">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {parsed.body && (
                <div>
                  <span className="text-[10px] font-medium text-zinc-500 uppercase">
                    Body
                  </span>
                  <pre className="mt-1 text-xs font-mono text-zinc-300 bg-zinc-900 rounded p-2 max-h-24 overflow-auto">
                    {parsed.body}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label htmlFor="cid-phase" className="text-xs text-zinc-400">
              Add to phase:
            </label>
            <select
              id="cid-phase"
              value={targetPhase}
              onChange={(e) => setTargetPhase(e.target.value as WorkflowPhase)}
              className="h-7 px-2 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300"
            >
              <option value="setup">Setup</option>
              <option value="verification">Verification</option>
              <option value="completion">Completion</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!parsed}
              onClick={handleImport}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Import as Step
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
