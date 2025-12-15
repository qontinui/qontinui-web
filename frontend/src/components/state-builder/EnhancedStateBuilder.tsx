/**
 * Enhanced State Builder for Large Projects
 *
 * A comprehensive state management interface with:
 * - Hierarchical group structure navigation
 * - Visual state canvas with image/region/location editing
 * - Advanced search and filtering
 * - Bulk operations
 * - State comparison and relationship visualization
 * - Template system
 */

"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  Search,
  Plus,
  Trash2,
  Copy,
  ImageIcon,
  ArrowRightLeft,
  ZoomIn,
  ZoomOut,
  Grid,
  Eye,
  Download,
  FileText,
  Check,
  MoreVertical,
  Filter,
  Settings,
  GitBranch,
  Star,
  Layout,
} from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import type {
  State,
  StateImage,
  StateRegion,
  StateLocation,
} from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

interface StateWithMetadata extends State {
  groupId?: string | null;
  tags?: string[];
  complexity?: number;
  createdAt?: Date;
  modifiedAt?: Date;
}

interface StateTemplate {
  id: string;
  name: string;
  description: string;
  template: Partial<State>;
  thumbnail?: string;
}

interface BulkOperationPayload {
  stateIds: string[];
  operation: "move" | "tag" | "delete" | "export" | "duplicate";
  data?: unknown;
}

// ============================================================================
// Main Component
// ============================================================================

