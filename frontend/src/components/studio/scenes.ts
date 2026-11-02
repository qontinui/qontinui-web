/**
 * The studio scenes this site shows (plan
 * 2026-10-09-qontinui-marketing-studio-animated-process-explainers, Phase 4),
 * with the words the page puts around each one.
 *
 * The animation, its poster frame and its trace come from the vendored
 * `@qontinui/studio-scenes` package (`frontend/vendor/`); this file holds
 * only the site's copy. Every scene here plays an ILLUSTRATIVE trace: a
 * hand-authored run, not a recording of the factory (plan D2). No replay
 * trace exists yet, so `mode` is "illustrative" for all of them, and
 * `studio-scenes.test.ts` checks it against the package's manifest.
 */
import type { SceneId } from "@qontinui/studio-scenes/player";

export type FactoryScene = {
  id: SceneId;
  /** Anchor on /how-it-works. */
  anchor: string;
  title: string;
  /** One line for the landing page's overview. */
  summary: string;
  /** The paragraph beside the scene on /how-it-works. */
  description: string;
  mode: "illustrative";
};

/** Poster frame of a scene, as served from `public/studio/posters/`. */
export function posterSrc(id: SceneId): string {
  return `/studio/posters/${id}-16x9.png`;
}

/** Where the player loads the bundled fonts from (`public/studio/fonts/`). */
export const STUDIO_ASSET_BASE = "/studio";

export const POSTER_WIDTH = 1920;
export const POSTER_HEIGHT = 1080;

/** S1–S6, in the order /how-it-works tells them. */
export const FACTORY_SCENES: readonly FactoryScene[] = [
  {
    id: "s1-plan-lifecycle",
    anchor: "plan-lifecycle",
    title: "Plan lifecycle",
    summary: "One plan, from draft to shipped, every step recorded.",
    description:
      "Work starts as a written plan. An agent vets it, a session implements it, opens a pull request, gets it through CI and the merge train, and marks it shipped once it has landed. Each step is recorded, so the plan's status is read from what happened rather than from what someone claimed.",
    mode: "illustrative",
  },
  {
    id: "s2-digital-twin",
    anchor: "digital-twin",
    title: "The digital twin",
    summary: "Agents ask the twin instead of asking you.",
    description:
      "GitHub, CI, machines and agent sessions are mirrored into one model of the development process. Agents decide from that model instead of guessing. The twin includes you: your policies, product intent and decisions are written down and served to every session, so a question you have already answered is answered without waking you.",
    mode: "illustrative",
  },
  {
    id: "s3-gates-continuations",
    anchor: "gates-and-continuations",
    title: "Gates and continuations",
    summary: "Blocked work waits on a condition, not on a person.",
    description:
      "When a session is blocked on something outside its control, such as a CI run, another pull request or a deploy, it registers a gate on that condition and ends. The factory watches for the condition. When it holds, a new session picks the work up where the last one left it.",
    mode: "illustrative",
  },
  {
    id: "s4-merge-train",
    anchor: "merge-train",
    title: "The merge train",
    summary: "Many pull requests, landed in order.",
    description:
      "Pull requests from many sessions queue for main. Each is rebased onto the latest main, tested again and landed in order. A pull request that conflicts steps out of line until the conflict is fixed, so it never blocks the ones behind it.",
    mode: "illustrative",
  },
  {
    id: "s5-fleet",
    anchor: "fleet",
    title: "The fleet",
    summary: "Many sessions on many machines, without collisions.",
    description:
      "Many agent sessions run at once across several machines, each in its own isolated worktree. They coordinate by declaring what they intend to change and claiming it first, so two sessions find out they would collide before either writes a line.",
    mode: "illustrative",
  },
  {
    id: "s6-self-correction",
    anchor: "self-correction",
    title: "Self-correction",
    summary: "Red CI is diagnosed and fixed by the agent itself.",
    description:
      "When CI goes red, the session reads the failure from the CI log, works out the cause, pushes a fix and lets CI run again. It goes round that loop until the build is green; you are told what happened rather than asked to fix it.",
    mode: "illustrative",
  },
];

export const HERO_SCENE: FactoryScene = FACTORY_SCENES[0]!;
