import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Monitor, Cloud, Code, Terminal, Workflow } from "lucide-react";
import { ComponentBox, Arrow } from "./components";

export const OverviewTab: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="w-5 h-5" />
          Unified Runner Architecture
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          All heavy compute (Playwright, CV, ML) runs locally through the
          runner. The cloud backend handles only lightweight operations.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-full border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 bg-muted/20">
            <div className="flex items-center gap-2 mb-4">
              <Cloud className="w-4 h-4 text-muted-foreground" />
              <span
                className="text-sm font-medium text-muted-foreground"
                data-content-role="heading"
              >
                CLOUD (Lightweight)
              </span>
            </div>
            <div className="flex justify-center">
              <ComponentBox
                title="qontinui-web backend"
                subtitle="Port 8000"
                icon={<Server className="w-5 h-5" />}
                items={[
                  "Auth, Users, Projects",
                  "Storage (MinIO/S3)",
                  "Configuration sync",
                  "NO heavy compute",
                ]}
                variant="muted"
              />
            </div>
          </div>

          <Arrow direction="down" label="HTTP / WebSocket" />

          <div className="w-full border-2 border-primary/30 rounded-lg p-6 bg-primary/5">
            <div className="flex items-center gap-2 mb-4">
              <Monitor className="w-4 h-4 text-primary" />
              <span
                className="text-sm font-medium text-primary"
                data-content-role="heading"
              >
                LOCAL (User&apos;s Machine)
              </span>
            </div>

            <div className="flex flex-col items-center gap-4">
              <ComponentBox
                title="qontinui-runner"
                subtitle="Port 9876"
                icon={<Terminal className="w-5 h-5" />}
                items={[
                  "Single entry point for all local ops",
                  "Persistent Python process",
                  "IPC communication",
                  "Unified API to web",
                ]}
                variant="primary"
              />

              <Arrow direction="down" label="IPC (stdin/stdout)" />

              <ComponentBox
                title="qontinui library"
                subtitle="Python"
                icon={<Code className="w-5 h-5" />}
                items={[
                  "Web Extraction (Playwright)",
                  "Vision (OpenCV, Template Matching)",
                  "ML Models (SAM, CLIP, OCR)",
                  "HAL (Screen capture, Input)",
                  "State Machine (Traversal)",
                ]}
                variant="accent"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