export function EnhancedStateBuilder() {
  const {
    states,
    transitions,
    addState,
    updateState,
    deleteState,
    resolvePatternImage,
  } = useAutomation();

  // ============================================================================
  // State Management
  // ============================================================================

  const [selectedGroupId] = useState<string | null>("root");
  const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(
    new Set()
  );
  const [currentStateId, setCurrentStateId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterHasImages, setFilterHasImages] = useState<boolean | null>(null);
  const [filterHasTransitions, setFilterHasTransitions] = useState<
    boolean | null
  >(null);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [showGraphDialog, setShowGraphDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Canvas state
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null
  );

  // Templates (mock data for now)
  const [templates] = useState<StateTemplate[]>([
    {
      id: "template-1",
      name: "Basic Menu State",
      description: "State with typical menu structure",
      template: {
        name: "New Menu State",
        description: "Menu state template",
        stateImages: [],
        regions: [],
        locations: [],
        strings: [],
      },
    },
    {
      id: "template-2",
      name: "Login Form State",
      description: "State with login form elements",
      template: {
        name: "Login Form",
        description: "Login form state template",
        stateImages: [],
        regions: [],
        locations: [],
        strings: [
          { id: "str-1", name: "username", value: "", inputText: true },
          { id: "str-2", name: "password", value: "", inputText: true },
        ],
      },
    },
  ]);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const currentState = useMemo(() => {
    return states.find((s) => s.id === currentStateId) || null;
  }, [states, currentStateId]);

  const filteredStates = useMemo(() => {
    let filtered = states;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query)
      );
    }

    // Filter by group
    if (selectedGroupId && selectedGroupId !== "root") {
      filtered = filtered.filter(
        (s) => (s as StateWithMetadata).groupId === selectedGroupId
      );
    }

    // Filter by tags
    if (filterTags.length > 0) {
      filtered = filtered.filter((s) => {
        const stateTags = (s as StateWithMetadata).tags || [];
        return filterTags.some((tag) => stateTags.includes(tag));
      });
    }

    // Filter by has images
    if (filterHasImages !== null) {
      filtered = filtered.filter((s) =>
        filterHasImages
          ? s.stateImages && s.stateImages.length > 0
          : !s.stateImages || s.stateImages.length === 0
      );
    }

    // Filter by has transitions
    if (filterHasTransitions !== null) {
      filtered = filtered.filter((s) => {
        const hasTransitions = transitions.some(
          (t) =>
            (t.type === "OutgoingTransition" && t.fromState === s.id) ||
            (t.type === "IncomingTransition" && t.toState === s.id)
        );
        return filterHasTransitions ? hasTransitions : !hasTransitions;
      });
    }

    return filtered;
  }, [
    states,
    searchQuery,
    selectedGroupId,
    filterTags,
    filterHasImages,
    filterHasTransitions,
    transitions,
  ]);

  const stateComplexity = useCallback((state: State) => {
    let score = 0;
    score += (state.stateImages?.length || 0) * 2;
    score += (state.regions?.length || 0) * 1;
    score += (state.locations?.length || 0) * 1;
    score += (state.strings?.length || 0) * 0.5;

    // Add complexity for patterns
    state.stateImages?.forEach((si) => {
      score += (si.patterns?.length || 0) * 1.5;
    });

    return Math.round(score);
  }, []);

  const stateHasImages = useCallback(
    (state: State) => state.stateImages && state.stateImages.length > 0,
    []
  );

  const stateHasTransitions = useCallback(
    (state: State) =>
      transitions.some(
        (t) =>
          (t.type === "OutgoingTransition" && t.fromState === state.id) ||
          (t.type === "IncomingTransition" && t.toState === state.id)
      ),
    [transitions]
  );

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleCreateState = useCallback(() => {
    const newState: State = {
      id: `state-${Date.now()}`,
      name: "New State",
      description: "",
      stateImages: [],
      regions: [],
      locations: [],
      strings: [],
      position: { x: 0, y: 0 },
    };

    addState(newState);
    setCurrentStateId(newState.id);
    toast.success("State created");
  }, [addState]);

  const handleCreateStateFromTemplate = useCallback(
    (template: StateTemplate) => {
      const newState: State = {
        id: `state-${Date.now()}`,
        name: template.template.name || "New State",
        description: template.template.description || "",
        stateImages: template.template.stateImages || [],
        regions: template.template.regions || [],
        locations: template.template.locations || [],
        strings: template.template.strings || [],
        position: { x: 0, y: 0 },
      };

      addState(newState);
      setCurrentStateId(newState.id);
      setShowTemplateDialog(false);
      toast.success(`State created from template: ${template.name}`);
    },
    [addState]
  );

  const handleDeleteState = useCallback(
    (stateId: string) => {
      if (confirm("Delete this state? This action cannot be undone.")) {
        deleteState(stateId);
        if (currentStateId === stateId) {
          setCurrentStateId(null);
        }
        setSelectedStateIds((prev) => {
          const next = new Set(prev);
          next.delete(stateId);
          return next;
        });
        toast.success("State deleted");
      }
    },
    [deleteState, currentStateId]
  );

  const handleToggleStateSelection = useCallback((stateId: string) => {
    setSelectedStateIds((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  }, []);

  const handleBulkOperation = useCallback(
    (operation: BulkOperationPayload) => {
      const { stateIds, operation: op } = operation;

      switch (op) {
        case "delete":
          if (
            confirm(
              `Delete ${stateIds.length} state(s)? This action cannot be undone.`
            )
          ) {
            stateIds.forEach((id) => deleteState(id));
            setSelectedStateIds(new Set());
            toast.success(`Deleted ${stateIds.length} state(s)`);
          }
          break;

        case "move":
          // Move to group (would need to update state metadata)
          toast.info("Move operation not yet implemented");
          break;

        case "tag":
          // Add tags to states (would need to update state metadata)
          toast.info("Tag operation not yet implemented");
          break;

        case "export":
          // Export selected states
          const exportData = states.filter((s) => stateIds.includes(s.id));
          const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `states-export-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success(`Exported ${stateIds.length} state(s)`);
          break;

        case "duplicate":
          stateIds.forEach((id) => {
            const original = states.find((s) => s.id === id);
            if (original) {
              const duplicate: State = {
                ...original,
                id: `state-${Date.now()}-${Math.random()}`,
                name: `${original.name} (Copy)`,
              };
              addState(duplicate);
            }
          });
          setSelectedStateIds(new Set());
          toast.success(`Duplicated ${stateIds.length} state(s)`);
          break;
      }

      setShowBulkDialog(false);
    },
    [states, deleteState, addState]
  );

  const handleUpdateCurrentState = useCallback(
    (updates: Partial<State>) => {
      if (currentState) {
        updateState({ ...currentState, ...updates });
      }
    },
    [currentState, updateState]
  );

  const handleAddStateImage = useCallback(() => {
    if (!currentState) return;

    const newStateImage: StateImage = {
      id: `si-${Date.now()}`,
      name: "New Image",
      patterns: [],
      shared: false,
    };

    handleUpdateCurrentState({
      stateImages: [...(currentState.stateImages || []), newStateImage],
    });
    setSelectedImageIndex(currentState.stateImages?.length || 0);
    toast.success("StateImage added");
  }, [currentState, handleUpdateCurrentState]);

  const handleRemoveStateImage = useCallback(
    (index: number) => {
      if (!currentState) return;

      const updated = [...(currentState.stateImages || [])];
      updated.splice(index, 1);
      handleUpdateCurrentState({ stateImages: updated });

      if (selectedImageIndex === index) {
        setSelectedImageIndex(null);
      }
      toast.success("StateImage removed");
    },
    [currentState, handleUpdateCurrentState, selectedImageIndex]
  );

  const handleAddRegion = useCallback(() => {
    if (!currentState) return;

    const newRegion: StateRegion = {
      id: `region-${Date.now()}`,
      name: "New Region",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    };

    handleUpdateCurrentState({
      regions: [...(currentState.regions || []), newRegion],
    });
    toast.success("Region added");
  }, [currentState, handleUpdateCurrentState]);

  const handleAddLocation = useCallback(() => {
    if (!currentState) return;

    const newLocation: StateLocation = {
      id: `loc-${Date.now()}`,
      name: "New Location",
      x: 100,
      y: 100,
      fixed: false,
      anchor: false,
    };

    handleUpdateCurrentState({
      locations: [...(currentState.locations || []), newLocation],
    });
    toast.success("Location added");
  }, [currentState, handleUpdateCurrentState]);

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const renderStateNavigator = () => (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">State Navigator</CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTemplateDialog(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCreateState}>
              <FileText className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search states..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Filter className="h-3 w-3 mr-1" />
                Filters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() =>
                  setFilterHasImages(filterHasImages === true ? null : true)
                }
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    filterHasImages === true ? "opacity-100" : "opacity-0"
                  )}
                />
                Has Images
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setFilterHasTransitions(
                    filterHasTransitions === true ? null : true
                  )
                }
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    filterHasTransitions === true ? "opacity-100" : "opacity-0"
                  )}
                />
                Has Transitions
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setFilterHasImages(null);
                  setFilterHasTransitions(null);
                  setFilterTags([]);
                }}
              >
                Clear Filters
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {selectedStateIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowBulkDialog(true)}
            >
              {selectedStateIds.size} selected
            </Button>
          )}
        </div>

        {/* State List */}
        <ScrollArea className="flex-1">
          <div className="space-y-1">
            {filteredStates.map((state) => {
              const isSelected = currentStateId === state.id;
              const isChecked = selectedStateIds.has(state.id);
              const complexity = stateComplexity(state);

              return (
                <div
                  key={state.id}
                  className={cn(
                    "group relative flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors",
                    isSelected
                      ? "bg-primary/10 border-primary"
                      : "border-transparent hover:bg-accent"
                  )}
                  onClick={() => setCurrentStateId(state.id)}
                >
                  <Checkbox
                    checked={isChecked}
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={() => handleToggleStateSelection(state.id)}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {state.name}
                      </span>
                      {state.initial && (
                        <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {stateHasImages(state) && (
                        <Badge variant="secondary" className="text-xs">
                          <ImageIcon className="h-3 w-3 mr-1" />
                          {state.stateImages?.length || 0}
                        </Badge>
                      )}
                      {stateHasTransitions(state) && (
                        <Badge variant="secondary" className="text-xs">
                          <ArrowRightLeft className="h-3 w-3" />
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          complexity < 5 && "border-green-500 text-green-500",
                          complexity >= 5 &&
                            complexity < 15 &&
                            "border-yellow-500 text-yellow-500",
                          complexity >= 15 && "border-red-500 text-red-500"
                        )}
                      >
                        {complexity}
                      </Badge>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setCurrentStateId(state.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          const duplicate: State = {
                            ...state,
                            id: `state-${Date.now()}`,
                            name: `${state.name} (Copy)`,
                          };
                          addState(duplicate);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDeleteState(state.id)}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );

  const renderStateCanvas = () => {
    if (!currentState) {
      return (
        <Card className="h-full flex items-center justify-center">
          <CardContent className="text-center text-muted-foreground">
            <Layout className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Select a state to view and edit</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{currentState.name}</CardTitle>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCanvasZoom((z) => Math.min(z + 0.1, 2))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCanvasZoom((z) => Math.max(z - 0.1, 0.5))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCanvasZoom(1);
                  setCanvasPan({ x: 0, y: 0 });
                }}
              >
                <Grid className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto">
          <div
            style={{
              transform: `scale(${canvasZoom}) translate(${canvasPan.x}px, ${canvasPan.y}px)`,
              transformOrigin: "top left",
            }}
          >
            {/* StateImages Grid */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-semibold">StateImages</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddStateImage}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Image
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {currentState.stateImages
                  ?.slice(0, 6)
                  .map((stateImage, idx) => {
                    const firstPattern = stateImage.patterns?.[0];
                    const imageData = firstPattern
                      ? resolvePatternImage(firstPattern)
                      : null;

                    return (
                      <div
                        key={stateImage.id}
                        className={cn(
                          "relative border rounded p-2 cursor-pointer transition-colors",
                          selectedImageIndex === idx
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                        onClick={() => setSelectedImageIndex(idx)}
                      >
                        {imageData ? (
                          <img
                            src={imageData.url}
                            alt={stateImage.name}
                            className="w-full h-24 object-cover rounded"
                          />
                        ) : (
                          <div className="w-full h-24 flex items-center justify-center bg-muted rounded">
                            <ImageIcon className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <p className="text-xs mt-1 truncate">
                          {stateImage.name}
                        </p>
                        <Badge
                          variant="secondary"
                          className="absolute top-1 right-1 text-xs"
                        >
                          {stateImage.patterns?.length || 0}
                        </Badge>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Regions Preview */}
            {currentState.regions && currentState.regions.length > 0 && (
              <div className="mb-6">
                <Label className="text-xs font-semibold mb-3 block">
                  Regions
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {currentState.regions.map((region) => (
                    <div
                      key={region.id}
                      className="border rounded p-2 text-xs space-y-1"
                    >
                      <div className="font-medium">{region.name}</div>
                      <div className="text-muted-foreground">
                        {region.width} × {region.height}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Locations Preview */}
            {currentState.locations && currentState.locations.length > 0 && (
              <div>
                <Label className="text-xs font-semibold mb-3 block">
                  Locations
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {currentState.locations.map((location) => (
                    <div
                      key={location.id}
                      className="border rounded p-2 text-xs space-y-1"
                    >
                      <div className="font-medium">{location.name}</div>
                      <div className="text-muted-foreground">
                        ({location.x}, {location.y})
                        {location.anchor && " • Anchor"}
                        {location.fixed && " • Fixed"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPropertiesPanel = () => {
    if (!currentState) {
      return (
        <Card className="h-full flex items-center justify-center">
          <CardContent className="text-center text-muted-foreground">
            <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Select a state to view properties</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Properties</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="h-full flex flex-col"
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview" className="text-xs">
                Overview
              </TabsTrigger>
              <TabsTrigger value="images" className="text-xs">
                Images
              </TabsTrigger>
              <TabsTrigger value="regions" className="text-xs">
                Regions
              </TabsTrigger>
              <TabsTrigger value="locations" className="text-xs">
                Locations
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-4">
              <TabsContent value="overview" className="space-y-4 m-0">
                <div className="space-y-2">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={currentState.name}
                    onChange={(e) =>
                      handleUpdateCurrentState({ name: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Description</Label>
                  <Textarea
                    value={currentState.description || ""}
                    onChange={(e) =>
                      handleUpdateCurrentState({ description: e.target.value })
                    }
                    rows={3}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="initial"
                    checked={currentState.initial || false}
                    onCheckedChange={(checked) =>
                      handleUpdateCurrentState({ initial: checked as boolean })
                    }
                  />
                  <Label htmlFor="initial" className="text-xs">
                    Initial State
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Complexity Score</Label>
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-full justify-center",
                      stateComplexity(currentState) < 5 &&
                        "border-green-500 text-green-500",
                      stateComplexity(currentState) >= 5 &&
                        stateComplexity(currentState) < 15 &&
                        "border-yellow-500 text-yellow-500",
                      stateComplexity(currentState) >= 15 &&
                        "border-red-500 text-red-500"
                    )}
                  >
                    {stateComplexity(currentState)}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      StateImages
                    </Label>
                    <div className="text-lg font-semibold">
                      {currentState.stateImages?.length || 0}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Regions
                    </Label>
                    <div className="text-lg font-semibold">
                      {currentState.regions?.length || 0}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Locations
                    </Label>
                    <div className="text-lg font-semibold">
                      {currentState.locations?.length || 0}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Strings
                    </Label>
                    <div className="text-lg font-semibold">
                      {currentState.strings?.length || 0}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="images" className="space-y-4 m-0">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">StateImages</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddStateImage}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>

                <div className="space-y-3">
                  {currentState.stateImages?.map((stateImage, idx) => (
                    <Card key={stateImage.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-xs font-medium">
                            {stateImage.name}
                          </CardTitle>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveStateImage(idx)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                          {stateImage.patterns?.length || 0} pattern(s)
                        </div>
                        {stateImage.patterns?.[0] && (
                          <div className="aspect-video rounded overflow-hidden bg-muted">
                            {(() => {
                              const imageData = resolvePatternImage(
                                stateImage.patterns[0]
                              );
                              return imageData ? (
                                <img
                                  src={imageData.url}
                                  alt={stateImage.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="regions" className="space-y-4 m-0">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Regions</Label>
                  <Button size="sm" variant="outline" onClick={handleAddRegion}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>

                <div className="space-y-2">
                  {currentState.regions?.map((region) => (
                    <Card key={region.id}>
                      <CardContent className="p-3 space-y-2">
                        <div className="font-medium text-sm">{region.name}</div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>X: {region.x}</div>
                          <div>Y: {region.y}</div>
                          <div>W: {region.width}</div>
                          <div>H: {region.height}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="locations" className="space-y-4 m-0">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Locations</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddLocation}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>

                <div className="space-y-2">
                  {currentState.locations?.map((location) => (
                    <Card key={location.id}>
                      <CardContent className="p-3 space-y-2">
                        <div className="font-medium text-sm">
                          {location.name}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>X: {location.x}</div>
                          <div>Y: {location.y}</div>
                          {location.anchor && (
                            <div className="col-span-2">
                              <Badge variant="secondary" className="text-xs">
                                Anchor
                              </Badge>
                            </div>
                          )}
                          {location.fixed && (
                            <div className="col-span-2">
                              <Badge variant="secondary" className="text-xs">
                                Fixed
                              </Badge>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </CardContent>
      </Card>
    );
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="h-screen flex flex-col p-4 gap-4 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Enhanced State Builder</h1>
          <p className="text-sm text-muted-foreground">
            {filteredStates.length} state(s) • {selectedStateIds.size} selected
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowGraphDialog(true)}>
            <GitBranch className="h-4 w-4 mr-2" />
            View Graph
          </Button>
          <Button variant="outline" onClick={() => setShowTemplateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            From Template
          </Button>
          <Button onClick={handleCreateState}>
            <Plus className="h-4 w-4 mr-2" />
            New State
          </Button>
        </div>
      </div>

      {/* Main Layout: 3-column */}
      <div className="flex-1 grid grid-cols-[300px_1fr_350px] gap-4 overflow-hidden">
        {/* Left: Navigator */}
        {renderStateNavigator()}

        {/* Center: Canvas */}
        {renderStateCanvas()}

        {/* Right: Properties */}
        {renderPropertiesPanel()}
      </div>

      {/* Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create from Template</DialogTitle>
            <DialogDescription>
              Choose a template to quickly create a new state
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {templates.map((template) => (
              <Card
                key={template.id}
                className="cursor-pointer hover:border-primary transition-colors"
                onClick={() => handleCreateStateFromTemplate(template)}
              >
                <CardHeader>
                  <CardTitle className="text-sm">{template.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {template.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Operations Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Operations</DialogTitle>
            <DialogDescription>
              {selectedStateIds.size} state(s) selected
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                handleBulkOperation({
                  stateIds: Array.from(selectedStateIds),
                  operation: "duplicate",
                })
              }
            >
              <Copy className="mr-2 h-4 w-4" />
              Duplicate All
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                handleBulkOperation({
                  stateIds: Array.from(selectedStateIds),
                  operation: "export",
                })
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Export All
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-start"
              onClick={() =>
                handleBulkOperation({
                  stateIds: Array.from(selectedStateIds),
                  operation: "delete",
                })
              }
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete All
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Graph Dialog Placeholder */}
      <Dialog open={showGraphDialog} onOpenChange={setShowGraphDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>State Relationship Graph</DialogTitle>
            <DialogDescription>
              Visual representation of state transitions
            </DialogDescription>
          </DialogHeader>
          <div className="h-[500px] flex items-center justify-center border rounded bg-muted">
            <div className="text-center text-muted-foreground">
              <GitBranch className="h-12 w-12 mx-auto mb-4" />
              <p>Graph visualization would appear here</p>
              <p className="text-xs mt-2">
                Showing {transitions.length} transition(s)
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
