import { useState, useEffect, useMemo, useRef } from "react";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import type { WorkflowPhase } from "../execution-timeline-types";
import { PHASE_ORDER } from "../execution-timeline-types";
import {
  transformSteps,
  buildPhaseGroups,
  calculateStats,
  mapPhase,
} from "../execution-timeline-utils";

export function useExecutionTimeline() {
  const { data: response, isLoading } = useSharedStepsData();

  // Elapsed time tracking
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Iteration expansion tracking
  const [expandedIterations, setExpandedIterations] = useState<Set<string>>(
    new Set()
  );
  const prevIterationCounts = useRef<Map<string, number>>(new Map());

  // Transform API data into timeline steps
  const allSteps = useMemo(() => {
    if (!response?.executions) return [];
    return transformSteps(response.executions, response.current_stage);
  }, [response]);

  // Set start time from workflow_start_time or earliest step
  useEffect(() => {
    if (startTime) return;
    if (response?.workflow_start_time) {
      const ms = new Date(response.workflow_start_time).getTime();
      if (!isNaN(ms)) {
        setStartTime(ms);
        return;
      }
    }
    if (allSteps.length > 0) {
      const earliest = Math.min(
        ...allSteps.filter((s) => s.startTime).map((s) => s.startTime!)
      );
      if (earliest && earliest !== Infinity) setStartTime(earliest);
    }
  }, [response, allSteps, startTime]);

  // Update elapsed time
  useEffect(() => {
    if (!startTime) {
      setElapsedTime(0);
      return;
    }
    const update = () =>
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Detect current phase
  const currentPhase = useMemo((): WorkflowPhase | null => {
    if (response?.current_stage) return mapPhase(response.current_stage);
    const running = allSteps.find((s) => s.status === "running");
    if (running) return running.phase;
    for (const phase of PHASE_ORDER) {
      if (
        allSteps.some(
          (s) =>
            s.phase === phase &&
            (s.status === "pending" || s.status === "running")
        )
      )
        return phase;
    }
    return null;
  }, [allSteps, response]);

  // Build phase groups (with multi-stage awareness)
  const totalStages = response?.total_stages;
  const currentStageIndex = response?.current_stage_index;
  const phaseGroups = useMemo(
    () =>
      buildPhaseGroups(allSteps, currentPhase, totalStages, currentStageIndex),
    [allSteps, currentPhase, totalStages, currentStageIndex]
  );

  // Calculate stats
  const stats = useMemo(
    () => calculateStats(phaseGroups, elapsedTime),
    [phaseGroups, elapsedTime]
  );

  // Step stats
  const stepStats = useMemo(() => {
    const total = allSteps.length;
    const completed = allSteps.filter(
      (s) => s.status === "success" || s.status === "failed"
    ).length;
    const successful = allSteps.filter((s) => s.status === "success").length;
    const failed = allSteps.filter((s) => s.status === "failed").length;
    return { total, completed, successful, failed };
  }, [allSteps]);

  // Auto-expand latest iteration
  useEffect(() => {
    setExpandedIterations((prevExpanded) => {
      const newSet = new Set<string>();
      for (const group of phaseGroups) {
        if (!group.hasIterations || group.iterationGroups.length === 0)
          continue;
        const compositeKey = `${group.stageIndex}:${group.phase}`;
        const prevCount = prevIterationCounts.current.get(compositeKey) ?? 0;
        const currentCount = group.iterationGroups.length;
        const maxIter = Math.max(
          ...group.iterationGroups.map((g) => g.iteration)
        );
        if (currentCount > prevCount) {
          newSet.add(`${group.phase}-${maxIter}`);
        } else {
          for (const iterGroup of group.iterationGroups) {
            const key = `${group.phase}-${iterGroup.iteration}`;
            if (prevExpanded.has(key)) newSet.add(key);
          }
          const phaseHasExpanded = group.iterationGroups.some((g) =>
            newSet.has(`${group.phase}-${g.iteration}`)
          );
          if (!phaseHasExpanded) newSet.add(`${group.phase}-${maxIter}`);
        }
        prevIterationCounts.current.set(compositeKey, currentCount);
      }
      return newSet;
    });
  }, [phaseGroups]);

  return {
    response,
    isLoading,
    currentPhase,
    phaseGroups,
    stats,
    stepStats,
    expandedIterations,
  };
}
