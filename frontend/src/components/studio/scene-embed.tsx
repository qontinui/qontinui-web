"use client";

/**
 * One studio scene on a marketing page: poster first, player later.
 *
 * - **Poster first.** The server-rendered markup is the scene's poster frame
 *   (`next/image`, so it is resized and re-encoded), and the page's LCP
 *   candidate when `priority` is set. A player that does not autoplay
 *   (reduced motion, or `autoPlay` off) opens on that same frame. An
 *   autoplaying one starts the scene from frame 0 when it mounts.
 * - **Player later, in its own chunk.** `./studio-player` (the studio player
 *   plus Remotion) is a `next/dynamic` import with `ssr: false`. It is
 *   requested only once the embed is near the viewport, the page has
 *   finished loading, the visitor has interacted with the page (pointer,
 *   touch, wheel, scroll or key), and the browser is idle. So it never
 *   competes with first paint or the load, and a visitor who never touches
 *   the page sees the poster frame. It mounts over the poster.
 * - **Reduced motion.** The studio player never autoplays under
 *   `prefers-reduced-motion: reduce`. It stays on the poster frame and shows
 *   a play control. `autoPlay` here only asks for motion when motion is OK.
 * - **Mode label (plan D2).** Every frame of a scene carries its trace mode
 *   on screen. The caption under the frame says it again in page text: every
 *   scene on this site is ILLUSTRATIVE, a hand-authored run rather than a
 *   recording. The UI Bridge sees both: `scene-embed-<id>` on the figure and
 *   `scene-mode-<mode>-<id>` on the label (`data-testid`, which the Bridge
 *   registers and uses as the element id), and the page specs assert them.
 */
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  posterSrc,
  type FactoryScene,
} from "./scenes";

const StudioScenePlayer = dynamic(() => import("./studio-player"), {
  ssr: false,
  loading: () => null,
});

type IdleHandle = { cancel: () => void };

function whenIdle(callback: () => void): IdleHandle {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 3000 });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = window.setTimeout(callback, 200);
  return { cancel: () => window.clearTimeout(id) };
}

/** Events that mean a person is using the page (not a crawler or an audit). */
const INTERACTION_EVENTS = [
  "pointermove",
  "pointerdown",
  "touchstart",
  "wheel",
  "scroll",
  "keydown",
] as const;

let interacted = false;
const interactionWaiters = new Set<() => void>();

function onFirstInteraction() {
  interacted = true;
  for (const event of INTERACTION_EVENTS) {
    window.removeEventListener(event, onFirstInteraction, true);
  }
  const waiters = [...interactionWaiters];
  interactionWaiters.clear();
  for (const waiter of waiters) waiter();
}

// Listen from the moment this module runs (hydration), so an interaction
// that happens before an embed scrolls into view or the page finishes
// loading still counts.
if (typeof window !== "undefined") {
  for (const event of INTERACTION_EVENTS) {
    window.addEventListener(event, onFirstInteraction, {
      capture: true,
      passive: true,
    });
  }
}

/** Calls `callback` once the visitor has interacted with the page (at once if they already have). */
function afterFirstInteraction(callback: () => void): () => void {
  if (interacted) {
    callback();
    return () => undefined;
  }
  interactionWaiters.add(callback);
  return () => {
    interactionWaiters.delete(callback);
  };
}

/**
 * True once `ref` is near the viewport, the page has loaded, the visitor has
 * interacted with it, and the browser is idle. Waiting for the first
 * interaction keeps the player chunk and Remotion out of the page's load and
 * its main-thread budget (Lighthouse's TBT and TTI) entirely: until someone
 * actually uses the page, the poster frame IS the scene.
 */
function useLoadWhenWanted(ref: React.RefObject<HTMLElement | null>) {
  const [load, setLoad] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let idle: IdleHandle | null = null;
    let stopWaiting: (() => void) | null = null;
    const start = () => {
      stopWaiting = afterFirstInteraction(() => {
        idle = whenIdle(() => setLoad(true));
      });
    };
    const afterLoad = () => {
      if (document.readyState === "complete") start();
      else window.addEventListener("load", start, { once: true });
    };
    const cleanup = () => {
      window.removeEventListener("load", start);
      stopWaiting?.();
      idle?.cancel();
    };
    if (typeof IntersectionObserver !== "function") {
      afterLoad();
      return cleanup;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          afterLoad();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cleanup();
    };
  }, [ref]);
  return load;
}

export type SceneEmbedProps = {
  scene: FactoryScene;
  /** Play on load when motion is OK (never under reduced motion). */
  autoPlay?: boolean;
  loop?: boolean;
  /** The poster is above the fold: preload it (LCP). */
  priority?: boolean;
  /** `sizes` for the poster image. */
  sizes?: string;
  className?: string;
};

export function SceneEmbed({
  scene,
  autoPlay = false,
  loop = false,
  priority = false,
  sizes = "(min-width: 1024px) 1024px, 100vw",
  className,
}: SceneEmbedProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const loadPlayer = useLoadWhenWanted(frameRef);

  return (
    <figure
      className={className}
      data-scene-embed={scene.id}
      data-trace-mode={scene.mode}
      data-testid={`scene-embed-${scene.id}`}
    >
      <div
        ref={frameRef}
        className="relative w-full aspect-video overflow-hidden rounded-xl border border-border bg-card"
      >
        <Image
          src={posterSrc(scene.id)}
          alt={`${scene.title}: an illustrative animation of the Qontinui software factory`}
          width={POSTER_WIDTH}
          height={POSTER_HEIGHT}
          sizes={sizes}
          priority={priority}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {loadPlayer && (
          <div className="absolute inset-0" data-scene-player>
            <StudioScenePlayer
              scene={scene.id}
              autoPlay={autoPlay}
              loop={loop}
            />
          </div>
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span
          className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300"
          data-trace-mode-label
          data-testid={`scene-mode-${scene.mode}-${scene.id}`}
        >
          Illustrative
        </span>
        <span>
          {scene.title}: a hand-authored run, not a recording of the factory.
        </span>
      </figcaption>
    </figure>
  );
}
