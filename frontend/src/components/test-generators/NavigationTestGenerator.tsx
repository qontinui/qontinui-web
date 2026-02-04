/**
 * NavigationTestGenerator
 *
 * Main component for the Navigation Test Generator page (Tier 2).
 * Provides 4 tabs: Explore, State Graph, Test Specs, Output.
 *
 * Uses UI Bridge exploration to discover states and transitions,
 * then generates cross-page test specifications.
 */

import { useState, useCallback, useMemo } from "react";
import { Compass, GitBranch, TestTube2, FileOutput } from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { ExplorationSourceSelector } from "./navigation/ExplorationSourceSelector";
import { StateGraphPanel } from "./navigation/StateGraphPanel";
import { TestSpecEditor } from "./shared/TestSpecEditor";
import { TestOutputPanel } from "./shared/TestOutputPanel";
import { generateNavigationTestSpecs, type SnapshotData } from "./shared/spec-generators";
import type {
  NonVisualState,
  NonVisualTransition,
  TestSpecification,
  TestGeneratorOutput,
} from "./types";

type Tab = "explore" | "graph" | "specs" | "output";

interface NavigationTestGeneratorProps {
  runnerUrl?: string;
}

export function NavigationTestGenerator({
  runnerUrl = "http://localhost:9876",
}: NavigationTestGeneratorProps) {
  // Persisted state (survives navigation)
  const [activeTab, setActiveTab] = useLocalStorage<Tab>("ntg:activeTab", "explore");
  const [targetUrl, setTargetUrl] = useLocalStorage("ntg:targetUrl", "");
  const [maxDepth, setMaxDepth] = useLocalStorage("ntg:maxDepth", 3);
  const [maxElements, setMaxElements] = useLocalStorage("ntg:maxElements", 50);
  const [states, setStates] = useLocalStorage<NonVisualState[]>("ntg:states", []);
  const [transitions, setTransitions] = useLocalStorage<NonVisualTransition[]>("ntg:transitions", []);
  const [specs, setSpecs] = useLocalStorage<TestSpecification[]>("ntg:specs", []);

  // Transient state (reset on navigation)
  const [isExploring, setIsExploring] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [snapshotsByState] = useState<Map<string, SnapshotData>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{
    status: string;
    elementsFound: number;
    statesFound: number;
  } | null>(null);
  const [sessions] = useState<Array<{
    id: string;
    name: string;
    targetUrl: string;
    statesFound: number;
    createdAt: string;
  }>>([]);

  // Start new exploration
  const handleStartExploration = useCallback(async () => {
    if (!targetUrl) return;
    setIsExploring(true);
    setProgress({ status: "Starting exploration...", elementsFound: 0, statesFound: 0 });

    try {
      // Start exploration via UI Bridge
      // API expects: connection_url, target_type, max_depth, max_elements_per_page, etc.
      const res = await fetch(`${runnerUrl}/ui-bridge/explore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_url: targetUrl,
          target_type: "web",
          max_depth: maxDepth,
          max_elements_per_page: Math.min(maxElements, 50),
          max_total_elements: maxElements,
        }),
      });

      if (!res.ok) throw new Error("Failed to start exploration");

      // Poll for results
      let explorationDone = false;
      while (!explorationDone) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`${runnerUrl}/ui-bridge/explore/status`);
        if (!statusRes.ok) continue;
        const status = await statusRes.json();

        setProgress({
          status: status.status || "Exploring...",
          elementsFound: status.elements_found || 0,
          statesFound: status.states_found || 0,
        });

        if (status.status === "completed" || status.status === "failed") {
          explorationDone = true;
        }
      }

      // Get results
      const resultsRes = await fetch(`${runnerUrl}/ui-bridge/explore/results`);
      if (resultsRes.ok) {
        const results = await resultsRes.json();

        // Convert to NonVisualState[]
        const discoveredStates: NonVisualState[] = (results.states || []).map(
          (s: Record<string, unknown>, i: number) => ({
            id: (s.id as string) || `state-${i}`,
            name: (s.name as string) || `State ${i + 1}`,
            description: (s.description as string) || "",
            elementIds: (s.elementIds as string[]) || (s.element_ids as string[]) || [],
            pageUrl: s.pageUrl as string | undefined || s.page_url as string | undefined,
            pageTitle: s.pageTitle as string | undefined || s.page_title as string | undefined,
            confidence: (s.confidence as number) || 0.5,
          }),
        );

        const discoveredTransitions: NonVisualTransition[] = (results.transitions || []).map(
          (t: Record<string, unknown>, i: number) => ({
            id: (t.id as string) || `transition-${i}`,
            triggerElementId: (t.triggerElementId as string) || (t.trigger_element_id as string) || "",
            triggerLabel: (t.triggerLabel as string | undefined) || (t.trigger_label as string | undefined),
            triggerAction: ((t.triggerAction as string) || (t.trigger_action as string) || "click") as NonVisualTransition["triggerAction"],
            fromStateId: (t.fromStateId as string) || (t.from_state_id as string) || "",
            toStateId: (t.toStateId as string) || (t.to_state_id as string) || "",
            confidence: (t.confidence as number) || 0.5,
          }),
        );

        setStates(discoveredStates);
        setTransitions(discoveredTransitions);
        setActiveTab("graph");
      }
    } catch (err) {
      console.error("Exploration failed:", err);
      setProgress({ status: "Exploration failed", elementsFound: 0, statesFound: 0 });
    } finally {
      setIsExploring(false);
    }
  }, [runnerUrl, targetUrl, maxDepth, maxElements]);

  // Load previous session
  const handleLoadSession = useCallback(async (sessionId: string) => {
    setIsLoadingSession(true);
    try {
      // Would load from backend API
      console.log("Loading session:", sessionId);
    } finally {
      setIsLoadingSession(false);
    }
  }, []);

  // Generate specs
  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    const generated = generateNavigationTestSpecs(states, transitions, snapshotsByState);
    setSpecs(generated);
    setIsGenerating(false);
    setActiveTab("specs");
  }, [states, transitions, snapshotsByState]);

  // Update state
  const handleUpdateState = useCallback((updated: NonVisualState) => {
    setStates((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  // Build output
  const output: TestGeneratorOutput | null = useMemo(() => {
    if (specs.length === 0) return null;
    const now = new Date().toISOString();
    return {
      version: "1.0.0",
      projectId: "",
      generatorType: "navigation",
      states,
      transitions,
      testSpecifications: specs,
      explorationMetadata: {
        explorationId: `exploration-${Date.now()}`,
        targetUrl: targetUrl || states[0]?.pageUrl || "",
        statesDiscovered: states.length,
        transitionsDiscovered: transitions.length,
        exploredAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
  }, [specs, states, transitions, targetUrl]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "explore", label: "Explore", icon: <Compass className="w-4 h-4" /> },
    { id: "graph", label: "State Graph", icon: <GitBranch className="w-4 h-4" /> },
    { id: "specs", label: "Test Specs", icon: <TestTube2 className="w-4 h-4" /> },
    { id: "output", label: "Output", icon: <FileOutput className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-100">Navigation Test Generator</h2>
        <span className="px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full font-medium">
          beta
        </span>
      </div>

      {/* Source selector */}
      <ExplorationSourceSelector
        sessions={sessions}
        onNewExploration={() => setActiveTab("explore")}
        onLoadSession={handleLoadSession}
        isLoading={isLoadingSession}
      />

      {/* Tabs */}
      <div className="flex border-b border-neutral-700 bg-neutral-800/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? "text-emerald-400 border-emerald-400 bg-neutral-900/50"
                : "text-neutral-400 border-transparent hover:text-neutral-200 hover:bg-neutral-700/30"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "graph" && states.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded">
                {states.length}
              </span>
            )}
            {tab.id === "specs" && specs.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded">
                {specs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "explore" ? (
          <div className="h-full overflow-auto p-4 space-y-4">
            {/* Exploration config */}
            <div className="space-y-3 p-4 bg-neutral-800/50 rounded-lg border border-neutral-700">
              <h3 className="text-sm font-medium text-neutral-200">Exploration Configuration</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Target URL</label>
                  <input
                    type="text"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="http://localhost:3000"
                    className="w-full px-3 py-1.5 text-sm bg-neutral-900 border border-neutral-600 rounded-md text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Max Depth</label>
                  <input
                    type="number"
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(Number(e.target.value))}
                    min={1}
                    max={10}
                    className="w-full px-3 py-1.5 text-sm bg-neutral-900 border border-neutral-600 rounded-md text-neutral-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Max Elements</label>
                  <input
                    type="number"
                    value={maxElements}
                    onChange={(e) => setMaxElements(Number(e.target.value))}
                    min={10}
                    max={500}
                    className="w-full px-3 py-1.5 text-sm bg-neutral-900 border border-neutral-600 rounded-md text-neutral-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <button
                onClick={handleStartExploration}
                disabled={isExploring || !targetUrl}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <Compass className="w-4 h-4" />
                {isExploring ? "Exploring..." : "Start Exploration"}
              </button>
            </div>

            {/* Progress */}
            {progress && (
              <div className="p-4 bg-neutral-800/50 rounded-lg border border-neutral-700">
                <p className="text-sm text-neutral-200">{progress.status}</p>
                <div className="flex gap-4 mt-2 text-xs text-neutral-400">
                  <span>Elements: {progress.elementsFound}</span>
                  <span>States: {progress.statesFound}</span>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === "graph" ? (
          <StateGraphPanel
            states={states}
            transitions={transitions}
            onUpdateState={handleUpdateState}
          />
        ) : activeTab === "specs" ? (
          <TestSpecEditor
            specs={specs}
            onSpecsChange={setSpecs}
            onGenerate={handleGenerate}
            generateLabel="Generate All"
            isGenerating={isGenerating}
          />
        ) : (
          <TestOutputPanel output={output} />
        )}
      </div>
    </div>
  );
}
