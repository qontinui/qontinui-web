import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Globe, Code, Cpu, Terminal } from "lucide-react";
import { ComponentBox, Arrow } from "./components";

export const RunnerDetailTab: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="w-5 h-5" />
          Runner Internal Architecture
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The runner is a Tauri desktop app with Rust backend and React
          frontend, communicating with Python via IPC.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="grid grid-cols-3 gap-8 items-start">
            <div className="flex flex-col items-center gap-4">
              <ComponentBox
                title="React Frontend"
                subtitle="UI Layer"
                icon={<Globe className="w-5 h-5" />}
                items={[
                  "Executor dashboard",
                  "Configuration UI",
                  "Log viewer",
                  "Status monitoring",
                ]}
                variant="secondary"
              />
              <Arrow direction="down" label="Tauri IPC" />
            </div>

            <div className="flex flex-col items-center gap-4">
              <ComponentBox
                title="Rust Backend"
                subtitle="Core Logic"
                icon={<Cpu className="w-5 h-5" />}
                items={[
                  "HTTP API (port 9876)",
                  "Process management",
                  "File system access",
                  "Window control",
                ]}
                variant="primary"
              />
              <Arrow direction="down" label="spawn + stdin/stdout" />
              <ComponentBox
                title="Python Bridge"
                subtitle="IPC Layer"
                icon={<Code className="w-5 h-5" />}
                items={[
                  "JSON protocol",
                  "Async command handling",
                  "Event streaming",
                  "Error propagation",
                ]}
                variant="accent"
              />
            </div>

            <div className="flex flex-col items-center gap-4">
              <ComponentBox
                title="HTTP API"
                subtitle="External Interface"
                icon={<Server className="w-5 h-5" />}
                items={[
                  "/status - Runner status",
                  "/monitors - Display info",
                  "/pattern/* - Pattern matching",
                  "/playwright/* - Web extraction",
                  "/capture-screenshot",
                ]}
                variant="muted"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
