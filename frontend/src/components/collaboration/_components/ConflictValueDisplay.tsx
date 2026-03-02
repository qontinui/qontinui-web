"use client";

export function ConflictValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">empty</span>;
  }
  if (typeof value === "object") {
    return (
      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="font-mono text-sm">{String(value)}</span>;
}
