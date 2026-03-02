"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

export function ResearchSection() {
  return (
    <section className="py-20 px-4 bg-muted/20">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-12">
          <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
            Peer-Reviewed Research
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built on Published Science, Open to Everyone
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Based on peer-reviewed research published in Springer&apos;s
            Software and Systems Modeling journal (2025).
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300">
            <h3 className="text-xl font-semibold mb-4">
              Peer-Reviewed Foundation
            </h3>
            <p className="text-muted-foreground mb-6">
              Published in Springer SoSyM — the first mathematically-proven
              approach to GUI automation that reduces complexity from
              exponential to polynomial growth.
            </p>
            <a
              href="https://link.springer.com/article/10.1007/s10270-025-01319-9"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-primary hover:underline"
            >
              Read the Paper
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300">
            <h3 className="text-xl font-semibold mb-4">Open Source</h3>
            <p className="text-muted-foreground mb-6">
              The runner, UI bridge, multistate framework, and core libraries
              are freely available on GitHub. Contribute, fork, or build on top.
            </p>
            <div className="space-y-2">
              <a
                href="https://github.com/qontinui/qontinui-runner"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-primary hover:underline"
              >
                GitHub: qontinui-runner
              </a>
              <a
                href="https://github.com/qontinui/ui-bridge"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-primary hover:underline"
              >
                GitHub: ui-bridge
              </a>
              <a
                href="https://qontinui.github.io/multistate/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-primary hover:underline"
              >
                Docs: multistate (state machine)
              </a>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
