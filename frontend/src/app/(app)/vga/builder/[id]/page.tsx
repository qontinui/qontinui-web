"use client";

/**
 * /vga/builder/[id] — main state-machine editor.
 *
 * Three-pane layout:
 *   - Left  : list of states in the SM.
 *   - Center: screenshot canvas with overlay for proposals/elements.
 *   - Right : active state details — elements + transitions.
 *
 * Autosave: PATCH is debounced 500ms after the last change.
 */

import { useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Clipboard,
  Download,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type {
  VgaBBox,
  VgaElementGraph,
  VgaStateGraphNode,
  VgaStateMachineGraph,
  VgaStateMachineRow,
  VgaTransitionGraph,
} from "@/lib/types/vga";

import {
  blobToBase64,
  captureScreenshot,
  deleteStateMachine,
  getStateMachine,
  groundOnce,
  listMonitors,
  patchStateMachine,
  proposeElements,
  submitCorrection,
} from "../../_components/api-client";
import type {
  BuilderImage,
  ProposalDraft,
} from "../../_components/builder-types";

const PROPOSAL_BOX_HALF = 20; // matches /api/vga/ground default
const PROPOSAL_BOX_SIZE = PROPOSAL_BOX_HALF * 2;

function randomId() {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 12)}`;
}

function centeredBBox(x: number, y: number): VgaBBox {
  return {
    x: Math.max(0, x - PROPOSAL_BOX_HALF),
    y: Math.max(0, y - PROPOSAL_BOX_HALF),
    w: PROPOSAL_BOX_SIZE,
    h: PROPOSAL_BOX_SIZE,
  };
}

export default function VgaBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: sm,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["vga", "state-machine", id],
    queryFn: () => getStateMachine(id),
    refetchOnWindowFocus: false,
  });

  // Local working copy of the state graph for optimistic edits.
  const [graph, setGraph] = useState<VgaStateMachineGraph | null>(null);
  const [smName, setSmName] = useState("");
  const [activeStateId, setActiveStateId] = useState<string | null>(null);
  const [image, setImage] = useState<BuilderImage | null>(null);
  const [proposals, setProposals] = useState<ProposalDraft[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(
    null
  );
  const [isProposing, setIsProposing] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Initialize local state once the SM loads.
  useEffect(() => {
    if (!sm) return;
    if (graph === null) {
      setGraph(sm.stateGraph);
      setSmName(sm.name);
      const firstStateId = sm.stateGraph.states[0]?.id ?? null;
      setActiveStateId(firstStateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sm]);

  // Autosave — debounce a PATCH 500ms after the last mutation.
  const patchMutation = useMutation({
    mutationFn: async (patch: {
      name?: string;
      stateGraph?: VgaStateMachineGraph;
    }) => {
      return patchStateMachine(id, patch);
    },
    onSuccess: (row) => {
      queryClient.setQueryData<VgaStateMachineRow>(
        ["vga", "state-machine", id],
        row
      );
    },
    onError: (err) => {
      toast.error(`Save failed: ${(err as Error).message}`);
    },
  });

  const lastSaveTriggerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function queueSave(next: {
    name?: string;
    stateGraph?: VgaStateMachineGraph;
  }) {
    if (lastSaveTriggerRef.current) {
      clearTimeout(lastSaveTriggerRef.current);
    }
    lastSaveTriggerRef.current = setTimeout(() => {
      patchMutation.mutate(next);
    }, 500);
  }

  // ---------- Graph mutators (optimistic local + debounced PATCH) ----------

  function updateGraph(
    updater: (g: VgaStateMachineGraph) => VgaStateMachineGraph
  ) {
    setGraph((prev) => {
      if (prev === null) return prev;
      const next = updater(prev);
      queueSave({ stateGraph: next });
      return next;
    });
  }

  function renameSm(name: string) {
    setSmName(name);
    queueSave({ name });
  }

  function addState() {
    const newState: VgaStateGraphNode = {
      id: randomId(),
      name: "New state",
      elements: [],
      blocking: false,
    };
    updateGraph((g) => ({ ...g, states: [...g.states, newState] }));
    setActiveStateId(newState.id);
  }

  function renameState(stateId: string, name: string) {
    updateGraph((g) => ({
      ...g,
      states: g.states.map((s) => (s.id === stateId ? { ...s, name } : s)),
    }));
  }

  function setStateBlocking(stateId: string, blocking: boolean) {
    updateGraph((g) => ({
      ...g,
      states: g.states.map((s) => (s.id === stateId ? { ...s, blocking } : s)),
    }));
  }

  function deleteState(stateId: string) {
    updateGraph((g) => ({
      ...g,
      states: g.states.filter((s) => s.id !== stateId),
      transitions: g.transitions.filter(
        (t) => t.from_state_id !== stateId && t.to_state_id !== stateId
      ),
    }));
    if (activeStateId === stateId) {
      setActiveStateId(null);
    }
  }

  function addElementToActiveState(el: VgaElementGraph) {
    if (!activeStateId) return;
    updateGraph((g) => ({
      ...g,
      states: g.states.map((s) =>
        s.id === activeStateId ? { ...s, elements: [...s.elements, el] } : s
      ),
    }));
  }

  function updateElement(
    stateId: string,
    elementId: string,
    patch: Partial<VgaElementGraph>
  ) {
    updateGraph((g) => ({
      ...g,
      states: g.states.map((s) =>
        s.id === stateId
          ? {
              ...s,
              elements: s.elements.map((e) =>
                e.id === elementId ? { ...e, ...patch } : e
              ),
            }
          : s
      ),
    }));
  }

  function deleteElement(stateId: string, elementId: string) {
    updateGraph((g) => ({
      ...g,
      states: g.states.map((s) =>
        s.id === stateId
          ? { ...s, elements: s.elements.filter((e) => e.id !== elementId) }
          : s
      ),
      transitions: g.transitions.filter(
        (t) => t.trigger_element_id !== elementId
      ),
    }));
  }

  function addTransition(
    fromStateId: string,
    toStateId: string,
    triggerElementId: string
  ) {
    const t: VgaTransitionGraph = {
      id: randomId(),
      from_state_id: fromStateId,
      to_state_id: toStateId,
      trigger_element_id: triggerElementId,
    };
    updateGraph((g) => ({ ...g, transitions: [...g.transitions, t] }));
  }

  function deleteTransition(transitionId: string) {
    updateGraph((g) => ({
      ...g,
      transitions: g.transitions.filter((t) => t.id !== transitionId),
    }));
  }

  // ---------- Propose / correct ----------

  async function runPropose() {
    if (!image) {
      toast.error("Capture or upload a screenshot first");
      return;
    }
    setIsProposing(true);
    try {
      const props = await proposeElements(image.base64);
      const drafts: ProposalDraft[] = props.map((p) => ({
        ...p,
        draftId: randomId(),
        editedLabel: p.label,
        editedPrompt: p.prompt,
        bbox: centeredBBox(p.x, p.y),
      }));
      setProposals(drafts);
      setSelectedProposalId(drafts[0]?.draftId ?? null);
      if (drafts.length === 0) {
        toast.info("No elements proposed — try a different screenshot");
      } else {
        toast.success(`Got ${drafts.length} proposals`);
      }
    } catch (err) {
      toast.error(`Propose failed: ${(err as Error).message}`);
    } finally {
      setIsProposing(false);
    }
  }

  function clearProposals() {
    setProposals([]);
    setSelectedProposalId(null);
  }

  async function confirmProposal(draft: ProposalDraft) {
    if (!activeStateId) {
      toast.error("Select a state first");
      return;
    }
    const newEl: VgaElementGraph = {
      id: randomId(),
      label: draft.editedLabel,
      prompt: draft.editedPrompt,
      bbox: draft.bbox,
      last_confirmed_at: new Date().toISOString(),
      correction_count: 0,
    };
    addElementToActiveState(newEl);
    // Remove it from proposal list once confirmed.
    setProposals((ps) => ps.filter((p) => p.draftId !== draft.draftId));
    setSelectedProposalId(null);
    toast.success(`Added "${newEl.label}"`);
  }

  async function submitCorrectionForProposal(draft: ProposalDraft) {
    if (!image) return;
    try {
      await submitCorrection({
        stateMachineId: id,
        imageBase64: image.base64,
        prompt: draft.editedPrompt,
        correctedBbox: draft.bbox,
        source: "builder",
      });
      toast.success("Correction recorded");
    } catch (err) {
      toast.error(`Correction failed: ${(err as Error).message}`);
    }
  }

  async function regroundElement(el: VgaElementGraph, stateId: string) {
    if (!image) {
      toast.error("Need a screenshot to re-ground");
      return;
    }
    try {
      const r = await groundOnce(image.base64, el.prompt);
      if (r.x === null || r.y === null) {
        toast.warning("Model could not locate this element in the screenshot");
        return;
      }
      updateElement(stateId, el.id, {
        bbox: centeredBBox(r.x, r.y),
        last_confirmed_at: new Date().toISOString(),
      });
      toast.success("Element re-grounded");
    } catch (err) {
      toast.error(`Re-ground failed: ${(err as Error).message}`);
    }
  }

  // ---------- Export / delete ----------

  function handleExport() {
    const url = `/api/vga/state/${id}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${smName || "vga-state-machine"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleDelete() {
    try {
      await deleteStateMachine(id);
      toast.success("State machine deleted");
      queryClient.removeQueries({ queryKey: ["vga", "state-machine", id] });
      router.push("/vga");
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  }

  // ---------- Rendering guards ----------

  if (isLoading || graph === null) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !sm) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-sm text-red-500">
          Failed to load state machine: {(error as Error)?.message ?? "unknown"}
        </div>
      </div>
    );
  }

  const activeState = graph.states.find((s) => s.id === activeStateId) ?? null;

  return (
    <TooltipProvider>
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/vga" aria-label="Back to VGA landing">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="size-4" />
              </Button>
            </Link>
            <Input
              aria-label="State machine name"
              value={smName}
              onChange={(e) => renameSm(e.target.value)}
              className="font-medium max-w-xs"
            />
            <Badge variant="outline" className="font-mono text-[10px] shrink-0">
              {sm.groundingModel}
            </Badge>
            <Badge variant="secondary" className="shrink-0">
              {sm.targetProcess}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {patchMutation.isPending ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" /> Saving
              </span>
            ) : patchMutation.isSuccess ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Save className="size-3" /> Saved
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="size-4" /> Export JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteOpen(true)}
              aria-label="Delete state machine"
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
        </header>

        {/* Three-pane body */}
        <div className="flex-1 flex min-h-0">
          {/* Left: state list */}
          <StateListPane
            states={graph.states}
            activeStateId={activeStateId}
            onSelect={setActiveStateId}
            onAdd={addState}
          />

          {/* Center: canvas */}
          <CanvasPane
            image={image}
            onImageChange={setImage}
            proposals={proposals}
            setProposals={setProposals}
            selectedProposalId={selectedProposalId}
            setSelectedProposalId={setSelectedProposalId}
            onPropose={runPropose}
            onClearProposals={clearProposals}
            isProposing={isProposing}
            activeStateElements={activeState?.elements ?? []}
            onConfirmProposal={confirmProposal}
            onCorrectionSubmit={submitCorrectionForProposal}
          />

          {/* Right: active state details */}
          <StateDetailsPane
            state={activeState}
            allStates={graph.states}
            transitions={graph.transitions.filter(
              (t) => t.from_state_id === activeStateId
            )}
            onRenameState={renameState}
            onSetBlocking={setStateBlocking}
            onDeleteState={deleteState}
            onUpdateElement={updateElement}
            onDeleteElement={deleteElement}
            onRegroundElement={regroundElement}
            onAddTransition={addTransition}
            onDeleteTransition={deleteTransition}
          />
        </div>

        <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this state machine?</DialogTitle>
              <DialogDescription>
                This removes the row and all associated runs. This cannot be
                undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// ---------------- Left pane ----------------

