"use client";

import React, { useState } from "react";
import { Copy, Check, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";

// Dynamically import Monaco editor to avoid SSR issues
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-surface-canvas border border-border-subtle rounded-lg">
      <div className="text-text-muted">Loading editor...</div>
    </div>
  ),
});

interface PackageCodePreviewProps {
  code: string;
  language?: string;
  fileName?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  className?: string;
}

export function PackageCodePreview({
  code,
  language = "python",
  fileName,
  showLineNumbers = true,
  maxHeight = "500px",
  className,
}: PackageCodePreviewProps) {
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[PackageCodePreview] Failed to copy code:", error);
    }
  };

  const handleEditorWillMount = (monaco: Monaco) => {
    // Configure Monaco themes
    monaco.editor.defineTheme("qontinui-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6A9955" },
        { token: "keyword", foreground: "569CD6" },
        { token: "string", foreground: "CE9178" },
        { token: "number", foreground: "B5CEA8" },
        { token: "function", foreground: "DCDCAA" },
        { token: "variable", foreground: "9CDCFE" },
      ],
      colors: {
        "editor.background": "#0A0A0B",
        "editor.foreground": "#D4D4D4",
        "editorLineNumber.foreground": "#858585",
        "editor.lineHighlightBackground": "#1A1A1B",
        "editor.selectionBackground": "#264F78",
        "editor.inactiveSelectionBackground": "#3A3D41",
      },
    });
  };

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden border border-border-subtle",
        isFullscreen && "fixed inset-4 z-50",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-canvas/80 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          {fileName && (
            <span className="text-sm text-text-secondary font-mono">
              {fileName}
            </span>
          )}
          <span className="text-xs text-text-muted uppercase">{language}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="h-8 w-8 p-0"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-8 px-3"
            title="Copy code"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-1 text-green-500" />
                <span className="text-xs text-green-500">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1" />
                <span className="text-xs">Copy</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div style={{ height: isFullscreen ? "calc(100vh - 120px)" : maxHeight }}>
        <Editor
          value={code}
          language={language}
          theme="qontinui-dark"
          beforeMount={handleEditorWillMount}
          options={{
            readOnly: true,
            minimap: { enabled: isFullscreen },
            scrollBeyondLastLine: false,
            lineNumbers: showLineNumbers ? "on" : "off",
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            renderLineHighlight: "line",
            automaticLayout: true,
            fontSize: 14,
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
            wordWrap: "on",
            wrappingStrategy: "advanced",
            padding: { top: 12, bottom: 12 },
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
          }}
        />
      </div>

      {/* Fullscreen overlay backdrop */}
      {isFullscreen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close fullscreen"
          className="fixed inset-0 bg-black/80 -z-10"
          onClick={() => setIsFullscreen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
              e.preventDefault();
              setIsFullscreen(false);
            }
          }}
        />
      )}
    </div>
  );
}
