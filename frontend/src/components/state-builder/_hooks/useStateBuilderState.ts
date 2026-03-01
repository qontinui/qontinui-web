import { useState, useMemo } from "react";
import type { State } from "@/contexts/automation-context";
import type { StateTemplate } from "../types";

export function useStateBuilderState(states: State[]) {
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

  // Computed: current state
  const currentState = useMemo(() => {
    return states.find((s) => s.id === currentStateId) || null;
  }, [states, currentStateId]);

  return {
    // Group
    selectedGroupId,

    // Selection
    selectedStateIds,
    setSelectedStateIds,
    currentStateId,
    setCurrentStateId,

    // Search & filters
    searchQuery,
    setSearchQuery,
    filterTags,
    setFilterTags,
    filterHasImages,
    setFilterHasImages,
    filterHasTransitions,
    setFilterHasTransitions,

    // Dialogs
    showTemplateDialog,
    setShowTemplateDialog,
    showBulkDialog,
    setShowBulkDialog,
    showGraphDialog,
    setShowGraphDialog,

    // Tabs
    activeTab,
    setActiveTab,

    // Canvas
    canvasZoom,
    setCanvasZoom,
    canvasPan,
    setCanvasPan,
    selectedImageIndex,
    setSelectedImageIndex,

    // Templates
    templates,

    // Computed
    currentState,
  };
}
