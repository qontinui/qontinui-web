"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Save, FolderOpen, Trash2, FilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type {
  BuilderState,
  BuilderAction,
} from "@/lib/state-machine-builder/types";
import {
  useStateMachineConfigs,
  useSaveStateMachineConfig,
  useDeleteStateMachineConfig,
} from "@/hooks/use-state-machine-configs";

interface SaveLoadToolbarProps {
  state: BuilderState;
  dispatch: React.Dispatch<BuilderAction>;
  projectId: string | null;
}

export function SaveLoadToolbar({
  state,
  dispatch,
  projectId,
}: SaveLoadToolbarProps) {
  const configsQuery = useStateMachineConfigs(projectId);
  const saveMutation = useSaveStateMachineConfig();
  const deleteMutation = useDeleteStateMachineConfig();

  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");

  // Auto-save debounce
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string | null>(null);

  // Auto-save: debounce 5s after last change when configId exists
  useEffect(() => {
    if (!state.isDirty || !state.configId || !projectId) return;

    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      try {
        await saveMutation.mutateAsync({
          projectId,
          configId: state.configId,
          data: {
            name: state.configName,
            configuration: {
              states: state.states,
              transitions: state.transitions,
              fingerprintDetails: state.fingerprintDetails,
            },
          },
        });
        dispatch({ type: "MARK_SAVED" });
        lastSavedRef.current = new Date().toISOString();
      } catch {
        // Silent — user can manually save
      }
    }, 5000);

    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [
    state.isDirty,
    state.configId,
    state.configName,
    state.states,
    state.transitions,
    state.fingerprintDetails,
    projectId,
    saveMutation,
    dispatch,
  ]);

  const handleSave = useCallback(async () => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    const configuration = {
      states: state.states,
      transitions: state.transitions,
      fingerprintDetails: state.fingerprintDetails,
    };

    try {
      if (state.configId) {
        await saveMutation.mutateAsync({
          projectId,
          configId: state.configId,
          data: { name: state.configName, configuration },
        });
      } else {
        const result = await saveMutation.mutateAsync({
          projectId,
          data: { name: state.configName, configuration },
        });
        dispatch({ type: "SET_CONFIG_ID", configId: result.id });
      }
      dispatch({ type: "MARK_SAVED" });
      toast.success("Config saved");
    } catch {
      toast.error("Failed to save config");
    }
  }, [projectId, state, saveMutation, dispatch]);

  const handleSaveAs = useCallback(async () => {
    if (!projectId || !saveAsName.trim()) return;

    const configuration = {
      states: state.states,
      transitions: state.transitions,
      fingerprintDetails: state.fingerprintDetails,
    };

    try {
      const result = await saveMutation.mutateAsync({
        projectId,
        data: { name: saveAsName.trim(), configuration },
      });
      dispatch({ type: "SET_CONFIG_ID", configId: result.id });
      dispatch({ type: "SET_CONFIG_NAME", name: saveAsName.trim() });
      dispatch({ type: "MARK_SAVED" });
      setSaveAsDialogOpen(false);
      toast.success(`Saved as "${saveAsName.trim()}"`);
    } catch {
      toast.error("Failed to save config");
    }
  }, [projectId, saveAsName, state, saveMutation, dispatch]);

  const handleLoad = useCallback(
    async (configId: string) => {
      if (!projectId) return;

      if (state.isDirty) {
        if (
          !window.confirm(
            "You have unsaved changes. Loading will discard them. Continue?"
          )
        ) {
          return;
        }
      }

      try {
        const config = await configsQuery.data?.configs.find(
          (c) => c.id === configId
        );
        if (!config) return;

        // Fetch the full config (list only has summaries)
        const { stateMachineConfigService } =
          await import("@/services/service-factory");
        const full = await stateMachineConfigService.get(projectId, configId);

        dispatch({
          type: "LOAD_CONFIG",
          config: {
            name: full.name,
            version: full.version,
            exportedAt: full.updated_at,
            source: "state-discovery",
            metadata: {},
            states: full.configuration.states as never[],
            transitions: full.configuration.transitions as never[],
            fingerprintDetails: full.configuration.fingerprintDetails as never,
          },
        });
        dispatch({ type: "SET_CONFIG_ID", configId: full.id });
        dispatch({ type: "MARK_SAVED" });
        setLoadDialogOpen(false);
        toast.success(`Loaded "${full.name}"`);
      } catch {
        toast.error("Failed to load config");
      }
    },
    [projectId, state.isDirty, configsQuery.data, dispatch]
  );

  const handleDelete = useCallback(
    async (configId: string, name: string) => {
      if (!projectId) return;
      if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;

      try {
        await deleteMutation.mutateAsync({ projectId, configId });
        if (state.configId === configId) {
          dispatch({ type: "SET_CONFIG_ID", configId: null });
        }
        toast.success(`Deleted "${name}"`);
      } catch {
        toast.error("Failed to delete config");
      }
    },
    [projectId, state.configId, deleteMutation, dispatch]
  );

  if (!projectId) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 gap-1.5">
            <Save className="size-4" />
            <span className="text-xs">Save</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            <Save className="size-4 mr-2" />
            {state.configId ? "Save" : "Save New"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setSaveAsName(state.configName);
              setSaveAsDialogOpen(true);
            }}
          >
            <FilePlus className="size-4 mr-2" />
            Save As...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              configsQuery.refetch();
              setLoadDialogOpen(true);
            }}
          >
            <FolderOpen className="size-4 mr-2" />
            Load...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save As Dialog */}
      <Dialog open={saveAsDialogOpen} onOpenChange={setSaveAsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save As</DialogTitle>
            <DialogDescription>
              Enter a name for the new config.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder="Config name..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveAs();
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveAsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAs}
              disabled={!saveAsName.trim() || saveMutation.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Load Config</DialogTitle>
            <DialogDescription>
              Select a saved state machine configuration.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[300px]">
            {configsQuery.isLoading && (
              <p className="text-sm text-text-muted p-4">Loading...</p>
            )}
            {configsQuery.data?.configs.length === 0 && (
              <p className="text-sm text-text-muted p-4">No saved configs.</p>
            )}
            <div className="space-y-1 p-1">
              {configsQuery.data?.configs.map((cfg) => (
                <div
                  key={cfg.id}
                  className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-surface-raised/50 transition-colors group"
                >
                  <button
                    className="flex-1 text-left"
                    onClick={() => handleLoad(cfg.id)}
                  >
                    <div className="text-sm font-medium text-text-primary">
                      {cfg.name}
                    </div>
                    {cfg.description && (
                      <div className="text-xs text-text-muted truncate">
                        {cfg.description}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-text-muted">
                        {new Date(cfg.updated_at).toLocaleDateString()}
                      </span>
                      {cfg.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-[9px] px-1 py-0"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(cfg.id, cfg.name);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
