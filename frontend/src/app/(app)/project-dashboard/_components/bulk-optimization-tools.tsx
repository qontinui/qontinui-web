"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Image as ImageIcon,
  Layers,
  Copy,
  Target,
  Link2,
  Archive,
  RefreshCw,
} from "lucide-react";

export function BulkOptimizationTools() {
  const [isProcessing, setIsProcessing] = useState(false);

  const tools = [
    {
      id: "unused-images",
      title: "Remove Unused Images",
      description: "Find and remove 156 images not used anywhere",
      icon: ImageIcon,
      color: "var(--error)",
      action: "Clean Up",
      count: 156,
    },
    {
      id: "orphaned-states",
      title: "Remove Orphaned States",
      description: "Delete 12 states not referenced by any workflow",
      icon: Layers,
      color: "var(--warning)",
      action: "Remove",
      count: 12,
    },
    {
      id: "duplicate-states",
      title: "Consolidate Duplicate States",
      description: "Merge 8 potentially duplicate states",
      icon: Copy,
      color: "var(--brand-primary)",
      action: "Consolidate",
      count: 8,
    },
    {
      id: "optimize-complexity",
      title: "Optimize Workflow Complexity",
      description: "Suggest optimizations for 7 complex workflows",
      icon: Target,
      color: "var(--brand-secondary)",
      action: "Optimize",
      count: 7,
    },
    {
      id: "fix-references",
      title: "Fix Broken References",
      description: "Repair 8 broken image references",
      icon: Link2,
      color: "var(--brand-success)",
      action: "Fix",
      count: 8,
    },
    {
      id: "compress-images",
      title: "Compress Large Images",
      description: "Reduce size of 34 large images (>1MB)",
      icon: Archive,
      color: "var(--text-muted)",
      action: "Compress",
      count: 34,
    },
  ];

  const handleToolAction = useCallback((_toolId: string) => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
    }, 2000);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <Card
            key={tool.id}
            className="bg-surface-raised/50 border-border-subtle/50 hover:border-border-default transition-all"
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${tool.color}20` }}
                >
                  <Icon className="w-5 h-5" style={{ color: tool.color }} />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold mb-1">{tool.title}</h4>
                  <p className="text-xs text-text-muted">{tool.description}</p>
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                style={{
                  backgroundColor: `${tool.color}20`,
                  color: tool.color,
                  borderColor: `${tool.color}40`,
                }}
                variant="outline"
                onClick={() => handleToolAction(tool.id)}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {tool.action} ({tool.count})
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
