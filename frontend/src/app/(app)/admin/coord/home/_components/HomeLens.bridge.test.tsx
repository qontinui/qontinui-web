/**
 * The home page's refresh button, called the way an agent calls it: through
 * the SDK's executor alone, in a task a re-render of that button has already
 * committed in but not yet flushed passive effects for.
 *
 * `HomeRefreshButton` declares its action once per `onRefresh`; the handler
 * closes over the prop directly (no latest-ref mirror). That holds only while
 * the SDK runs the handler of the LATEST COMMITTED declaration — the case this
 * pins. The sample is taken in a MutationObserver callback, a microtask queued
 * by the commit's own DOM mutation: after the commit, before React's passive
 * flush. `act` is never used (it would flush passive effects), so
 * IS_REACT_ACT_ENVIRONMENT is off for the file, and a passive probe asserts
 * the sample really landed in the gap.
 */

import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  UIBridgeProvider,
  useUIBridgeOptional,
  type UIBridgeContextValue,
} from "@qontinui/ui-bridge/react";
import {
  HOME_REFRESH_ACTION,
  HOME_REFRESH_ID,
  HomeRefreshButton,
} from "./HomeLens";

const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedAct: boolean | undefined;
beforeAll(() => {
  savedAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = savedAct;
});

let bridge: UIBridgeContextValue | null = null;
function CaptureBridge() {
  bridge = useUIBridgeOptional();
  return null;
}

interface Props {
  tag: string;
  onRefresh: () => Promise<void>;
}
let setProps: ((next: Props) => void) | null = null;
let flushedTag: string | undefined;

/** Re-renders with new props; the tag's text is the DOM mutation the sampler sees. */
function Harness({ initial }: { initial: Props }) {
  const [props, set] = useState(initial);
  useEffect(() => {
    setProps = set;
  }, []);
  // Dep-free passive probe: it runs in the same flush as the SDK's passive work.
  useEffect(() => {
    flushedTag = props.tag;
  });
  return (
    <>
      <span data-testid="tag">{props.tag}</span>
      <HomeRefreshButton onRefresh={props.onRefresh} />
    </>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
  bridge = null;
  setProps = null;
  flushedTag = undefined;
});

const until = (pred: () => boolean, what: string) =>
  vi.waitFor(
    () => {
      if (!pred()) throw new Error(`timed out waiting for: ${what}`);
    },
    { timeout: 2000, interval: 10 }
  );

describe("HomeRefreshButton's home-refresh custom action", () => {
  it("runs the NEW onRefresh when called in the gap after a re-render that changed only onRefresh", async () => {
    const ran: string[] = [];
    const refresh = (tag: string) => async () => {
      ran.push(tag);
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <UIBridgeProvider>
        <CaptureBridge />
        <Harness initial={{ tag: "r1", onRefresh: refresh("r1") }} />
      </UIBridgeProvider>
    );
    await until(() => flushedTag === "r1", "mounted");
    // Settle past the registration's first commits: a change made there would
    // pass against a handler that only ever saw its first closure.
    setProps!({ tag: "r2", onRefresh: refresh("r2") });
    await until(() => flushedTag === "r2", "r2 flushed");

    const host = container;
    const tagNode = host.querySelector('[data-testid="tag"]')!;
    const sample = await new Promise<{
      flushedAtSample: string | undefined;
      response: ReturnType<
        NonNullable<typeof bridge>["executor"]["executeAction"]
      >;
    }>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (tagNode.textContent !== "r3") return;
        observer.disconnect();
        clearTimeout(timer);
        resolve({
          flushedAtSample: flushedTag,
          response: bridge!.executor.executeAction(HOME_REFRESH_ID, {
            action: HOME_REFRESH_ACTION,
          }),
        });
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("the commit rendering r3 was never observed"));
      }, 2000);
      observer.observe(host, { childList: true, characterData: true, subtree: true });
      // Only onRefresh changes (the tag is the sampler's trigger, not a prop of
      // the button): a resolved promise makes it a non-discrete update.
      void Promise.resolve().then(() =>
        setProps!({ tag: "r3", onRefresh: refresh("r3") })
      );
    });

    // The passive flush of r3 had NOT run when the SDK handled the call.
    expect(sample.flushedAtSample).toBe("r2");
    const res = await sample.response;
    expect(res.success).toBe(true);
    expect(ran).toEqual(["r3"]);
  });
});
