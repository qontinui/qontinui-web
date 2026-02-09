"use client";

import React, { useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { UnifiedStep, WorkflowPhase } from "@/types/unified-workflow";
import {
  STEP_TYPES,
  PHASE_INFO,
  createDefaultStep,
} from "@/types/unified-workflow";

// Step type categories for organized display
type CategoryId = "root" | "tests" | "checks" | "gui" | "api" | "awas";

interface CategoryDef {
  id: CategoryId;
  label: string;
  items: string[];
}

const CATEGORIES: CategoryDef[] = [
  {
    id: "tests",
    label: "Tests",
    items: [
      "test_playwright",
      "test_vision",
      "test_python",
      "test_repository",
      "test_custom",
    ],
  },
  {
    id: "checks",
    label: "Code Checks",
    items: [
      "check_lint",
      "check_format",
      "check_typecheck",
      "check_analyze",
      "check_security",
      "check_custom",
    ],
  },
  {
    id: "gui",
    label: "GUI Actions",
    items: ["gui_action", "state", "macro", "screenshot"],
  },
  { id: "api", label: "API & Integration", items: ["api_request", "mcp_call"] },
  {
    id: "awas",
    label: "AWAS",
    items: [
      "awas_discover",
      "awas_execute",
      "awas_check_support",
      "awas_list_actions",
      "awas_extract_elements",
    ],
  },
];

// Items that appear at root level (not in subcategories)
const ROOT_ITEMS = [
  "script",
  "prompt",
  "shell_command",
  "workflow_ref",
  "spec",
  "gate",
];

function resolveStepType(displayType: string): {
  type: UnifiedStep["type"];
  subType?: string;
} {
  // Handle compound types like "test_playwright" -> { type: "test", subType: "playwright" }
  if (displayType.startsWith("test_")) {
    const testTypeMap: Record<string, string> = {
      test_playwright: "playwright",
      test_vision: "qontinui_vision",
      test_python: "python",
      test_repository: "repository",
      test_custom: "custom_command",
    };
    return { type: "test", subType: testTypeMap[displayType] };
  }
  if (displayType.startsWith("check_")) {
    const checkTypeMap: Record<string, string> = {
      check_lint: "lint",
      check_format: "format",
      check_typecheck: "typecheck",
      check_analyze: "analyze",
      check_security: "security",
      check_custom: "custom_command",
    };
    return { type: "check", subType: checkTypeMap[displayType] };
  }
  return { type: displayType as UnifiedStep["type"] };
}

interface AddStepDropdownProps {
  phase: WorkflowPhase;
  isOpen: boolean;
  onClose: () => void;
  onAddStep: (step: UnifiedStep, phase: WorkflowPhase) => void;
}

export function AddStepDropdown({
  phase,
  isOpen,
  onClose,
  onAddStep,
}: AddStepDropdownProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("root");
  const stepTypes = STEP_TYPES[phase];
  const phaseInfo = PHASE_INFO[phase];

  const handleSelectStep = (displayType: string) => {
    const { type, subType } = resolveStepType(displayType);
    const step = createDefaultStep(type, phase);

    // Apply sub-type specializations
    if (step.type === "test" && subType) {
      (step as { test_type: string }).test_type = subType;
      const info = stepTypes.find((s) => s.type === displayType);
      if (info) step.name = info.label;
    }
    if (step.type === "check" && subType) {
      (step as { check_type: string }).check_type = subType;
      const info = stepTypes.find((s) => s.type === displayType);
      if (info) step.name = info.label;
      if (subType === "format")
        (step as { auto_fix?: boolean }).auto_fix = true;
    }

    onAddStep(step, phase);
    setActiveCategory("root");
    onClose();
  };

  const handleClose = () => {
    setActiveCategory("root");
    onClose();
  };

  // Get items for current view
  const getVisibleItems = () => {
    if (activeCategory === "root") {
      return stepTypes.filter((s) => ROOT_ITEMS.includes(s.type));
    }
    const cat = CATEGORIES.find((c) => c.id === activeCategory);
    if (!cat) return [];
    return stepTypes.filter((s) => cat.items.includes(s.type));
  };

  // Get visible categories that have at least one item in this phase
  const getVisibleCategories = () => {
    return CATEGORIES.filter((cat) =>
      cat.items.some((item) => stepTypes.some((s) => s.type === item))
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {activeCategory !== "root" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setActiveCategory("root")}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
            )}
            <span>
              Add Step to {phaseInfo.label}
              {activeCategory !== "root" &&
                ` - ${CATEGORIES.find((c) => c.id === activeCategory)?.label}`}
            </span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-1 p-1">
            {activeCategory === "root" && (
              <>
                {/* Root-level step types */}
                {getVisibleItems().map((item) => (
                  <button
                    key={item.type}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition-colors"
                    onClick={() => handleSelectStep(item.type)}
                  >
                    <Plus className="w-4 h-4 text-zinc-400" />
                    <div>
                      <div className="text-sm text-zinc-200">{item.label}</div>
                      <div className="text-xs text-zinc-500">
                        {item.description}
                      </div>
                    </div>
                  </button>
                ))}

                {/* Category folders */}
                {getVisibleCategories().map((cat) => (
                  <button
                    key={cat.id}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition-colors"
                    onClick={() => setActiveCategory(cat.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Plus className="w-4 h-4 text-zinc-400" />
                      <div>
                        <div className="text-sm text-zinc-200">{cat.label}</div>
                        <div className="text-xs text-zinc-500">
                          {
                            cat.items.filter((i) =>
                              stepTypes.some((s) => s.type === i)
                            ).length
                          }{" "}
                          types
                        </div>
                      </div>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-zinc-500 rotate-180" />
                  </button>
                ))}
              </>
            )}

            {/* Category items */}
            {activeCategory !== "root" &&
              getVisibleItems().map((item) => (
                <button
                  key={item.type}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition-colors"
                  onClick={() => handleSelectStep(item.type)}
                >
                  <Plus className="w-4 h-4 text-zinc-400" />
                  <div>
                    <div className="text-sm text-zinc-200">{item.label}</div>
                    <div className="text-xs text-zinc-500">
                      {item.description}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
