"use client";

import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64 bg-background border border-border rounded-lg">
      <div className="text-muted-foreground">Loading editor...</div>
    </div>
  ),
});

interface CodeTabProps {
  code: string;
  onCodeChange: (value: string) => void;
}

export function CodeTab({ code, onCodeChange }: CodeTabProps) {
  return (
    <Card className="bg-muted/50 border-border">
      <CardHeader>
        <CardTitle>Package Code</CardTitle>
        <CardDescription>Write or paste your Python code here</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[500px] border border-border rounded-lg overflow-hidden">
          <Editor
            value={code}
            onChange={(value) => onCodeChange(value || "")}
            language="python"
            theme="vs-dark"
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
