"use client";

/**
 * Architecture Documentation Viewer
 *
 * Comprehensive viewer for all architecture diagrams with navigation
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  Network,
  Lock,
  GitBranch,
  Database,
  ArrowLeftRight,
  Share2,
  Cloud,
  PlayCircle,
  RefreshCw,
  Image as ImageIcon,
  FileSearch,
} from "lucide-react";

export interface ArchitectureDiagram {
  id: string;
  title: string;
  description: string;
  category: "critical" | "high" | "supporting";
  icon: React.ReactNode;
  filePath: string;
}

const ARCHITECTURE_DIAGRAMS: ArchitectureDiagram[] = [
  {
    id: "collaboration",
    title: "Multi-User Collaboration",
    description:
      "Real-time sync, WebSockets, conflict resolution, and lock management",
    category: "critical",
    icon: <Network className="h-5 w-5" />,
    filePath: "/docs/architecture/collaboration-architecture.md",
  },
  {
    id: "auth",
    title: "Authentication & Authorization",
    description: "Registration, login, JWT tokens, and permission checking",
    category: "critical",
    icon: <Lock className="h-5 w-5" />,
    filePath: "/docs/architecture/auth-architecture.md",
  },
  {
    id: "workflow",
    title: "Workflow Execution Pipeline",
    description:
      "Graph evaluation, action execution, and state machine navigation",
    category: "critical",
    icon: <GitBranch className="h-5 w-5" />,
    filePath: "/docs/architecture/workflow-execution-architecture.md",
  },
  {
    id: "database",
    title: "Database Schema",
    description: "ER diagram with all models, relationships, and permissions",
    category: "high",
    icon: <Database className="h-5 w-5" />,
    filePath: "/docs/architecture/database-schema.md",
  },
  {
    id: "database-analysis",
    title: "Database Architecture Analysis",
    description:
      "Critical analysis: schema structure, indexing, security, scalability (Grade: B+)",
    category: "high",
    icon: <FileSearch className="h-5 w-5" />,
    filePath: "/docs/architecture/database-architecture-analysis.md",
  },
  {
    id: "dataflow",
    title: "Frontend-Backend Data Flow",
    description:
      "11-layer architecture with React Query, WebSocket streaming, and optimistic updates",
    category: "high",
    icon: <ArrowLeftRight className="h-5 w-5" />,
    filePath: "/docs/architecture/frontend-backend-dataflow.md",
  },
  {
    id: "dataflow-analysis",
    title: "Frontend-Backend Architecture Analysis",
    description:
      "Critical analysis: weaknesses, recommendations, performance (Grade: B+)",
    category: "high",
    icon: <FileSearch className="h-5 w-5" />,
    filePath: "/docs/architecture/frontend-backend-analysis.md",
  },
  {
    id: "permissions",
    title: "Project Sharing & Permissions",
    description:
      "Hierarchical RBAC, ACL resolution, invitation workflows, resource locking",
    category: "high",
    icon: <Share2 className="h-5 w-5" />,
    filePath: "/docs/architecture/permissions-architecture.md",
  },
  {
    id: "permissions-analysis",
    title: "Permissions Security Analysis",
    description:
      "Security audit: 3 critical vulnerabilities, 5 high-priority issues, recommendations (Grade: B-)",
    category: "high",
    icon: <FileSearch className="h-5 w-5" />,
    filePath: "/docs/architecture/permissions-sharing-analysis.md",
  },
  {
    id: "deployment",
    title: "Deployment Architecture",
    description: "Production (AWS) and development (Docker) environments",
    category: "supporting",
    icon: <Cloud className="h-5 w-5" />,
    filePath: "/docs/architecture/deployment-architecture.md",
  },
  {
    id: "automation-session",
    title: "Automation Session Lifecycle",
    description: "Session tracking, log capture, and video generation",
    category: "supporting",
    icon: <PlayCircle className="h-5 w-5" />,
    filePath: "/docs/architecture/automation-session-architecture.md",
  },
  {
    id: "config-migration",
    title: "Config Migration System",
    description: "Version detection and BFS pathfinding for migrations",
    category: "supporting",
    icon: <RefreshCw className="h-5 w-5" />,
    filePath: "/docs/architecture/config-migration-architecture.md",
  },
  {
    id: "image-processing",
    title: "Image Processing Pipeline",
    description: "Upload, storage, and computer vision pattern matching",
    category: "supporting",
    icon: <ImageIcon className="h-5 w-5" />,
    filePath: "/docs/architecture/image-processing-architecture.md",
  },
];

export function ArchitectureDocsViewer() {
  const [selectedDiagram, setSelectedDiagram] = useState<ArchitectureDiagram>(
    ARCHITECTURE_DIAGRAMS[0]!
  );
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadContent = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(selectedDiagram.filePath);
        if (!response.ok) {
          throw new Error(`Failed to load: ${response.statusText}`);
        }
        const text = await response.text();
        setContent(text);
      } catch (err) {
        console.error("Error loading architecture doc:", err);
        setError(err instanceof Error ? err.message : "Failed to load diagram");
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [selectedDiagram]);

  const categoryColor = {
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
    high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    supporting: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  };

  const categoryLabel = {
    critical: "Priority 1: Critical",
    high: "Priority 2: High Value",
    supporting: "Priority 3: Supporting",
  };

  // Group diagrams by category
  const groupedDiagrams = {
    critical: ARCHITECTURE_DIAGRAMS.filter((d) => d.category === "critical"),
    high: ARCHITECTURE_DIAGRAMS.filter((d) => d.category === "high"),
    supporting: ARCHITECTURE_DIAGRAMS.filter(
      (d) => d.category === "supporting"
    ),
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-12rem)]">
      {/* Sidebar Navigation */}
      <Card className="lg:col-span-1 p-4">
        <ScrollArea className="h-full">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Badge variant="outline" className={categoryColor.critical}>
                  {categoryLabel.critical}
                </Badge>
              </h3>
              <div className="space-y-1">
                {groupedDiagrams.critical.map((diagram) => (
                  <Button
                    key={diagram.id}
                    variant={
                      selectedDiagram.id === diagram.id ? "default" : "ghost"
                    }
                    className="w-full justify-start text-left h-auto py-2 px-3"
                    onClick={() => setSelectedDiagram(diagram)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">{diagram.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {diagram.title}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {diagram.description}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Badge variant="outline" className={categoryColor.high}>
                  {categoryLabel.high}
                </Badge>
              </h3>
              <div className="space-y-1">
                {groupedDiagrams.high.map((diagram) => (
                  <Button
                    key={diagram.id}
                    variant={
                      selectedDiagram.id === diagram.id ? "default" : "ghost"
                    }
                    className="w-full justify-start text-left h-auto py-2 px-3"
                    onClick={() => setSelectedDiagram(diagram)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">{diagram.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {diagram.title}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {diagram.description}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Badge variant="outline" className={categoryColor.supporting}>
                  {categoryLabel.supporting}
                </Badge>
              </h3>
              <div className="space-y-1">
                {groupedDiagrams.supporting.map((diagram) => (
                  <Button
                    key={diagram.id}
                    variant={
                      selectedDiagram.id === diagram.id ? "default" : "ghost"
                    }
                    className="w-full justify-start text-left h-auto py-2 px-3"
                    onClick={() => setSelectedDiagram(diagram)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">{diagram.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {diagram.title}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {diagram.description}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </Card>

      {/* Content Area */}
      <Card className="lg:col-span-3 p-6">
        <ScrollArea className="h-full">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                {selectedDiagram.icon}
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-1">
                  {selectedDiagram.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedDiagram.description}
                </p>
              </div>
              <Badge
                variant="outline"
                className={categoryColor[selectedDiagram.category]}
              >
                {categoryLabel[selectedDiagram.category]}
              </Badge>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center p-12">
              <div className="text-center">
                <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Loading architecture diagram...
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive font-medium">
                Failed to load diagram
              </p>
              <p className="text-xs text-destructive/80 mt-1">{error}</p>
            </div>
          )}

          {/* Content */}
          {!loading && !error && content && (
            <div className="pb-6">
              <MarkdownRenderer content={content} />
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
