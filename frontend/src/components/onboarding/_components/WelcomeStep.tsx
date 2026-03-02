import { Rocket, Sparkles } from "lucide-react";

export function WelcomeStep() {
  return (
    <div className="text-center space-y-6">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 rounded-full border border-brand-primary/30">
        <Rocket className="w-10 h-10 text-brand-primary" />
      </div>
      <div className="space-y-3">
        <h2 className="text-3xl font-bold">
          Let&apos;s Create Your First Automation
        </h2>
        <p className="text-lg text-text-muted max-w-2xl mx-auto">
          We&apos;ll guide you through building a simple automation step-by-step
        </p>
      </div>
      <div className="bg-surface-raised/50 border border-border-subtle rounded-lg p-6 max-w-xl mx-auto">
        <div className="flex items-start gap-4 text-left">
          <Sparkles className="w-6 h-6 text-brand-secondary flex-shrink-0 mt-1" />
          <div>
            <h3 className="font-semibold mb-2">What is Automation?</h3>
            <p className="text-sm text-text-muted">
              Automations are visual workflows that perform repetitive tasks for
              you. Using state machines and image recognition, you can automate
              games, business processes, testing, and more.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
