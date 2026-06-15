import Link from "next/link";
import {
  Boxes,
  GitBranch,
  Eye,
  ShieldCheck,
  TestTube,
  AlertCircle,
} from "lucide-react";

export const metadata = {
  title: "Model-Based Automation - Qontinui Documentation",
  description:
    "Understand the theory behind Qontinui: modeling a GUI as a state machine of visual states and transitions, and why this is more robust than scripted automation.",
};

export default function ModelBasedConceptPage() {
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
            Model-Based Automation
          </h1>
          <p className="text-xl text-muted-foreground">
            Why Qontinui models the GUI as a state machine instead of recording
            a script
          </p>
        </div>

        {/* The core idea */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            The Core Idea
          </h2>
          <p className="text-foreground mb-4">
            Most automation tools record a fixed sequence of steps: click here,
            type there, wait, click again. That script works until the interface
            shifts — a dialog appears, a page loads slowly, an element moves —
            and then the whole sequence breaks. <strong>Model-based</strong>{" "}
            automation takes a different approach. Instead of describing{" "}
            <em>what to do</em>, you describe{" "}
            <em>what the application looks like</em>: its distinct screens
            (states) and the ways you can move between them (transitions). The
            engine then figures out how to reach your goal from wherever it
            currently is.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: A Map, Not a Script
            </h3>
            <p className="text-sm text-foreground">
              You give Qontinui a <strong>model</strong> of the application — a
              graph where states are the nodes and transitions are the edges.
              Automation becomes navigation: name a destination, and the engine
              finds a path there, recovering automatically when the application
              is not where it expected.
            </p>
          </div>
        </section>

        {/* Building blocks */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            The Building Blocks
          </h2>

          <div className="space-y-6">
            <BlockCard
              icon={<Boxes className="w-6 h-6 text-primary" />}
              title="States"
              description="A distinct screen, dialog, or condition in the application — identified visually rather than by hardcoded coordinates or element IDs. States are the nodes of the model graph."
              href="/docs/concepts/states"
              linkLabel="State Machines →"
            />
            <BlockCard
              icon={<GitBranch className="w-6 h-6 text-green-600" />}
              title="Transitions"
              description="A connection between states describing how to get from one to another, and which states become active or inactive afterward. Transitions are the edges of the graph."
              href="/docs/concepts/transitions"
              linkLabel="Transitions & Pathfinding →"
            />
            <BlockCard
              icon={<Eye className="w-6 h-6 text-purple-600" />}
              title="Visual Recognition"
              description="Template matching against the live screen determines which states are currently active. This is how the engine knows where it is before deciding where to go next."
              href="/docs/concepts/image-recognition"
              linkLabel="Visual Recognition →"
            />
          </div>
        </section>

        {/* Why it is more robust */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Why It Is More Robust
          </h2>

          <div className="space-y-4">
            <BenefitCard
              icon={<ShieldCheck className="w-5 h-5 text-green-600" />}
              title="Self-recovering"
              description="Because the engine verifies the current state before each step, it can re-plan when the application drifts — handling a stray dialog or a slow load instead of failing on a missing click."
            />
            <BenefitCard
              icon={<GitBranch className="w-5 h-5 text-green-600" />}
              title="Composable"
              description="A single model serves many goals. Once states and transitions exist, any reachable screen becomes a valid destination — no need to script each path by hand."
            />
            <BenefitCard
              icon={<Eye className="w-5 h-5 text-green-600" />}
              title="Resolution and framework independent"
              description="Visual identification works across screen sizes and UI toolkits. The model describes appearance, not DOM structure, so it applies to web, desktop, and other GUI applications alike."
            />
            <BenefitCard
              icon={<TestTube className="w-5 h-5 text-green-600" />}
              title="Testable"
              description="A model can be reasoned about and exercised without driving a real screen. Qontinui Web includes mock execution so you can validate the state machine logic before running against a live application."
            />
          </div>
        </section>

        {/* Research foundation */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Research Foundation
          </h2>
          <p className="text-foreground mb-4">
            Qontinui&apos;s model-based approach descends from{" "}
            <strong>Brobot</strong>, a Java GUI-automation library developed
            from 2018 to 2024; Qontinui is its Python successor. The underlying
            method was formalized in the paper{" "}
            <Link
              href="https://link.springer.com/article/10.1007/s10270-025-01319-9"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              &quot;Model-based GUI Automation&quot;
            </Link>
            , published in Springer&apos;s{" "}
            <em>Software and Systems Modeling</em> journal in October 2025.
          </p>

          <div className="bg-muted border border-border rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              What the research contributes
            </h3>
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="text-primary font-bold">•</span>
                <span>
                  A formal model of GUI automation as a state machine of visual
                  states and transitions
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary font-bold">•</span>
                <span>
                  A complexity argument that modeling the application reduces
                  the effort of covering its behaviors compared to enumerating
                  scripts
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary font-bold">•</span>
                <span>
                  A testable foundation — the model can be unit- and
                  integration-tested, not just run end-to-end
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* How a run works */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            How a Run Works
          </h2>
          <p className="text-foreground mb-6">
            At a high level, executing a model-based automation is a loop of
            observe, decide, act:
          </p>
          <div className="bg-muted border border-border rounded-lg p-6">
            <ol className="space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">1.</span>
                <span>
                  <strong>Observe</strong> — capture the screen and match
                  identifying images to determine which states are active
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">2.</span>
                <span>
                  <strong>Plan</strong> — find a path of transitions from the
                  current state(s) to the requested target state(s)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">3.</span>
                <span>
                  <strong>Act</strong> — run the transition&apos;s actions
                  (click, type, wait, and so on)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">4.</span>
                <span>
                  <strong>Verify</strong> — confirm the expected state was
                  reached, and re-plan if it was not
                </span>
              </li>
            </ol>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> This page explains the theory. To build a
                model in the visual editor, see the{" "}
                <Link
                  href="/docs/web/states"
                  className="text-primary hover:underline"
                >
                  Qontinui Web how-to guides
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
              title="State Machines"
              description="How visual states form the nodes of the model"
              href="/docs/concepts/states"
            />
            <NextStepCard
              title="Transitions & Pathfinding"
              description="How the engine navigates between states"
              href="/docs/concepts/transitions"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface BlockCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}

function BlockCard({
  icon,
  title,
  description,
  href,
  linkLabel,
}: BlockCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground mb-3">{description}</p>
          <Link href={href} className="text-sm text-primary hover:underline">
            {linkLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

interface BenefitCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function BenefitCard({ icon, title, description }: BenefitCardProps) {
  return (
    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold text-foreground mb-1">{title}</h4>
          <p className="text-sm text-foreground">{description}</p>
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
