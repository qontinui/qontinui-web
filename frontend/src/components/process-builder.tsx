"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Play,
  Camera,
  Layers,
  ArrowRight,
  Target,
  ChevronRight,
} from "lucide-react";
import { UnifiedProcessLibrary } from "@/components/unified-process-library";
import { ActionEditor } from "@/components/action-editor";
import { ActionProperties } from "@/components/action-properties";
import { useAutomation } from "@/contexts/automation-context";
import { ScreenshotSelector } from "@/components/screenshot-selector";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OutgoingTransitionBuilder } from "@/components/outgoing-transition-builder";
import { IncomingTransitionBuilder } from "@/components/incoming-transition-builder";
import { FormatConversionDialog } from "@/components/format-conversion-dialog";
import { toast } from "sonner";

interface Process {
  id: string;
  name: string;
  description: string;
  category?: string;
  actions: Action[];
  initialScreenshotId?: string;
  initialStateIds?: string[];
}

interface Action {
  id: string;
  type: // Pure mouse actions
    | "MOUSE_MOVE"
    | "MOUSE_DOWN"
    | "MOUSE_UP"
    | "MOUSE_SCROLL"
    // Pure keyboard actions
    | "KEY_DOWN"
    | "KEY_UP"
    | "KEY_PRESS"
    // Combined mouse actions
    | "CLICK"
    | "DOUBLE_CLICK"
    | "RIGHT_CLICK"
    | "DRAG"
    | "SCROLL"
    // Combined keyboard actions
    | "TYPE"
    // Control flow actions
    | "IF"
    | "LOOP"
    // Other actions
    | "FIND"
    | "FIND_STATE_IMAGE"
    | "VANISH"
    | "GO_TO_STATE"
    | "RUN_WORKFLOW";
  config: Record<string, any>;
}

type LibraryItem =
  | { type: "process"; data: Process }
  | { type: "workflow"; data: any };

