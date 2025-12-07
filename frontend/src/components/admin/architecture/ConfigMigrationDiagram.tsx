"use client";

/**
 * Config Migration System Diagram Component
 *
 * Displays the comprehensive config migration architecture documentation
 * including BFS pathfinding, execution pipeline, and error handling flows
 */

import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { RefreshCw } from "lucide-react";

export function ConfigMigrationDiagram() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadContent = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          "/docs/architecture/config-migration-system.md"
        );
        if (!response.ok) {
          throw new Error(`Failed to load: ${response.statusText}`);
        }
        const text = await response.text();
        setContent(text);
      } catch (err) {
        console.error("Error loading config migration diagram:", err);
        setError(err instanceof Error ? err.message : "Failed to load diagram");
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, []);

  // Loading State
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Loading architecture diagram...
          </p>
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
        <p className="text-sm text-destructive font-medium">
          Failed to load diagram
        </p>
        <p className="text-xs text-destructive/80 mt-1">{error}</p>
      </div>
    );
  }

  // Content
  return (
    <ScrollArea className="h-[calc(100vh-20rem)]">
      <div className="pb-6">
        <MarkdownRenderer content={content} />
      </div>
    </ScrollArea>
  );
}