interface StateListPaneProps {
  states: VgaStateGraphNode[];
  activeStateId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

function StateListPane({
  states,
  activeStateId,
  onSelect,
  onAdd,
}: StateListPaneProps) {
  return (
    <aside className="w-64 border-r border-border flex flex-col min-h-0 shrink-0">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium">States</span>
        <Button
          size="sm"
          variant="outline"
          onClick={onAdd}
          aria-label="Add state"
        >
          <Plus className="size-3" /> Add
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {states.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3">
            No states yet. Click Add to create one.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {states.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-pressed={activeStateId === s.id}
                  className={
                    "w-full text-left px-3 py-2 hover:bg-muted transition-colors " +
                    (activeStateId === s.id ? "bg-muted" : "")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {s.name}
                    </span>
                    {s.blocking && (
                      <Shield
                        className="size-3 text-amber-500 shrink-0"
                        aria-label="Blocking state"
                      />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.elements.length} element
                    {s.elements.length === 1 ? "" : "s"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ---------------- Center pane (canvas) ----------------

interface CanvasPaneProps {
  image: BuilderImage | null;
  onImageChange: (img: BuilderImage | null) => void;
  proposals: ProposalDraft[];
  setProposals: (
    updater: ProposalDraft[] | ((p: ProposalDraft[]) => ProposalDraft[])
  ) => void;
  selectedProposalId: string | null;
  setSelectedProposalId: (id: string | null) => void;
  onPropose: () => void;
  onClearProposals: () => void;
  isProposing: boolean;
  activeStateElements: VgaElementGraph[];
  onConfirmProposal: (d: ProposalDraft) => void;
  onCorrectionSubmit: (d: ProposalDraft) => void;
}

function CanvasPane(props: CanvasPaneProps) {
  const {
    image,
    onImageChange,
    proposals,
    setProposals,
    selectedProposalId,
    setSelectedProposalId,
    onPropose,
    onClearProposals,
    isProposing,
    activeStateElements,
    onConfirmProposal,
    onCorrectionSubmit,
  } = props;

  const [tab, setTab] = useState<"capture" | "paste" | "upload">("capture");
  const [monitors, setMonitors] = useState<
    Array<{ id: number; name?: string; width: number; height: number }>
  >([]);
  const [selectedMonitor, setSelectedMonitor] = useState<number>(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [draggingState, setDraggingState] = useState<{
    draftId: string;
    corner: "nw" | "ne" | "sw" | "se";
    originX: number;
    originY: number;
    originBBox: VgaBBox;
  } | null>(null);
  const canvasBoxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Load monitor list once, on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await listMonitors();
        if (!cancelled) {
          setMonitors(m);
          if (m.length > 0 && typeof m[0]?.id === "number") {
            setSelectedMonitor(m[0].id);
          }
        }
      } catch {
        // Runner not running — capture tab just shows an error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadImageFromBlob(blob: Blob) {
    const objectUrl = URL.createObjectURL(blob);
    const base64 = await blobToBase64(blob);
    // Probe natural dimensions via a detached Image.
    const dims = await new Promise<{ w: number; h: number }>(
      (resolve, reject) => {
        const img = new window.Image();
        img.onload = () =>
          resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error("Could not decode image"));
        img.src = objectUrl;
      }
    );
    onImageChange({
      objectUrl,
      base64,
      naturalWidth: dims.w,
      naturalHeight: dims.h,
    });
  }

  async function handleCapture() {
    setIsCapturing(true);
    try {
      const blob = await captureScreenshot(selectedMonitor);
      await loadImageFromBlob(blob);
    } catch (err) {
      toast.error(`Capture failed: ${(err as Error).message}`);
    } finally {
      setIsCapturing(false);
    }
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          await loadImageFromBlob(blob);
          return;
        }
      }
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadImageFromBlob(file);
    // Reset the input so re-selecting the same file re-fires onChange.
    e.target.value = "";
  }

  // Drag-resize math. Mouse coords come in client space; convert into
  // image pixel space via the rendered box's rect.
  useEffect(() => {
    if (!draggingState) return;
    function onMove(ev: MouseEvent) {
      if (!draggingState) return;
      const box = canvasBoxRef.current;
      const img = imgRef.current;
      if (!box || !img) return;
      const rect = box.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      const px = (ev.clientX - rect.left) * scaleX;
      const py = (ev.clientY - rect.top) * scaleY;
      setProposals((prev) =>
        prev.map((p) => {
          if (p.draftId !== draggingState.draftId) return p;
          const bb = { ...draggingState.originBBox };
          const right = bb.x + bb.w;
          const bottom = bb.y + bb.h;
          if (draggingState.corner === "nw") {
            const nx = Math.min(px, right - 5);
            const ny = Math.min(py, bottom - 5);
            bb.x = Math.max(0, nx);
            bb.y = Math.max(0, ny);
            bb.w = right - bb.x;
            bb.h = bottom - bb.y;
          } else if (draggingState.corner === "ne") {
            const ny = Math.min(py, bottom - 5);
            bb.y = Math.max(0, ny);
            bb.w = Math.max(5, px - bb.x);
            bb.h = bottom - bb.y;
          } else if (draggingState.corner === "sw") {
            const nx = Math.min(px, right - 5);
            bb.x = Math.max(0, nx);
            bb.w = right - bb.x;
            bb.h = Math.max(5, py - bb.y);
          } else {
            bb.w = Math.max(5, px - bb.x);
            bb.h = Math.max(5, py - bb.y);
          }
          return { ...p, bbox: bb };
        })
      );
    }
    function onUp() {
      setDraggingState(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingState, setProposals]);

  const selectedProposal = useMemo(
    () => proposals.find((p) => p.draftId === selectedProposalId) ?? null,
    [proposals, selectedProposalId]
  );

  // rect of an element/proposal bbox as CSS positioning in the img's box.
  function bboxStyle(bbox: VgaBBox): React.CSSProperties {
    if (!image) return {};
    return {
      position: "absolute",
      left: `${(bbox.x / image.naturalWidth) * 100}%`,
      top: `${(bbox.y / image.naturalHeight) * 100}%`,
      width: `${(bbox.w / image.naturalWidth) * 100}%`,
      height: `${(bbox.h / image.naturalHeight) * 100}%`,
    };
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="border-b border-border px-3 py-2 flex items-center justify-between gap-2">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "capture" | "paste" | "upload")}
          className="inline-flex"
        >
          <TabsList>
            <TabsTrigger value="capture">
              <Camera className="size-4" /> Capture
            </TabsTrigger>
            <TabsTrigger value="paste">
              <Clipboard className="size-4" /> Paste
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="size-4" /> Upload
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {tab === "capture" && (
            <>
              <Select
                value={String(selectedMonitor)}
                onValueChange={(v) => setSelectedMonitor(Number(v))}
              >
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="Monitor" />
                </SelectTrigger>
                <SelectContent>
                  {monitors.length === 0 ? (
                    <SelectItem value="0">Monitor 0</SelectItem>
                  ) : (
                    monitors.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name ?? `Monitor ${m.id}`} ({m.width}x{m.height})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleCapture} disabled={isCapturing}>
                {isCapturing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Camera className="size-4" />
                )}
                Capture
              </Button>
            </>
          )}
          {tab === "upload" && (
            <label>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleUpload}
                className="hidden"
              />
              <Button asChild size="sm">
                <span>
                  <Upload className="size-4" /> Choose file
                </span>
              </Button>
            </label>
          )}
          <div className="w-px h-6 bg-border" />
          <Button
            size="sm"
            variant="outline"
            onClick={onPropose}
            disabled={!image || isProposing}
          >
            {isProposing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Propose elements
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onClearProposals}
            disabled={proposals.length === 0}
          >
            <X className="size-4" /> Clear
          </Button>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto bg-muted/30 p-4"
        onPaste={handlePaste}
        tabIndex={0}
      >
        {image ? (
          <div className="flex flex-col items-center gap-3">
            <div
              ref={canvasBoxRef}
              className="relative shadow-md border border-border bg-background max-w-full"
              style={{
                aspectRatio: `${image.naturalWidth} / ${image.naturalHeight}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={image.objectUrl}
                alt="Captured screenshot"
                className="w-full h-auto block select-none"
                draggable={false}
              />
              {/* Confirmed elements in active state */}
              {activeStateElements.map((el) => (
                <div
                  key={`el-${el.id}`}
                  style={bboxStyle(el.bbox)}
                  className="ring-2 ring-emerald-500/70 bg-emerald-500/15 pointer-events-none"
                  aria-label={`Saved element: ${el.label}`}
                >
                  <span className="absolute -top-5 left-0 text-[10px] px-1 rounded bg-emerald-600 text-white whitespace-nowrap">
                    {el.label}
                  </span>
                </div>
              ))}
              {/* Proposals */}
              {proposals.map((p) => {
                const selected = p.draftId === selectedProposalId;
                return (
                  <div
                    key={p.draftId}
                    style={bboxStyle(p.bbox)}
                    className={
                      "cursor-pointer transition-colors " +
                      (selected
                        ? "ring-2 ring-sky-500 bg-sky-500/30"
                        : "ring-2 ring-sky-500/60 bg-sky-500/10 hover:bg-sky-500/20")
                    }
                    onClick={() => setSelectedProposalId(p.draftId)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Proposal: ${p.label}`}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] px-1 rounded bg-sky-600 text-white whitespace-nowrap">
                      {p.editedLabel}
                    </span>
                    {selected &&
                      (["nw", "ne", "sw", "se"] as const).map((corner) => (
                        <button
                          type="button"
                          key={corner}
                          aria-label={`Resize from ${corner}`}
                          className="absolute size-3 bg-white border border-sky-600 cursor-nwse-resize"
                          style={{
                            left:
                              corner === "nw" || corner === "sw"
                                ? -6
                                : undefined,
                            right:
                              corner === "ne" || corner === "se"
                                ? -6
                                : undefined,
                            top:
                              corner === "nw" || corner === "ne"
                                ? -6
                                : undefined,
                            bottom:
                              corner === "sw" || corner === "se"
                                ? -6
                                : undefined,
                            cursor:
                              corner === "nw" || corner === "se"
                                ? "nwse-resize"
                                : "nesw-resize",
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setDraggingState({
                              draftId: p.draftId,
                              corner,
                              originX: e.clientX,
                              originY: e.clientY,
                              originBBox: p.bbox,
                            });
                          }}
                        />
                      ))}
                  </div>
                );
              })}
            </div>

            {selectedProposal && (
              <ProposalInlineEditor
                draft={selectedProposal}
                onChange={(patch) =>
                  setProposals((prev) =>
                    prev.map((p) =>
                      p.draftId === selectedProposal.draftId
                        ? { ...p, ...patch }
                        : p
                    )
                  )
                }
                onConfirm={() => {
                  onCorrectionSubmit(selectedProposal);
                  onConfirmProposal(selectedProposal);
                }}
                onReject={() => {
                  setProposals((prev) =>
                    prev.filter((p) => p.draftId !== selectedProposal.draftId)
                  );
                  setSelectedProposalId(null);
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground">
            {tab === "paste" ? (
              <span>
                Press Ctrl+V (or Cmd+V) to paste an image from the clipboard.
              </span>
            ) : tab === "upload" ? (
              <span>Choose a PNG/JPEG file to get started.</span>
            ) : (
              <span>
                Pick a monitor and hit Capture. Requires the runner to be
                running locally.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

interface ProposalInlineEditorProps {
  draft: ProposalDraft;
  onChange: (patch: Partial<ProposalDraft>) => void;
  onConfirm: () => void;
  onReject: () => void;
}

function ProposalInlineEditor({
  draft,
  onChange,
  onConfirm,
  onReject,
}: ProposalInlineEditorProps) {
  return (
    <div className="w-full max-w-3xl rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Review proposal</span>
        <Badge variant="outline">
          Confidence {Math.round((draft.confidence ?? 0) * 100)}%
        </Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="proposal-label">Label</Label>
          <Input
            id="proposal-label"
            value={draft.editedLabel}
            onChange={(e) => onChange({ editedLabel: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="proposal-prompt">Prompt</Label>
          <Input
            id="proposal-prompt"
            value={draft.editedPrompt}
            onChange={(e) => onChange({ editedPrompt: e.target.value })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag the box corners on the canvas to adjust its bounds. Confirming
        sends a correction record (so the next model sees your fix).
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onReject}>
          <X className="size-4" /> Reject
        </Button>
        <Button size="sm" onClick={onConfirm}>
          <Check className="size-4" /> Confirm and add
        </Button>
      </div>
    </div>
  );
}

// ---------------- Right pane (active state details) ----------------

interface StateDetailsPaneProps {
  state: VgaStateGraphNode | null;
  allStates: VgaStateGraphNode[];
  transitions: VgaTransitionGraph[];
  onRenameState: (stateId: string, name: string) => void;
  onSetBlocking: (stateId: string, blocking: boolean) => void;
  onDeleteState: (stateId: string) => void;
  onUpdateElement: (
    stateId: string,
    elementId: string,
    patch: Partial<VgaElementGraph>
  ) => void;
  onDeleteElement: (stateId: string, elementId: string) => void;
  onRegroundElement: (el: VgaElementGraph, stateId: string) => void;
  onAddTransition: (
    fromStateId: string,
    toStateId: string,
    triggerElementId: string
  ) => void;
  onDeleteTransition: (transitionId: string) => void;
}

function StateDetailsPane(props: StateDetailsPaneProps) {
  const {
    state,
    allStates,
    transitions,
    onRenameState,
    onSetBlocking,
    onDeleteState,
    onUpdateElement,
    onDeleteElement,
    onRegroundElement,
    onAddTransition,
    onDeleteTransition,
  } = props;

  const [addTransitionOpen, setAddTransitionOpen] = useState(false);
  const [pendingTriggerElementId, setPendingTriggerElementId] =
    useState<string>("");
  const [pendingToStateId, setPendingToStateId] = useState<string>("");
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string>("");

  if (!state) {
    return (
      <aside className="w-80 border-l border-border flex flex-col min-h-0 shrink-0 items-center justify-center text-xs text-muted-foreground p-4">
        Select a state to edit its details.
      </aside>
    );
  }

  return (
    <aside className="w-80 border-l border-border flex flex-col min-h-0 shrink-0">
      <div className="px-3 py-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="state-name-input" className="text-xs">
            State name
          </Label>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete state"
            onClick={() => onDeleteState(state.id)}
          >
            <Trash2 className="size-4 text-red-500" />
          </Button>
        </div>
        <Input
          id="state-name-input"
          value={state.name}
          onChange={(e) => onRenameState(state.id, e.target.value)}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                id="state-blocking-input"
                checked={state.blocking}
                onCheckedChange={(v) => onSetBlocking(state.id, v === true)}
              />
              <span className="text-xs">Blocking state</span>
            </label>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            This state blocks interaction with other visible states until
            it&apos;s dismissed (e.g., a modal dialog). Requires user to dismiss
            before other states can be acted on.
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2 border-b border-border">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Elements ({state.elements.length})
          </span>
        </div>
        {state.elements.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3">
            Capture a screenshot and confirm proposals to add elements.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {state.elements.map((el) => (
              <li key={el.id} className="p-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{el.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit prompt"
                      onClick={() => {
                        setEditingElementId(el.id);
                        setEditingPrompt(el.prompt);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Re-ground"
                      onClick={() => onRegroundElement(el, state.id)}
                    >
                      <RefreshCw className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete element"
                      onClick={() => onDeleteElement(state.id, el.id)}
                    >
                      <Trash2 className="size-3 text-red-500" />
                    </Button>
                  </div>
                </div>
                {editingElementId === el.id ? (
                  <div className="space-y-1.5">
                    <Input
                      value={editingPrompt}
                      onChange={(e) => setEditingPrompt(e.target.value)}
                      aria-label="Element prompt"
                    />
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingElementId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          onUpdateElement(state.id, el.id, {
                            prompt: editingPrompt,
                          });
                          setEditingElementId(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground truncate">
                    {el.prompt}
                  </p>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>
                    bbox {el.bbox.x},{el.bbox.y} · {el.bbox.w}x{el.bbox.h}
                  </span>
                  {el.correction_count !== undefined &&
                    el.correction_count > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {el.correction_count} corrections
                      </Badge>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="px-3 py-2 border-t border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Transitions ({transitions.length})
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={state.elements.length === 0 || allStates.length < 2}
            onClick={() => {
              setPendingTriggerElementId(state.elements[0]?.id ?? "");
              setPendingToStateId(
                allStates.find((s) => s.id !== state.id)?.id ?? ""
              );
              setAddTransitionOpen(true);
            }}
          >
            <Plus className="size-3" /> Add
          </Button>
        </div>

        {transitions.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3">
            No outgoing transitions.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {transitions.map((t) => {
              const trigger = state.elements.find(
                (e) => e.id === t.trigger_element_id
              );
              const target = allStates.find((s) => s.id === t.to_state_id);
              return (
                <li
                  key={t.id}
                  className="p-3 text-xs flex items-center justify-between gap-2"
                >
                  <span className="truncate">
                    When{" "}
                    <span className="font-medium">
                      {trigger?.label ?? "(deleted)"}
                    </span>{" "}
                    clicked <ChevronRight className="inline size-3" />{" "}
                    <span className="font-medium">
                      {target?.name ?? "(deleted)"}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete transition"
                    onClick={() => onDeleteTransition(t.id)}
                  >
                    <Trash2 className="size-3 text-red-500" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={addTransitionOpen} onOpenChange={setAddTransitionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add transition</DialogTitle>
            <DialogDescription>
              When the trigger element is clicked while this state is active,
              VGA runtime advances to the target state.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="trigger-element">Trigger element</Label>
              <Select
                value={pendingTriggerElementId}
                onValueChange={setPendingTriggerElementId}
              >
                <SelectTrigger id="trigger-element">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.elements.map((el) => (
                    <SelectItem key={el.id} value={el.id}>
                      {el.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target-state">Target state</Label>
              <Select
                value={pendingToStateId}
                onValueChange={setPendingToStateId}
              >
                <SelectTrigger id="target-state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allStates
                    .filter((s) => s.id !== state.id)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddTransitionOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pendingTriggerElementId || !pendingToStateId) return;
                onAddTransition(
                  state.id,
                  pendingToStateId,
                  pendingTriggerElementId
                );
                setAddTransitionOpen(false);
              }}
              disabled={!pendingTriggerElementId || !pendingToStateId}
            >
              <Plus className="size-4" /> Add transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