export function ProcessBuilder() {
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [transitionType, setTransitionType] = useState<
    "incoming" | "outgoing" | null
  >(null);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [conversionItem, setConversionItem] = useState<LibraryItem | null>(
    null
  );
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
  const {
    workflows,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    categories,
    screenshots,
    states,
  } = useAutomation();

  // Get selected process from selected item
  const selectedProcess =
    selectedItem?.type === "process" ? selectedItem.data : null;

  // Get all unique categories from workflows and context
  const allCategories = [
    ...new Set([
      "Main",
      "Transitions",
      ...categories,
      ...workflows.map((w) => w.category || "Main"),
    ]),
  ];

  // Keep selectedProcess in sync with the workflows from context
  useEffect(() => {
    if (selectedProcess) {
      const updatedProcess = workflows.find((w) => w.id === selectedProcess.id);
      if (updatedProcess && updatedProcess !== selectedProcess) {
        setSelectedItem({ type: "process", data: updatedProcess } as any);
        // Also update selectedAction if it exists
        if (selectedAction) {
          const updatedAction = updatedProcess.actions.find(
            (a) => a.id === selectedAction.id
          );
          if (updatedAction) {
            setSelectedAction(updatedAction as any);
          }
        }
      }
    }
  }, [workflows, selectedProcess?.id, selectedAction?.id]);

  const createNewProcess = (category: string = "Main") => {
    const newProcess: Process = {
      id: `workflow-${Date.now()}`,
      name: "New Workflow",
      description: "",
      category,
      actions: [],
    };
    addWorkflow(newProcess as any);
    setSelectedItem({ type: "process", data: newProcess } as any);
  };

  const handleUpdateProcess = (updatedProcess: Process) => {
    updateWorkflow(updatedProcess as any);
    // Don't set selectedItem here - let useEffect handle it
  };

  const handleSelectItem = (item: LibraryItem) => {
    if (item.type === "workflow") {
      // Workflows can't be edited in the sequential builder
      toast.info("Graph workflows can only be edited in the Graph Builder", {
        description: "Switch to the Graph Builder tab to edit this workflow.",
      });
      return;
    }
    setSelectedItem(item);
    setSelectedAction(null);
  };

  const handleDeleteItem = (item: LibraryItem) => {
    // Both 'process' and 'workflow' types are stored as workflows
    deleteWorkflow(item.data.id);
    if (selectedItem && selectedItem.data.id === item.data.id) {
      setSelectedItem(null);
      setSelectedAction(null);
    }
  };

  const handleConvertItem = (item: LibraryItem) => {
    setConversionItem(item);
    setConversionDialogOpen(true);
  };

  const handleConversionComplete = (
    converted: Process | any,
    originalType: "process" | "workflow"
  ) => {
    // Both types are stored as workflows, just update the existing one
    addWorkflow(converted);
    if (originalType === "process") {
      toast.success("Converted to graph workflow", {
        description: `"${converted.name}" can now be edited in graph mode.`,
      });
    } else {
      toast.success("Converted to sequential workflow", {
        description: `"${converted.name}" can now be edited in sequential mode.`,
      });
    }
  };

  return (
    <div className="flex h-full">
      {/* Left Panel - Unified Library */}
      <div className="flex-[2] min-w-[300px] max-w-[600px] border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <Button
            onClick={() => createNewProcess()}
            className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Workflow
          </Button>

          <UnifiedProcessLibrary
            selectedItem={selectedItem as any}
            onSelectItem={handleSelectItem as any}
            onDeleteItem={handleDeleteItem as any}
            onUpdateProcess={handleUpdateProcess as any}
            onCreateProcess={createNewProcess}
            onConvertItem={handleConvertItem as any}
          />
        </div>
      </div>

      {/* Center Panel - Process Editor */}
      <div className="flex-[3] min-w-[400px] p-6 overflow-y-auto">
        {selectedProcess ? (
          <div className="space-y-6">
            <div className="space-y-4">
              <Input
                value={selectedProcess.name}
                onChange={(e) => {
                  const updated = { ...selectedProcess, name: e.target.value };
                  handleUpdateProcess(updated);
                }}
                className="text-xl font-bold bg-transparent border-gray-700 focus:border-[#00D9FF]"
                placeholder="Process name"
              />

              <details
                className="group"
                open={optionsExpanded}
                onToggle={(e) =>
                  setOptionsExpanded((e.target as HTMLDetailsElement).open)
                }
              >
                <summary className="flex items-center justify-between cursor-pointer text-xs text-gray-300 hover:text-[#00D9FF] transition-colors list-none py-1 px-2 bg-gray-800/30 rounded">
                  <span className="font-medium">Options</span>
                  <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                </summary>
                <div className="mt-2 space-y-3 pl-2 border-l-2 border-gray-700">
                  <Textarea
                    value={selectedProcess.description}
                    onChange={(e) => {
                      const updated = {
                        ...selectedProcess,
                        description: e.target.value,
                      };
                      handleUpdateProcess(updated);
                    }}
                    className="bg-transparent border-gray-700 focus:border-[#00D9FF]"
                    placeholder="Process description"
                    rows={2}
                  />

                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-400">Category:</label>
                    <Select
                      value={selectedProcess.category || "Main"}
                      onValueChange={(value) => {
                        const updated = { ...selectedProcess, category: value };
                        handleUpdateProcess(updated);
                      }}
                    >
                      <SelectTrigger className="w-48 bg-transparent border-gray-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allCategories.map((category) => (
                          <SelectItem
                            key={category}
                            value={category}
                            title={
                              category === "Main"
                                ? "Processes in the Main category are available for execution in the Qontinui-Runner desktop application"
                                : undefined
                            }
                          >
                            {category}
                            {category === "Main" && (
                              <span className="ml-2 text-xs text-gray-400">
                                • Runner executable
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Integration Test Configuration */}
                  <Card className="border-gray-700 bg-[#27272A]/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-gray-400">
                        Integration Test Configuration
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Initial Screenshot */}
                      <div className="space-y-2">
                        <Label className="text-sm text-gray-400">
                          Initial Screenshot
                        </Label>
                        <div className="flex items-center gap-2">
                          <ScreenshotSelector
                            selectedScreenshot={
                              selectedProcess.initialScreenshotId || ""
                            }
                            onSelectScreenshot={(screenshotId) => {
                              const updated = {
                                ...selectedProcess,
                                initialScreenshotId: screenshotId,
                              };
                              handleUpdateProcess(updated);
                            }}
                            trigger={
                              <Button
                                variant="outline"
                                className="w-full justify-start border-gray-700 bg-transparent hover:bg-gray-800"
                              >
                                <Camera className="w-4 h-4 mr-2" />
                                {selectedProcess.initialScreenshotId
                                  ? screenshots.find(
                                      (s) =>
                                        s.id ===
                                        selectedProcess.initialScreenshotId
                                    )?.name || "Select screenshot"
                                  : "Select screenshot"}
                              </Button>
                            }
                          />
                          {selectedProcess.initialScreenshotId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                const updated = {
                                  ...selectedProcess,
                                  initialScreenshotId: undefined,
                                };
                                handleUpdateProcess(updated);
                              }}
                              className="hover:bg-gray-800"
                            >
                              ×
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          Screenshot to start the test with
                        </p>
                      </div>

                      {/* Initial Active States */}
                      <div className="space-y-2">
                        <Label className="text-sm text-gray-400">
                          Initial Active States
                        </Label>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {states.length === 0 ? (
                            <p className="text-xs text-gray-500">
                              No states defined yet
                            </p>
                          ) : (
                            states.map((state) => (
                              <div
                                key={state.id}
                                className="flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`state-${state.id}`}
                                  checked={
                                    selectedProcess.initialStateIds?.includes(
                                      state.id
                                    ) || false
                                  }
                                  onCheckedChange={(checked) => {
                                    const currentIds =
                                      selectedProcess.initialStateIds || [];
                                    const updated = {
                                      ...selectedProcess,
                                      initialStateIds: checked
                                        ? [...currentIds, state.id]
                                        : currentIds.filter(
                                            (id) => id !== state.id
                                          ),
                                    };
                                    handleUpdateProcess(updated);
                                  }}
                                  className="border-gray-600 data-[state=checked]:bg-[#00D9FF] data-[state=checked]:border-[#00D9FF]"
                                />
                                <Label
                                  htmlFor={`state-${state.id}`}
                                  className="text-sm font-normal text-gray-300 cursor-pointer"
                                >
                                  {state.name}
                                </Label>
                              </div>
                            ))
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          States that should be active at test start
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Transition Selection */}
                  <Card className="border-gray-700 bg-[#27272A]/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-gray-400">
                        Use as Transition
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Button
                        onClick={() => {
                          setTransitionType("outgoing");
                          setShowTransitionDialog(true);
                        }}
                        className="w-full bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
                      >
                        <ArrowRight className="w-4 h-4 mr-2" />
                        Create Outgoing Transition
                      </Button>
                      <Button
                        onClick={() => {
                          setTransitionType("incoming");
                          setShowTransitionDialog(true);
                        }}
                        className="w-full bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
                      >
                        <Target className="w-4 h-4 mr-2" />
                        Create Incoming Transition
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </details>
            </div>

            <ActionEditor
              process={selectedProcess}
              selectedAction={selectedAction}
              onSelectAction={setSelectedAction}
              onUpdateProcess={handleUpdateProcess}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Play className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Select a process to edit</p>
              <p className="text-sm">or create a new one to get started</p>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Action Properties */}
      <div className="flex-[2] min-w-[300px] max-w-[600px] border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <ActionProperties
          action={selectedAction}
          onUpdateAction={(updated) => {
            if (selectedProcess && selectedAction) {
              const updatedProcess = {
                ...selectedProcess,
                actions: selectedProcess.actions.map((a) =>
                  a.id === updated.id ? updated : a
                ),
              };
              handleUpdateProcess(updatedProcess as any);
              // useEffect will handle updating selectedAction
            }
          }}
        />
      </div>

      {/* Transition Dialog */}
      {showTransitionDialog && transitionType === "outgoing" && (
        <OutgoingTransitionBuilder
          preselectedProcess={selectedProcess?.id}
          onClose={() => {
            setShowTransitionDialog(false);
            setTransitionType(null);
          }}
        />
      )}
      {showTransitionDialog && transitionType === "incoming" && (
        <IncomingTransitionBuilder
          preselectedProcess={selectedProcess?.id}
          onClose={() => {
            setShowTransitionDialog(false);
            setTransitionType(null);
          }}
        />
      )}

      {/* Format Conversion Dialog */}
      <FormatConversionDialog
        open={conversionDialogOpen}
        onOpenChange={setConversionDialogOpen}
        item={conversionItem as any}
        onConvert={handleConversionComplete as any}
      />
    </div>
  );
}
