"use client";

import React from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ContextItem } from "@/lib/runner-api";

interface ContextSectionProps {
  showContext: boolean;
  setShowContext: (value: boolean) => void;
  selectedContextIds: string[];
  savedContexts: ContextItem[] | null | undefined;
  contextsByScope: Record<string, ContextItem[]>;
  handleContextToggle: (contextId: string) => void;
  inlineContext: string;
  setInlineContext: (value: string) => void;
  filePath: string;
  setFilePath: (value: string) => void;
  isImportingFile: boolean;
  handleImportFile: () => Promise<void>;
}

export function ContextSection({
  showContext,
  setShowContext,
  selectedContextIds,
  savedContexts,
  contextsByScope,
  handleContextToggle,
  inlineContext,
  setInlineContext,
  filePath,
  setFilePath,
  isImportingFile,
  handleImportFile,
}: ContextSectionProps) {
  return (
    <Collapsible open={showContext} onOpenChange={setShowContext}>
      <CollapsibleTrigger className="flex min-h-6 items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
        {showContext ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <FileText className="w-4 h-4" />
        Attach Context
        {selectedContextIds.length > 0 && (
          <Badge variant="secondary" className="text-xs ml-1">
            {selectedContextIds.length}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <Tabs defaultValue="saved" className="w-full">
          <TabsList className="bg-zinc-800 border border-zinc-700">
            <TabsTrigger value="saved" className="text-xs">
              Saved Contexts
            </TabsTrigger>
            <TabsTrigger value="custom" className="text-xs">
              Custom Text
            </TabsTrigger>
            <TabsTrigger value="file" className="text-xs">
              Import File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="saved" className="mt-2">
            {!savedContexts || savedContexts.length === 0 ? (
              <p className="text-xs text-zinc-500 py-2">
                No saved contexts. Create one in the Contexts tab or import a
                file.
              </p>
            ) : (
              <div className="max-h-[240px] overflow-y-auto space-y-1 pr-1">
                {Object.entries(contextsByScope).map(([scope, contexts]) => (
                  <div key={scope}>
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
                      {scope}
                    </p>
                    {contexts.map((ctx) => (
                      <div
                        role="button"
                        tabIndex={0}
                        key={ctx.id}
                        className="flex items-start gap-2 p-1.5 rounded hover:bg-zinc-800/50 cursor-pointer"
                        onClick={() => handleContextToggle(ctx.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            (e.currentTarget as HTMLElement).click();
                          }
                        }}
                      >
                        <Checkbox
                          checked={selectedContextIds.includes(ctx.id)}
                          onCheckedChange={() => handleContextToggle(ctx.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <span className="text-sm text-zinc-300 block truncate">
                            {ctx.name}
                          </span>
                          {ctx.category && (
                            <Badge
                              variant="outline"
                              className="text-[10px] mt-0.5"
                            >
                              {ctx.category}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="custom" className="mt-2">
            <Textarea
              className="min-h-[100px] bg-zinc-800 border-zinc-700 text-zinc-200 text-xs font-mono"
              placeholder="Paste additional context here (e.g., CLAUDE.md content, project notes, API docs)..."
              value={inlineContext}
              onChange={(e) => setInlineContext(e.target.value)}
            />
          </TabsContent>

          <TabsContent value="file" className="mt-2 space-y-2">
            <p className="text-xs text-zinc-500">
              Import a file (e.g., CLAUDE.md, GEMINI.md) as a saved context for
              reuse.
            </p>
            <div className="flex gap-2">
              <Input
                className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm flex-1"
                placeholder="C:\path\to\CLAUDE.md"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                disabled={isImportingFile}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportFile}
                disabled={!filePath.trim() || isImportingFile}
              >
                {isImportingFile ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderOpen className="w-4 h-4" />
                )}
                Import
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
