import { useEffect, useState } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { State } from "@/contexts/automation-context/types";
import { toast } from "sonner";

export function usePlayback(
  selectedWorkflow: Workflow | undefined,
  selectedWorkflowId: string | null,
  states: State[]
) {
  const [currentActionIndex, setCurrentActionIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1000);
  const [activeStateIds, setActiveStateIds] = useState<string[]>([]);
  const [assumeSuccess, setAssumeSuccess] = useState<boolean>(true);

  const getInitialStateIds = () => {
    if (!selectedWorkflow) return [];
    let initialStateIds = selectedWorkflow.initialStateIds || [];
    if (initialStateIds.length === 0) {
      initialStateIds = states
        .filter((s) => s.initial === true)
        .map((s) => s.id);
    }
    return initialStateIds;
  };

  // Initialize active states when workflow is selected
  useEffect(() => {
    if (selectedWorkflow) {
      setActiveStateIds(getInitialStateIds());
      setCurrentActionIndex(0);
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowId, states]);

  const updateActiveStates = (actionIndex: number, _success?: boolean) => {
    if (!selectedWorkflow) return;

    const action = selectedWorkflow.actions[actionIndex];
    if (!action) return;

    if ((action.type as string) === "STATE_ACTIVATOR" && action.config) {
      const config = action.config as Record<string, unknown>;
      const stateIds = (config.stateIds as string[]) || [];
      setActiveStateIds((prev) => {
        const newIds = [...prev];
        stateIds.forEach((id: string) => {
          if (!newIds.includes(id)) {
            newIds.push(id);
          }
        });
        return newIds;
      });
    }
  };

  const handleStepForward = () => {
    if (!selectedWorkflow) return;

    const nextIndex = currentActionIndex + 1;
    if (nextIndex >= selectedWorkflow.actions.length) {
      setIsPlaying(false);
      toast.info("Reached end of workflow");
      return;
    }

    setCurrentActionIndex(nextIndex);
    updateActiveStates(nextIndex, assumeSuccess);
  };

  const handleStepBack = () => {
    if (currentActionIndex > 0) {
      const prevIndex = currentActionIndex - 1;
      setCurrentActionIndex(prevIndex);
      updateActiveStates(prevIndex, assumeSuccess);
    }
  };

  const handleReset = () => {
    setCurrentActionIndex(0);
    setIsPlaying(false);
    if (selectedWorkflow) {
      setActiveStateIds(getInitialStateIds());
    }
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleActionSelect = (actionIndex: number, success: boolean) => {
    setCurrentActionIndex(actionIndex);
    setAssumeSuccess(success);
    updateActiveStates(actionIndex, success);
  };

  const handleSliderChange = (value: number) => {
    setCurrentActionIndex(value);
    updateActiveStates(value, assumeSuccess);
  };

  // Playback timer
  useEffect(() => {
    if (!isPlaying || !selectedWorkflow) return;

    const timer = setTimeout(() => {
      handleStepForward();
    }, playbackSpeed);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentActionIndex, playbackSpeed, selectedWorkflow]);

  return {
    currentActionIndex,
    isPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    activeStateIds,
    assumeSuccess,
    setAssumeSuccess,
    setIsPlaying,
    handleStepForward,
    handleStepBack,
    handleReset,
    handlePlayPause,
    handleActionSelect,
    handleSliderChange,
  };
}
