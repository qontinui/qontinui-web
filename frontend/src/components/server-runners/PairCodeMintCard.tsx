"use client";

/**
 * PairCodeMintCard — generate a single-use 5-minute pair code for a
 * runner.
 *
 * Phase 2a.2 of plan
 * `D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md`.
 *
 * Sits above `RunnerTokenList` on the Auth Tokens tab. Pair codes are
 * the recommended path for new operators; long-lived runner tokens
 * (the existing UI) remain available as the advanced/CI fallback.
 *
 * Flow:
 * 1. Operator clicks "Generate one-time pair code".
 * 2. POST `/api/v1/devices/pair-codes` returns `{code, expiresAt}`.
 * 3. The code displays in a large monospace block with a countdown.
 * 4. Operator types the code into the runner's Settings → Connection
 *    pair-code field.
 * 5. Runner POSTs to `/api/v1/devices/pair-codes/{code}/redeem` and
 *    receives a device JWT.
 *
 * After expiry or on a fresh click, the displayed code is replaced.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Sparkles, Timer } from "lucide-react";
import { mintPairCode, type PairCodeMintResponse } from "@/lib/api/pair_codes";

interface State {
  status: "idle" | "minting" | "active" | "expired" | "error";
  mint: PairCodeMintResponse | null;
  errorMessage: string | null;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PairCodeMintCard() {
  const [state, setState] = useState<State>({
    status: "idle",
    mint: null,
    errorMessage: null,
  });
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick the clock so the countdown re-renders every second while a
  // code is active. A single 1-Hz interval is cheap; we tear it down
  // on unmount + when the state moves out of `active`.
  useEffect(() => {
    if (state.status !== "active") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const expiresAtMs = useMemo(() => {
    if (!state.mint) return null;
    const parsed = Date.parse(state.mint.expiresAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [state.mint]);

  const remainingSeconds = useMemo(() => {
    if (!expiresAtMs) return 0;
    return Math.max(0, Math.floor((expiresAtMs - now) / 1000));
  }, [expiresAtMs, now]);

  // Auto-flip to `expired` once the countdown reaches zero.
  useEffect(() => {
    if (state.status === "active" && remainingSeconds === 0) {
      setState((prev) => ({ ...prev, status: "expired" }));
    }
  }, [state.status, remainingSeconds]);

  const handleGenerate = useCallback(async () => {
    setState({ status: "minting", mint: null, errorMessage: null });
    try {
      const mint = await mintPairCode();
      setState({ status: "active", mint, errorMessage: null });
      setNow(Date.now());
    } catch (err) {
      setState({
        status: "error",
        mint: null,
        errorMessage:
          err instanceof Error ? err.message : "Failed to mint pair code.",
      });
    }
  }, []);

  return (
    <Card className="bg-surface-raised border-border-subtle">
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div>
          <h3 className="text-sm font-semibold text-white">
            One-time pair code
          </h3>
          <p className="text-xs text-text-muted">
            Paste this code into your runner&apos;s Settings to pair a new
            device.
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={state.status === "minting"}
          size="sm"
          className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          data-testid="pair-code-generate-button"
        >
          {state.status === "minting" ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 mr-1.5" />
          )}
          {state.mint ? "Generate new code" : "Generate one-time pair code"}
        </Button>
      </div>

      <div className="p-6">
        {state.status === "idle" && (
          <div className="text-center text-sm text-text-muted py-6">
            Click <em>Generate one-time pair code</em> to mint a 6-character
            code with a 5-minute window for pairing.
          </div>
        )}

        {state.status === "error" && (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-red-400">
              {state.errorMessage ?? "Failed to mint pair code."}
            </p>
            <Button variant="outline" size="sm" onClick={handleGenerate}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try again
            </Button>
          </div>
        )}

        {(state.status === "active" || state.status === "expired") &&
          state.mint && (
            <div className="flex flex-col items-center gap-3 py-2">
              <div
                className={`font-mono text-5xl tracking-[0.35em] font-bold select-all ${
                  state.status === "expired"
                    ? "text-text-muted line-through"
                    : "text-white"
                }`}
                aria-label="One-time pair code"
                data-testid="pair-code-value"
              >
                {state.mint.code}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Timer className="w-3.5 h-3.5" />
                {state.status === "expired" ? (
                  <span>Expired — click <em>Generate new code</em>.</span>
                ) : (
                  <span>
                    Expires in{" "}
                    <span
                      className="font-mono font-medium text-white"
                      data-testid="pair-code-countdown"
                    >
                      {formatRemaining(remainingSeconds)}
                    </span>
                  </span>
                )}
              </div>
              {state.status === "active" && (
                <p className="text-xs text-text-muted text-center max-w-md">
                  Type this code into your runner&apos;s Settings →
                  Connection pair-code field. The code is single-use and
                  expires in 5 minutes.
                </p>
              )}
            </div>
          )}
      </div>
    </Card>
  );
}
