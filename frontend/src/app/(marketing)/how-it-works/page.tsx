import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";

import { SceneEmbed } from "@/components/studio/scene-embed";
import { FACTORY_SCENES } from "@/components/studio/scenes";

export const metadata: Metadata = {
  title: "How the factory works - Qontinui",
  description:
    "Six animated explainers of the Qontinui software factory: the plan lifecycle, the digital twin, gates and continuations, the merge train, the fleet and self-correction.",
};

/**
 * /how-it-works: the factory's processes, one studio scene each (S1–S6, plan
 * 2026-10-09-qontinui-marketing-studio-animated-process-explainers Phase 4).
 * Nothing autoplays here. Each scene shows its poster frame and plays when the
 * viewer presses play. Every trace is ILLUSTRATIVE, and the page says so.
 */
export default function HowItWorksPage() {
  return (
    <div className="bg-background">
      <section className="container mx-auto px-4 pt-16 pb-8">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6 text-balance">
            How the factory works
          </h1>
          <p className="text-xl text-muted-foreground text-pretty">
            Qontinui runs a fleet of AI agents on your codebase. You state
            intent and review outcomes. The six processes below are how the work
            in between gets done, and how agents answer their own questions
            instead of asking you.
          </p>
          <p className="mt-6 text-sm text-muted-foreground">
            Every animation on this page is illustrative: a hand-authored run
            drawn to explain the process, not a recording of the factory.
          </p>
        </div>
      </section>

      <ol className="container mx-auto px-4 max-w-5xl pb-16 space-y-20">
        {FACTORY_SCENES.map((scene, index) => (
          <li key={scene.id} id={scene.anchor} className="scroll-mt-24">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
              <span className="text-muted-foreground mr-2">{index + 1}.</span>
              {scene.title}
            </h2>
            <p className="text-lg text-muted-foreground mb-6 max-w-3xl text-pretty">
              {scene.description}
            </p>
            <SceneEmbed
              scene={scene}
              sizes="(min-width: 1024px) 1024px, 100vw"
            />
          </li>
        ))}
      </ol>

      <section className="container mx-auto px-4 pb-24 text-center">
        <h2 className="text-2xl font-bold text-foreground mb-4">
          Run the factory on your own project
        </h2>
        <Link
          href="/runner/download"
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-3 rounded-lg font-semibold transition-colors"
        >
          <Download className="w-5 h-5" />
          Download Qontinui
        </Link>
      </section>
    </div>
  );
}
