import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  FACTORY_SCENES,
  POSTER_HEIGHT,
  POSTER_WIDTH,
  posterSrc,
} from "@/components/studio/scenes";

/**
 * "How the factory works": the landing page's overview of the six process
 * scenes (S1–S6). Each card is the scene's poster frame and links to the
 * scene playing on /how-it-works. The landing page loads no player for these;
 * only the hero does.
 */
export function FactorySection() {
  return (
    <section className="py-20 px-4 bg-muted/20" id="how-the-factory-works">
      <div className="container mx-auto max-w-6xl">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
          How the factory works
        </h2>
        <p className="text-lg text-muted-foreground text-center max-w-3xl mx-auto mb-12 text-pretty">
          You state intent and review outcomes. Everything in between is done by
          agents, and each step leaves a record the next agent can read.
        </p>

        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FACTORY_SCENES.map((scene) => (
            <li key={scene.id}>
              <Link
                href={`/how-it-works#${scene.anchor}`}
                className="group block h-full rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors"
              >
                <Image
                  src={posterSrc(scene.id)}
                  alt=""
                  width={POSTER_WIDTH}
                  height={POSTER_HEIGHT}
                  sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                  className="w-full h-auto"
                />
                <div className="p-5">
                  <h3 className="font-semibold mb-2">{scene.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {scene.summary}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-center">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            Watch the factory work
            <ArrowRight className="h-4 w-4" />
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          The animations are illustrative: hand-authored runs, not recordings.
        </p>
      </div>
    </section>
  );
}
