import Link from "next/link";
import { Box, Layers, Eye, Boxes, Group, AlertCircle } from "lucide-react";

export const metadata = {
  title: "State Machines - Qontinui Documentation",
  description:
    "The theory of states in Qontinui: visual states as the nodes of the model graph, multiple simultaneously active states, and how states are recognized.",
};

export default function StatesConceptPage() {
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
            State Machines
          </h1>
          <p className="text-xl text-muted-foreground">
            How visual states form the nodes of a model-based automation
          </p>
        </div>

        {/* What is a state */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What Is a State?
          </h2>
          <p className="text-foreground mb-4">
            A <strong>state</strong> represents a distinct screen, dialog, or
            condition of the application — a login screen, a dashboard, an open
            settings panel. In Qontinui&apos;s model, states are the{" "}
            <strong>nodes</strong> of a graph;{" "}
            <Link
              href="/docs/concepts/transitions"
              className="text-primary hover:underline"
            >
              transitions
            </Link>{" "}
            are the edges connecting them. Automation moves through this graph
            the way a traveler moves through a map of cities.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: States Are Recognized, Not Assumed
            </h3>
            <p className="text-sm text-foreground">
              Qontinui does not track state by remembering which buttons were
              clicked. It determines the current state by{" "}
              <strong>looking at the screen</strong> and matching identifying
              images. This is what lets the engine recover when the application
              ends up somewhere unexpected.
            </p>
          </div>
        </section>

        {/* Beyond classic FSM */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Beyond a Classic State Machine
          </h2>
          <p className="text-foreground mb-6">
            A traditional finite state machine assumes exactly one state is
            active at a time. Real interfaces do not behave that way — a modal
            dialog opens <em>over</em> a dashboard, a toolbar and a sidebar and
            a content area are all present together. Qontinui&apos;s state model
            (built on the open-source{" "}
            <Link
              href="https://qontinui.github.io/multistate/"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              MultiState
            </Link>{" "}
            library) embraces this directly.
          </p>

          <div className="space-y-6">
            <FeatureCard
              icon={<Boxes className="w-6 h-6 text-primary" />}
              title="Multiple Active States"
              description="Several states can be active at the same time. A dialog can be active alongside the screen it covers, and independent panels can each carry their own state."
            />
            <FeatureCard
              icon={<Group className="w-6 h-6 text-green-600" />}
              title="State Groups"
              description="Related states that belong together — a toolbar, sidebar, and content area that always appear as a unit — can be grouped so they activate and deactivate together."
            />
            <FeatureCard
              icon={<Layers className="w-6 h-6 text-purple-600" />}
              title="Occlusion & Reveal"
              description="When one state covers others (a modal over a page), the covered states are treated as occluded rather than destroyed. Closing the cover reveals them again."
            />
          </div>
        </section>

        {/* How states are recognized */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            How a State Is Recognized
          </h2>
          <p className="text-foreground mb-6">
            Each state carries one or more <strong>identifying images</strong> —
            screenshots of UI elements unique to that state. To decide whether a
            state is active, the engine searches the current screen for those
            images using{" "}
            <Link
              href="/docs/concepts/image-recognition"
              className="text-primary hover:underline"
            >
              visual recognition
            </Link>
            .
          </p>

          <div className="bg-muted border border-border rounded-lg p-6">
            <ol className="space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">1.</span>
                <span>The engine captures the current screen</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">2.</span>
                <span>
                  It searches for each of the state&apos;s identifying images
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">3.</span>
                <span>
                  If all <strong>required</strong> images are found, the state
                  is considered active
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">4.</span>
                <span>
                  This check runs before actions and during transitions to keep
                  the engine&apos;s picture of reality accurate
                </span>
              </li>
            </ol>
          </div>
        </section>

        {/* What a state can contain */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            What a State Can Contain
          </h2>
          <p className="text-foreground mb-6">
            Identifying images are the essential ingredient, but a state can
            also bundle other elements that describe its anatomy:
          </p>

          <div className="grid gap-4">
            <ElementCard
              icon={<Eye className="w-6 h-6 text-primary" />}
              title="State Images"
              description="The visual templates that identify the state and provide click targets within it"
            />
            <ElementCard
              icon={<Box className="w-6 h-6 text-green-600" />}
              title="Regions & Locations"
              description="Rectangular areas and point coordinates used to scope searches or position interactions"
            />
            <ElementCard
              icon={<Layers className="w-6 h-6 text-purple-600" />}
              title="State Strings"
              description="Text values associated with the state, used for input or verification"
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> This page covers the concepts. For the
                step-by-step of creating states, adding identifying images, and
                marking initial and final states in the builder, see{" "}
                <Link
                  href="/docs/web/states"
                  className="text-primary hover:underline"
                >
                  Working with States
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
              title="Transitions & Pathfinding"
              description="How the engine navigates between states"
              href="/docs/concepts/transitions"
            />
            <NextStepCard
              title="Working with States (How-To)"
              description="Build and configure states in Qontinui Web"
              href="/docs/web/states"
            />
          </div>
        </section>
      </div>
    </div>
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

interface ElementCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function ElementCard({ icon, title, description }: ElementCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold text-foreground mb-1">{title}</h4>
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
