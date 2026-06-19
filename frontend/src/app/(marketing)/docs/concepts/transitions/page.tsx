import Link from "next/link";
import {
  ArrowRight,
  Route,
  Layers,
  RotateCcw,
  Sparkles,
  AlertCircle,
} from "lucide-react";

export const metadata = {
  title: "Transitions & Pathfinding - Qontinui Documentation",
  description:
    "The theory of transitions in Qontinui: edges between states, multi-target pathfinding, multi-state activation, and phased execution with rollback.",
};

export default function TransitionsConceptPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Documentation
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Transitions &amp; Pathfinding
          </h1>
          <p className="text-xl text-muted-foreground">
            How the engine navigates between states to reach a goal
          </p>
        </div>

        {/* What is a transition */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What Is a Transition?
          </h2>
          <p className="text-foreground mb-4">
            A <strong>transition</strong> is a connection between states that
            describes how to move from one to another. If{" "}
            <Link
              href="/docs/concepts/states"
              className="text-primary hover:underline"
            >
              states
            </Link>{" "}
            are the nodes of the model graph, transitions are the{" "}
            <strong>edges</strong>. Each transition specifies the actions to
            perform — typing, clicking, waiting — and which states become active
            or inactive once it completes.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: You Name a Destination, Not a Route
            </h3>
            <p className="text-sm text-foreground">
              You do not script the full sequence of screens to traverse.
              Instead you declare a target state and let the engine{" "}
              <strong>find a path</strong> of transitions from the current state
              to that target — re-planning if the application is not where it
              was expected.
            </p>
          </div>
        </section>

        {/* Pathfinding */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Pathfinding
          </h2>
          <p className="text-foreground mb-6">
            Because the model is a graph, reaching a goal is a search problem.
            Given the currently active state(s) and a set of target state(s),
            the engine computes an ordered sequence of transitions that connects
            them.
          </p>

          <div className="space-y-6">
            <FeatureCard
              icon={<Route className="w-6 h-6 text-primary" />}
              title="Shortest-Path Search"
              description="The engine treats transitions as weighted edges and searches for a low-cost route from the current state to the target, much like a shortest-path algorithm over a map."
            />
            <FeatureCard
              icon={<Sparkles className="w-6 h-6 text-purple-600" />}
              title="Multi-Target Pathfinding"
              description="A goal can be several states at once — e.g. open the search panel and the properties panel and the debug view. The engine finds a single path that reaches all of the requested targets, not just one."
            />
            <FeatureCard
              icon={<RotateCcw className="w-6 h-6 text-green-600" />}
              title="Re-Planning on Drift"
              description="After each step the engine verifies the state it actually reached. If reality diverged from the plan, it searches for a new path from where it really is rather than blindly continuing."
            />
          </div>
        </section>

        {/* Multi-state activation */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Multi-State Activation
          </h2>
          <p className="text-foreground mb-6">
            A single transition can change more than one state at a time. This
            mirrors how real interfaces behave — opening a workspace might bring
            up a toolbar, a sidebar, and a content area together.
          </p>

          <div className="bg-muted border border-border rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              A transition can specify:
            </h3>
            <ul className="space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <ArrowRight className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span>
                  <strong>States to activate</strong> — one or more states that
                  become active together when the transition completes
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span>
                  <strong>States to exit</strong> — states that should
                  deactivate, such as a splash screen being replaced
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Layers className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>States that stay visible</strong> — for overlays and
                  dialogs that appear without dismissing the screen beneath them
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Phased execution */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Phased Execution &amp; Rollback
          </h2>
          <p className="text-foreground mb-6">
            Transitions execute in ordered phases. Splitting execution this way
            allows the engine to validate before acting and to roll back cleanly
            if a phase fails, leaving the model in a known state rather than a
            half-applied one.
          </p>

          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm font-mono mb-4">
              <PhaseChip label="VALIDATE" />
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <PhaseChip label="OUTGOING" />
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <PhaseChip label="ACTIVATE" />
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <PhaseChip label="INCOMING" />
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <PhaseChip label="EXIT" />
            </div>
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="font-mono text-primary font-bold">
                  VALIDATE
                </span>
                <span>
                  — confirm the transition can run from the current state
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-primary font-bold">
                  OUTGOING
                </span>
                <span>— perform the actions that leave the source state</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-primary font-bold">
                  ACTIVATE
                </span>
                <span>— mark the destination state(s) active</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-primary font-bold">
                  INCOMING
                </span>
                <span>— run any verification or setup for the new state</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-primary font-bold">EXIT</span>
                <span>— deactivate states that should no longer be active</span>
              </li>
            </ul>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mt-4">
              <div className="flex items-start gap-2">
                <RotateCcw className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-foreground">
                  If a phase fails, the engine rolls back, preserving the prior
                  state instead of leaving a partial transition applied.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Where this comes from */}
        <section className="mb-12">
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> Multi-target pathfinding, multi-state
                activation, and phased execution come from the open-source{" "}
                <Link
                  href="https://qontinui.github.io/multistate/"
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  MultiState
                </Link>{" "}
                library. For the step-by-step of authoring transitions in the
                builder, see{" "}
                <Link
                  href="/docs/web/transitions"
                  className="text-primary hover:underline"
                >
                  State Transitions
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Action System"
              description="The operations a transition performs"
              href="/docs/concepts/actions"
            />
            <NextStepCard
              title="State Transitions (How-To)"
              description="Author transitions in Qontinui Web"
              href="/docs/web/transitions"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function PhaseChip({ label }: { label: string }) {
  return (
    <span className="bg-primary/10 border border-primary/30 text-primary px-2 py-1 rounded text-xs">
      {label}
    </span>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

interface NextStepCardProps {
  title: string;
  description: string;
  href: string;
}

function NextStepCard({ title, description, href }: NextStepCardProps) {
  return (
    <Link
      href={href}
      className="block bg-muted border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
