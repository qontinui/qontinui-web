/**
 * Architecture Diagrams
 *
 * Visual diagrams showing the unified runner architecture.
 * All compute goes through qontinui-runner instead of qontinui-api.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Server,
  Monitor,
  Cloud,
  Database,
  Code,
  Cpu,
  ArrowRight,
  ArrowDown,
  Eye,
  Terminal,
  Globe,
  HardDrive,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ArchitectureDiagramsProps {
  className?: string;
}

// Component box for architecture diagrams
const ComponentBox: React.FC<{
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  items?: string[];
  variant?: "primary" | "secondary" | "accent" | "muted";
  className?: string;
}> = ({
  title,
  subtitle,
  icon,
  items,
  variant = "secondary",
  className,
}) => {
  const variantStyles = {
    primary: "border-primary bg-primary/10",
    secondary: "border-border bg-card",
    accent: "border-blue-500 bg-blue-500/10",
    muted: "border-muted-foreground/30 bg-muted/50",
  };

  return (
    <div
      className={cn(
        "border-2 rounded-lg p-4 min-w-[200px]",
        variantStyles[variant],
        className
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="text-primary">{icon}</div>
        <div>
          <h4 className="font-semibold text-sm">{title}</h4>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {items && items.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1 ml-6">
          {items.map((item, index) => (
            <li key={index}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

// Arrow connector
const Arrow: React.FC<{
  direction?: "right" | "down" | "left" | "up";
  label?: string;
  className?: string;
}> = ({ direction = "right", label, className }) => {
  const ArrowIcon =
    direction === "down" || direction === "up" ? ArrowDown : ArrowRight;
  const rotate = direction === "up" ? "rotate-180" : direction === "left" ? "rotate-180" : "";

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1",
        direction === "down" || direction === "up" ? "flex-col" : "",
        className
      )}
    >
      <ArrowIcon className={cn("w-5 h-5 text-muted-foreground", rotate)} />
      {label && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
};

export const ArchitectureDiagrams: React.FC<ArchitectureDiagramsProps> = ({
  className,
}) => {
  return (
    <div className={cn("space-y-6", className)}>
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runner">Runner Detail</TabsTrigger>
          <TabsTrigger value="data-flow">Data Flow</TabsTrigger>
          <TabsTrigger value="ports">Ports & Services</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6">
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
                {/* Cloud Layer */}
                <div className="w-full border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 bg-muted/20">
                  <div className="flex items-center gap-2 mb-4">
                    <Cloud className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
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

                {/* Local Layer */}
                <div className="w-full border-2 border-primary/30 rounded-lg p-6 bg-primary/5">
                  <div className="flex items-center gap-2 mb-4">
                    <Monitor className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-primary">
                      LOCAL (User's Machine)
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-4">
                    {/* Runner */}
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

                    {/* Python Library */}
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
        </TabsContent>

        {/* Runner Detail Tab */}
        <TabsContent value="runner" className="mt-6">
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
                  {/* React Frontend */}
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

                  {/* Rust Backend */}
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

                  {/* External APIs */}
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
        </TabsContent>

        {/* Data Flow Tab */}
        <TabsContent value="data-flow" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRight className="w-5 h-5" />
                Data Flow Examples
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                How data flows through the system for common operations.
              </p>
            </CardHeader>
            <CardContent className="space-y-8">
              {/* Pattern Matching Flow */}
              <div>
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Pattern Matching Flow
                </h4>
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  <Badge variant="outline" className="px-4 py-2">
                    Frontend
                  </Badge>
                  <Arrow label="POST /pattern/find" />
                  <Badge variant="secondary" className="px-4 py-2">
                    Runner HTTP
                  </Badge>
                  <Arrow label="IPC: pattern_find" />
                  <Badge className="px-4 py-2">Python Bridge</Badge>
                  <Arrow label="cv2.matchTemplate" />
                  <Badge variant="outline" className="px-4 py-2 bg-green-500/10">
                    OpenCV
                  </Badge>
                </div>
              </div>

              {/* Screenshot Capture Flow */}
              <div>
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <Monitor className="w-4 h-4" />
                  Screenshot Capture Flow
                </h4>
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  <Badge variant="outline" className="px-4 py-2">
                    Frontend
                  </Badge>
                  <Arrow label="POST /capture-screenshot" />
                  <Badge variant="secondary" className="px-4 py-2">
                    Runner HTTP
                  </Badge>
                  <Arrow label="IPC: capture_screenshot" />
                  <Badge className="px-4 py-2">Python Bridge</Badge>
                  <Arrow label="HAL.capture()" />
                  <Badge variant="outline" className="px-4 py-2 bg-blue-500/10">
                    qontinui HAL
                  </Badge>
                </div>
              </div>

              {/* Web Extraction Flow */}
              <div>
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Web Extraction (Playwright) Flow
                </h4>
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  <Badge variant="outline" className="px-4 py-2">
                    Frontend
                  </Badge>
                  <Arrow label="POST /playwright-collection/start" />
                  <Badge variant="secondary" className="px-4 py-2">
                    Runner HTTP
                  </Badge>
                  <Arrow label="IPC: start_playwright_collection" />
                  <Badge className="px-4 py-2">Python Bridge</Badge>
                  <Arrow label="Playwright API" />
                  <Badge variant="outline" className="px-4 py-2 bg-purple-500/10">
                    Browser
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ports Tab */}
        <TabsContent value="ports" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                Ports & Services Reference
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                All services and their default ports in local development.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                {/* Application Services */}
                <div>
                  <h4 className="font-semibold mb-4">Application Services</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        <span className="font-mono text-sm">Frontend</span>
                      </div>
                      <Badge variant="outline">localhost:3001</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4" />
                        <span className="font-mono text-sm">Main Backend</span>
                      </div>
                      <Badge variant="outline">localhost:8000</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-primary/10 rounded border border-primary/30">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-primary" />
                        <span className="font-mono text-sm font-semibold">
                          Runner
                        </span>
                      </div>
                      <Badge>localhost:9876</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4" />
                        <span className="font-mono text-sm">Runner Vite</span>
                      </div>
                      <Badge variant="outline">localhost:1420</Badge>
                    </div>
                  </div>
                </div>

                {/* Infrastructure Services */}
                <div>
                  <h4 className="font-semibold mb-4">Infrastructure Services</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4" />
                        <span className="font-mono text-sm">PostgreSQL</span>
                      </div>
                      <Badge variant="outline">localhost:5432</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4" />
                        <span className="font-mono text-sm">Redis</span>
                      </div>
                      <Badge variant="outline">localhost:6379</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4" />
                        <span className="font-mono text-sm">MinIO API</span>
                      </div>
                      <Badge variant="outline">localhost:9000</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4" />
                        <span className="font-mono text-sm">MinIO Console</span>
                      </div>
                      <Badge variant="outline">localhost:9001</Badge>
                    </div>
                  </div>
                </div>
              </div>

              {/* Note about qontinui-api */}
              <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-sm text-yellow-600 dark:text-yellow-500">
                  <strong>Note:</strong> qontinui-api (port 8001) has been
                  deprecated. All computer vision and extraction functionality
                  now goes through the runner (port 9876).
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ArchitectureDiagrams;
