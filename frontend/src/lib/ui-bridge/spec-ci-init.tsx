"use client";

/**
 * Spec-CI runtime exposure.
 *
 * Mounts a tiny side-effect that exposes `window.__qontinuiSpecCi__` —
 * the surface the Playwright-driven Spec CI executor (frontend/tests/
 * spec-ci/run-spec-ci.ts) calls into to walk IR transitions in the live
 * page's DOM. The structure is intentionally minimal:
 *
 *   __qontinuiSpecCi__ = {
 *     adaptIRDocumentToWorkflowConfig,    // IR -> runtime config
 *     StateMachine, StateDetector,        // runtime primitives
 *     executeTransition,                  // walks one transition
 *     findFirst, matchesQuery,            // matcher
 *     getRegistry(),                      // wraps UI Bridge's global
 *                                         // registry as a RegistryLike
 *     getActionExecutor(),                // wraps the bridge's HTTP
 *                                         // action surface as an
 *                                         // ActionExecutorLike
 *   }
 *
 * The exposure is gated on `NEXT_PUBLIC_ENABLE_SPEC_CI === "1"`, so
 * production builds (where the env var isn't set) get nothing on the
 * window. CI sets the var; dev sets it via `.env.local` when iterating
 * on a spec.
 *
 * Shape compatibility note: `@qontinui/ui-bridge`'s `RegisteredElement`
 * is structurally identical to `@qontinui/ui-bridge-auto`'s
 * `QueryableElement` (same id / element / type / label / getState /
 * getIdentifier fields). We pass the registry's elements straight
 * through; the matcher reads `.element.getAttribute(...)` and
 * `.getState()` exactly the same way on both shapes.
 */

import { useEffect } from "react";

const SPEC_CI_ENABLED =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_ENABLE_SPEC_CI === "1";

export function SpecCiInit() {
  useEffect(() => {
    if (!SPEC_CI_ENABLED) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    (async () => {
      try {
        const [autoRuntime, bridge] = await Promise.all([
          import("@qontinui/ui-bridge-auto/runtime"),
          import("@qontinui/ui-bridge"),
        ]);
        const { adaptIRDocumentToWorkflowConfig } = await import(
          "@qontinui/shared-types/ui-bridge-ir"
        );
        if (cancelled) return;

        const liveRegistry = bridge.getGlobalRegistry();

        // RegistryLike adapter — UI Bridge's UIBridgeRegistry has the
        // same getAllElements / on shape that ui-bridge-auto's
        // StateDetector consumes. We just forward.
        const registry = {
          getAllElements: () => liveRegistry.getAllElements(),
          on: (
            type: string,
            listener: (event: { type: string; data: unknown }) => void,
          ) => liveRegistry.on(type as never, listener as never),
        };

        // ActionExecutorLike adapter — findElement reuses the runtime's
        // findFirst (matchesQuery under the hood, real DOM access).
        // executeAction dispatches through the bridge's HTTP control
        // surface: /ui-bridge/control/element/<id>/action. The bridge's
        // CommandRelayListener (mounted in UIBridgeWrapper) handles
        // dispatch back to the registered element's handler.
        const actionExecutor = {
          findElement: (query: unknown) => {
            const elements = liveRegistry.getAllElements();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = autoRuntime.findFirst(elements as any, query as any);
            return result.match ? { id: result.match.id } : null;
          },
          findAllElements: (query: unknown) => {
            const elements = liveRegistry.getAllElements();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return elements
              .filter(
                (el) =>
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  autoRuntime.matchesQuery(el as any, query as any).matches,
              )
              .map((el) => ({ id: el.id }));
          },
          executeAction: async (
            elementId: string,
            action: string,
            params?: Record<string, unknown>,
          ): Promise<void> => {
            // Drive through the bridge's HTTP control surface on the
            // same origin. The runner relays this back to the registered
            // element's action handler via the SDK channel; in Spec CI
            // where the runner isn't in the loop, the bridge's own
            // command-relay handles in-process dispatch.
            const url = `/ui-bridge/control/element/${encodeURIComponent(elementId)}/action`;
            const resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(params ? { action, params } : { action }),
              credentials: "include",
            });
            if (!resp.ok) {
              throw new Error(
                `executeAction HTTP ${resp.status} (element=${elementId} action=${action})`,
              );
            }
          },
          waitForIdle: async (timeout?: number): Promise<void> => {
            // Best-effort idle wait — observe the registry until the
            // element count is stable for `quiet` ms or the budget
            // expires. The matcher tolerates this being approximate
            // because each transition's waitAfter has more precise
            // criteria.
            const budget = timeout ?? 5000;
            const quiet = 400;
            const deadline = Date.now() + budget;
            let lastCount = liveRegistry.getAllElements().length;
            let stableSince = Date.now();
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 100));
              const count = liveRegistry.getAllElements().length;
              if (count !== lastCount) {
                lastCount = count;
                stableSince = Date.now();
                continue;
              }
              if (Date.now() - stableSince >= quiet) return;
            }
          },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__qontinuiSpecCi__ = {
          adaptIRDocumentToWorkflowConfig,
          StateMachine: autoRuntime.StateMachine,
          StateDetector: autoRuntime.StateDetector,
          executeTransition: autoRuntime.executeTransition,
          findFirst: autoRuntime.findFirst,
          matchesQuery: autoRuntime.matchesQuery,
          getRegistry: () => registry,
          getActionExecutor: () => actionExecutor,
        };
      } catch (err) {
        // Silent — Spec CI is dev/test-only. A console.warn would be
        // noise in any browser session a spec author opens, and
        // run-spec-ci.ts already surfaces the gap via the executor's
        // own "not exposed" error path.
      }
    })();

    return () => {
      cancelled = true;
      // Don't unset __qontinuiSpecCi__ on unmount — the executor may
      // still be reading state from it during a tear-down race.
    };
  }, []);

  return null;
}
