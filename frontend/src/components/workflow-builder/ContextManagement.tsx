"use client";

import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { useContextManagement } from "./_hooks/useContextManagement";
import { useContextPicker } from "./_hooks/useContextPicker";
import { AutoIncludeToggle } from "./_components/AutoIncludeToggle";
import { IncludedContextList } from "./_components/IncludedContextList";
import { DisabledAutoContextList } from "./_components/DisabledAutoContextList";
import { ContextPicker } from "./_components/ContextPicker";

export function ContextManagement() {
  const [isOpen, setIsOpen] = useState(false);

  const {
    contexts,
    isLoading,
    error,
    isOffline,
    refetch,
    autoIncludeEnabled,
    includedContexts,
    disabledAutoContexts,
    addContext,
    toggleContextDisabled,
    handleToggle,
    setAutoInclude,
  } = useContextManagement();

  const {
    showPicker,
    searchQuery,
    setSearchQuery,
    pickerRef,
    availableForPicker,
    groupedAvailable,
    closePicker,
    togglePicker,
  } = useContextPicker(contexts, includedContexts);

  const handleAddContext = (contextId: string) => {
    addContext(contextId);
    closePicker();
  };

  const totalCount = includedContexts.length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
            <BookOpen className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-300">
              AI Contexts
            </span>
            {totalCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-auto text-[10px] px-1.5 py-0"
              >
                {totalCount}
              </Badge>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {isLoading && (
              <div className="flex items-center gap-2 text-zinc-400 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading contexts...
              </div>
            )}

            {(error || isOffline) && (
              <div className="flex items-center gap-2 text-sm py-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="flex-1 text-red-400">
                  {isOffline
                    ? "Runner not connected"
                    : (error ?? "Failed to load contexts")}
                </span>
                <button
                  className="text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => refetch()}
                >
                  Retry
                </button>
              </div>
            )}

            {!isLoading && (
              <AutoIncludeToggle
                enabled={autoIncludeEnabled}
                onChange={setAutoInclude}
              />
            )}

            {!isLoading && !error && includedContexts.length === 0 && (
              <p className="text-sm text-zinc-500 italic py-1">
                No contexts selected. Add contexts manually
                {autoIncludeEnabled
                  ? " or set a description to trigger auto-include."
                  : "."}
              </p>
            )}

            {!isLoading && (
              <IncludedContextList
                items={includedContexts}
                onToggle={handleToggle}
              />
            )}

            {!isLoading && (
              <DisabledAutoContextList
                items={disabledAutoContexts}
                onReEnable={toggleContextDisabled}
              />
            )}

            {!isLoading && !error && (
              <ContextPicker
                showPicker={showPicker}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                groupedAvailable={groupedAvailable}
                availableCount={availableForPicker.length}
                contexts={contexts}
                pickerRef={pickerRef}
                onTogglePicker={togglePicker}
                onAddContext={handleAddContext}
                onClose={closePicker}
              />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
