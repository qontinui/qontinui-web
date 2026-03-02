"use client";

import React from "react";
import { Card } from "@/components/ui/card";

export function ProviderSection() {
  return (
    <section className="py-20 px-4 bg-muted/20">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Your AI, Your Rules
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Bring your own API key. No subscriptions to third parties. No
            unauthorized access. Just direct, compliant integration with the
            providers you choose.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:glow-cyan">
            <h3 className="text-xl font-semibold mb-3">Claude</h3>
            <p className="text-muted-foreground text-sm">
              Claude Code CLI or API key. Use your subscription or
              pay-per-token.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-secondary/50 transition-all duration-300 hover:glow-purple">
            <h3 className="text-xl font-semibold mb-3">Gemini</h3>
            <p className="text-muted-foreground text-sm">
              Gemini CLI with OAuth or API key. Free tier available.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-accent/50 transition-all duration-300 hover:glow-green">
            <h3 className="text-xl font-semibold mb-3">More Coming</h3>
            <p className="text-muted-foreground text-sm">
              Open architecture. Adding new providers is straightforward.
            </p>
          </Card>
        </div>

        <p className="text-center text-muted-foreground mt-8">
          Switch providers without changing your workflows. Your automations
          aren&apos;t locked to any single vendor.
        </p>
      </div>
    </section>
  );
}
