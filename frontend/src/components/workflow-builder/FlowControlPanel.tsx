"use client";

import React from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Gauge, Timer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// =============================================================================
// Types matching the Rust backend structs (flow_control.rs / state.rs)
// =============================================================================

interface ConcurrencyLimit {
  limit: number;
  key?: string | null;
}

interface ThrottleConfig {
  limit: number;
  period_seconds: number;
  key?: string | null;
}

interface RateLimitConfig {
  limit: number;
  period_seconds: number;
  key?: string | null;
}

interface DebounceConfig {
  window_ms: number;
  key?: string | null;
}

interface FlowControl {
  concurrency?: ConcurrencyLimit | null;
  throttle?: ThrottleConfig | null;
  debounce?: DebounceConfig | null;
  rate_limit?: RateLimitConfig | null;
}

interface PhaseTimeouts {
  setup_ms?: number | null;
  execution_ms?: number | null;
  verification_ms?: number | null;
  ai_verification_ms?: number | null;
  completion_ms?: number | null;
}

// =============================================================================
// Constants
// =============================================================================

const PERIOD_OPTIONS = [
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
];

const DEBOUNCE_PRESETS = [
  { label: "500ms", value: 500 },
  { label: "1s", value: 1000 },
  { label: "2s", value: 2000 },
  { label: "5s", value: 5000 },
];

const PHASE_TIMEOUT_FIELDS: {
  key: keyof PhaseTimeouts;
  label: string;
}[] = [
  { key: "setup_ms", label: "Setup" },
  { key: "execution_ms", label: "Execution" },
  { key: "verification_ms", label: "Verification" },
  { key: "ai_verification_ms", label: "AI Verification" },
  { key: "completion_ms", label: "Completion" },
];

const SELECT_CLASS =
  "w-full h-9 px-3 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-600";

// =============================================================================
// Helpers
// =============================================================================

function parseJson<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function serializeOrNull<T extends object>(value: T): string | null {
  // If every value is null/undefined, treat as empty
  const hasValue = Object.values(value).some(
    (v) => v !== null && v !== undefined
  );
  return hasValue ? JSON.stringify(value) : null;
}

/** Convert minutes to ms, returning null for empty/0 */
function minutesToMs(minutes: string): number | null {
  const n = parseFloat(minutes);
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 60 * 1000);
}

/** Convert ms to minutes string for display */
function msToMinutes(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "";
  return String(Math.round((ms / 60000) * 100) / 100);
}

// =============================================================================
// Props
// =============================================================================

interface FlowControlPanelProps {
  flowControlJson: string | null;
  phaseTimeoutsJson: string | null;
  onFlowControlChange: (json: string | null) => void;
  onPhaseTimeoutsChange: (json: string | null) => void;
}

// =============================================================================
// Component
// =============================================================================

