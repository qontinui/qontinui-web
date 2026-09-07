"use client";

import { useEffect, useState } from "react";
import { Server, Globe } from "lucide-react";
import { isRunnerReachable } from "@/lib/ui-bridge/discovered-specs";

interface RunnerOfflineStateProps {
  title?: string;
  message?: string;
}

/**
 * Empty state for a page whose data comes from the local runner.
 *
 * ## Two different reasons, one of which the old copy got wrong
 *
 * The runner listens on loopback. A page served from a PUBLIC origin
 * (qontinui.io) therefore cannot fetch it at all — Chrome's Local Network
 * Access blocks public->loopback — no matter how healthy that runner is.
 * `api-client.ts` already knows this and gates its polling on the same
 * `isRunnerReachable()` origin check, so the "offline" reading is CORRECT in
 * that case; the advice attached to it was not.
 *
 * Telling a user to "start the Qontinui Runner desktop app" when their runner
 * is already running, and when starting a second one could not help either, is
 * an instruction that cannot succeed. Observed 2026-09-06: an operator read it
 * on qontinui.io with a live, connected runner and reported the page as wrong.
 *
 * So the origin case gets its own copy naming the real constraint and the one
 * action that resolves it. This is the same honesty rule the sibling
 * `ConnectedAccounts` applies to verification badges: report the state as it
 * actually is, never an implied cause.
 *
 * ## Why the origin variant overrides a caller's `message`
 *
 * Callers pass task-specific copy ("...to configure log sources"), but every
 * one of those is premised on the runner being OFF. On a public origin that
 * premise is false, so honouring the prop would keep the misleading half and
 * merely change its subject.
 *
 * ## Hydration
 *
 * `isRunnerReachable()` reads `window.location`, and returns false under SSR.
 * Rendering the origin variant on the server and the plain one on a localhost
 * client would be a hydration mismatch, so the check runs after mount and the
 * pre-mount render is the neutral (existing) copy.
 */
export function RunnerOfflineState({
  title = "Runner Not Connected",
  message = "Start the Qontinui Runner desktop app to view this page.",
}: RunnerOfflineStateProps) {
  const [blockedByOrigin, setBlockedByOrigin] = useState(false);

  useEffect(() => {
    setBlockedByOrigin(!isRunnerReachable());
  }, []);

  const heading = blockedByOrigin ? "Runner Not Reachable From This Page" : title;
  const body = blockedByOrigin
    ? "This page is served over the public site, and browsers block public pages from " +
      "reaching a local address — so it cannot talk to a runner on this machine even " +
      "when one is running. Open the local app (http://localhost:3001) to use this page."
    : message;
  const Icon = blockedByOrigin ? Globe : Server;

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-16 h-16 bg-surface-raised rounded-2xl flex items-center justify-center mb-4">
        <Icon className="size-8 text-text-muted" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">{heading}</h3>
      <p className="text-sm text-text-muted text-center max-w-md">{body}</p>
    </div>
  );
}
