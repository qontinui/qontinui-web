"use client";

import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-surface-canvas/50 rounded border border-border-subtle/50 text-xs text-text-muted">
      Loading editor...
    </div>
  ),
});

interface MonacoFieldProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string | number;
  readOnly?: boolean;
  placeholder?: string;
}

export function MonacoField({
  value,
  onChange,
  language = "plaintext",
  height = "200px",
  readOnly = false,
}: MonacoFieldProps) {
  return (
    <div
      className="rounded border border-border-subtle/50 overflow-hidden"
      style={{ height }}
    >
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        onChange={(val) => onChange(val ?? "")}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          readOnly,
          padding: { top: 8 },
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
    </div>
  );
}