export function FlowControlPanel({
  flowControlJson,
  phaseTimeoutsJson,
  onFlowControlChange,
  onPhaseTimeoutsChange,
}: FlowControlPanelProps) {
  const [isFlowOpen, setIsFlowOpen] = React.useState(false);
  const [isTimeoutsOpen, setIsTimeoutsOpen] = React.useState(false);

  // Parse initial values
  const flowControl = React.useMemo(
    () => parseJson<FlowControl>(flowControlJson) ?? {},
    [flowControlJson]
  );

  const phaseTimeouts = React.useMemo(
    () => parseJson<PhaseTimeouts>(phaseTimeoutsJson) ?? {},
    [phaseTimeoutsJson]
  );

  // ------ Flow Control updaters ------

  function updateFlowControl(updates: Partial<FlowControl>) {
    const next = { ...flowControl, ...updates };
    onFlowControlChange(serializeOrNull(next));
  }

  function updateConcurrency(patch: Partial<ConcurrencyLimit> | null) {
    if (patch === null) {
      updateFlowControl({ concurrency: null });
      return;
    }
    const prev = flowControl.concurrency ?? { limit: 1 };
    updateFlowControl({ concurrency: { ...prev, ...patch } });
  }

  function updateThrottle(patch: Partial<ThrottleConfig> | null) {
    if (patch === null) {
      updateFlowControl({ throttle: null });
      return;
    }
    const prev = flowControl.throttle ?? { limit: 5, period_seconds: 60 };
    updateFlowControl({ throttle: { ...prev, ...patch } });
  }

  function updateRateLimit(patch: Partial<RateLimitConfig> | null) {
    if (patch === null) {
      updateFlowControl({ rate_limit: null });
      return;
    }
    const prev = flowControl.rate_limit ?? { limit: 10, period_seconds: 60 };
    updateFlowControl({ rate_limit: { ...prev, ...patch } });
  }

  function updateDebounce(patch: Partial<DebounceConfig> | null) {
    if (patch === null) {
      updateFlowControl({ debounce: null });
      return;
    }
    const prev = flowControl.debounce ?? { window_ms: 1000 };
    updateFlowControl({ debounce: { ...prev, ...patch } });
  }

  // ------ Phase Timeouts updater ------

  function updatePhaseTimeout(key: keyof PhaseTimeouts, minutes: string) {
    const ms = minutesToMs(minutes);
    const next = { ...phaseTimeouts, [key]: ms };
    onPhaseTimeoutsChange(serializeOrNull(next));
  }

  // ------ Render ------

  return (
    <div className="space-y-2">
      {/* ========== Flow Control Section ========== */}
      <Collapsible open={isFlowOpen} onOpenChange={setIsFlowOpen}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
          <CollapsibleTrigger asChild>
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
              {isFlowOpen ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
              <Gauge className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-300">
                Flow Control
              </span>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-3 pb-3 space-y-4">
              {/* Concurrency */}
              <fieldset className="space-y-2 rounded-md border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Concurrency Limit
                  </Label>
                  <ToggleChip
                    active={flowControl.concurrency != null}
                    onToggle={(on) =>
                      on
                        ? updateConcurrency({ limit: 1 })
                        : updateConcurrency(null)
                    }
                  />
                </div>
                {flowControl.concurrency != null && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Max concurrent</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={flowControl.concurrency.limit}
                        onChange={(e) =>
                          updateConcurrency({
                            limit: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)),
                          })
                        }
                        className="h-8 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Scope key (optional)</Label>
                      <Input
                        type="text"
                        placeholder="e.g. repo_path"
                        value={flowControl.concurrency.key ?? ""}
                        onChange={(e) =>
                          updateConcurrency({
                            key: e.target.value || null,
                          })
                        }
                        className="h-8 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      />
                    </div>
                  </div>
                )}
              </fieldset>

              {/* Throttle */}
              <fieldset className="space-y-2 rounded-md border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Throttle
                  </Label>
                  <ToggleChip
                    active={flowControl.throttle != null}
                    onToggle={(on) =>
                      on
                        ? updateThrottle({ limit: 5, period_seconds: 60 })
                        : updateThrottle(null)
                    }
                  />
                </div>
                {flowControl.throttle != null && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Limit</Label>
                      <Input
                        type="number"
                        min={1}
                        value={flowControl.throttle.limit}
                        onChange={(e) =>
                          updateThrottle({
                            limit: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="h-8 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Period</Label>
                      <select
                        className={SELECT_CLASS}
                        value={flowControl.throttle.period_seconds}
                        onChange={(e) =>
                          updateThrottle({
                            period_seconds: parseInt(e.target.value),
                          })
                        }
                      >
                        {PERIOD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </fieldset>

              {/* Rate Limit */}
              <fieldset className="space-y-2 rounded-md border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Rate Limit
                  </Label>
                  <ToggleChip
                    active={flowControl.rate_limit != null}
                    onToggle={(on) =>
                      on
                        ? updateRateLimit({ limit: 10, period_seconds: 60 })
                        : updateRateLimit(null)
                    }
                  />
                </div>
                {flowControl.rate_limit != null && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Limit</Label>
                      <Input
                        type="number"
                        min={1}
                        value={flowControl.rate_limit.limit}
                        onChange={(e) =>
                          updateRateLimit({
                            limit: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="h-8 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">Period</Label>
                      <select
                        className={SELECT_CLASS}
                        value={flowControl.rate_limit.period_seconds}
                        onChange={(e) =>
                          updateRateLimit({
                            period_seconds: parseInt(e.target.value),
                          })
                        }
                      >
                        {PERIOD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </fieldset>

              {/* Debounce */}
              <fieldset className="space-y-2 rounded-md border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Debounce
                  </Label>
                  <ToggleChip
                    active={flowControl.debounce != null}
                    onToggle={(on) =>
                      on
                        ? updateDebounce({ window_ms: 1000 })
                        : updateDebounce(null)
                    }
                  />
                </div>
                {flowControl.debounce != null && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {DEBOUNCE_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                            flowControl.debounce?.window_ms === preset.value
                              ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
                          }`}
                          onClick={() =>
                            updateDebounce({ window_ms: preset.value })
                          }
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-zinc-400">
                        Window (ms)
                      </Label>
                      <Input
                        type="number"
                        min={100}
                        step={100}
                        value={flowControl.debounce.window_ms}
                        onChange={(e) =>
                          updateDebounce({
                            window_ms: Math.max(
                              100,
                              parseInt(e.target.value) || 1000
                            ),
                          })
                        }
                        className="h-8 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      />
                    </div>
                  </div>
                )}
              </fieldset>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* ========== Phase Timeouts Section ========== */}
      <Collapsible open={isTimeoutsOpen} onOpenChange={setIsTimeoutsOpen}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
          <CollapsibleTrigger asChild>
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
              {isTimeoutsOpen ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
              <Timer className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-300">
                Phase Timeouts
              </span>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-zinc-500">
                Set per-phase time limits in minutes. Leave empty for no limit.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {PHASE_TIMEOUT_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs text-zinc-400">
                      {field.label}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="No limit"
                      value={msToMinutes(phaseTimeouts[field.key])}
                      onChange={(e) =>
                        updatePhaseTimeout(field.key, e.target.value)
                      }
                      className="h-8 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

// =============================================================================
// Small helper: toggle chip (on/off pill)
// =============================================================================

function ToggleChip({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!active)}
      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700"
          : "bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-400"
      }`}
    >
      {active ? "On" : "Off"}
    </button>
  );
}
