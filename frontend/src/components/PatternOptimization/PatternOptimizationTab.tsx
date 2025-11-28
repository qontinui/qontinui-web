"use client";

import React, { useState, useEffect } from "react";
import {
  PatternOptimizationProvider,
  usePatternOptimization,
} from "@/contexts/pattern-optimization-context";
import { ScreenshotManager } from "./ScreenshotManager";
import { RegionSelector } from "./RegionSelector";
import { AnalysisPanel } from "./AnalysisPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Plus,
  RotateCcw,
  Settings,
  Info,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import type { OptimizationScreenshot } from "@/types/pattern-optimization";

function PatternOptimizationContent() {
  const { session, createSession, clearSession } = usePatternOptimization();
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<OptimizationScreenshot | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // Initialize session if needed
  useEffect(() => {
    if (!session) {
      createSession();
    }
  }, [session, createSession]);

  // Auto-select first screenshot with positive label
  useEffect(() => {
    if (session?.screenshots.length && !selectedScreenshot) {
      const firstPositive = session.screenshots.find(
        (s) => s.label === "positive"
      );
      setSelectedScreenshot(firstPositive || session.screenshots[0]);
    }
  }, [session?.screenshots, selectedScreenshot]);

  const handleNewSession = () => {
    if (session?.screenshots.length) {
      if (confirm("Start a new session? This will clear all current data.")) {
        clearSession();
        createSession();
        setSelectedScreenshot(null);
        toast.success("New session started");
      }
    } else {
      createSession();
      toast.success("Session created");
    }
  };

  return (
    <div className="h-full flex bg-[#0A0A0B]">
      {/* Left Panel - Screenshot Manager */}
      <div
        className={cn(
          "border-r border-gray-800 bg-[#27272A]/50 transition-all duration-300",
          leftPanelCollapsed ? "w-12" : "w-80"
        )}
      >
        {leftPanelCollapsed ? (
          <div className="h-full flex items-center justify-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLeftPanelCollapsed(false)}
              className="h-20 w-8 p-0"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <h2 className="text-sm font-medium">Pattern Optimization</h2>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleNewSession}
                  className="h-7 w-7 p-0"
                  title="New Session"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLeftPanelCollapsed(true)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <ScreenshotManager />
            </div>
          </div>
        )}
      </div>

      {/* Center Panel - Region Editor */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-sm font-medium">
            {selectedScreenshot
              ? `Region Editor - ${selectedScreenshot.name}`
              : "Region Editor"}
          </h3>
          <div className="flex items-center gap-2">
            <select
              className="h-7 px-2 text-xs bg-transparent border border-gray-700 rounded"
              value={selectedScreenshot?.id || ""}
              onChange={(e) => {
                const screenshot = session?.screenshots.find(
                  (s) => s.id === e.target.value
                );
                setSelectedScreenshot(screenshot || null);
              }}
            >
              <option value="">Select Screenshot</option>
              {session?.screenshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.label})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <RegionSelector screenshot={selectedScreenshot} />
        </div>
      </div>

      {/* Right Panel - Analysis */}
      <div
        className={cn(
          "border-l border-gray-800 bg-[#27272A]/50 transition-all duration-300",
          rightPanelCollapsed ? "w-12" : "w-96"
        )}
      >
        {rightPanelCollapsed ? (
          <div className="h-full flex items-center justify-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRightPanelCollapsed(false)}
              className="h-20 w-8 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <h3 className="text-sm font-medium">Analysis</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRightPanelCollapsed(true)}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <AnalysisPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PatternOptimizationTab() {
  return (
    <PatternOptimizationProvider>
      <PatternOptimizationContent />
    </PatternOptimizationProvider>
  );
}
