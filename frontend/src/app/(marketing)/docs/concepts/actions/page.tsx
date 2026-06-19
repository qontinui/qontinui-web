import Link from "next/link";
import {
  MousePointerClick,
  Search,
  Target,
  Repeat,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

export const metadata = {
  title: "Action System - Qontinui Documentation",
  description:
    "The theory of actions in Qontinui: the atomic operations transitions perform, how they target elements visually, and how self-healing recovers from lookup failures.",
};

export default function ActionsConceptPage() {
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
            Action System
          </h1>
          <p className="text-xl text-muted-foreground">
            The atomic operations that carry out a transition
          </p>
        </div>

        {/* What are actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What Are Actions?
          </h2>
          <p className="text-foreground mb-4">
            <strong>Actions</strong> are the atomic operations of automation —
            clicking a button, typing text, finding an image, waiting for an
            element to vanish. Where{" "}
            <Link
              href="/docs/concepts/states"
              className="text-primary hover:underline"
            >
              states
            </Link>{" "}
            and{" "}
            <Link
              href="/docs/concepts/transitions"
              className="text-primary hover:underline"
            >
              transitions
            </Link>{" "}
            describe the structure of an application, actions are what the
            engine actually does when traversing a transition.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: Actions Target Elements Visually
            </h3>
            <p className="text-sm text-foreground">
              An action does not point at a fixed coordinate or a brittle
              selector. It targets an element by its{" "}
              <strong>visual appearance</strong> — the engine first{" "}
              <em>finds</em> the element on screen with{" "}
              <Link
                href="/docs/concepts/image-recognition"
                className="text-primary hover:underline"
              >
                template matching
              </Link>
              , then acts at the matched location. This keeps actions robust as
              the layout shifts.
            </p>
          </div>
        </section>

        {/* Categories */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Categories of Action
          </h2>
          <p className="text-foreground mb-6">
            Conceptually, actions fall into a few families. Together they let a
            transition observe the screen, manipulate input, branch on
            conditions, and orchestrate other work.
          </p>

          <div className="space-y-6">
            <CategoryCard
              icon={<Search className="w-6 h-6 text-primary" />}
              title="Find"
              description="Locate an element on screen, or wait for one to appear or disappear. Find is the foundation other actions build on — it resolves the target before any interaction happens."
            />
            <CategoryCard
              icon={<MousePointerClick className="w-6 h-6 text-green-600" />}
              title="Mouse & Keyboard"
              description="Drive real input: click, move, drag, scroll, type text, and press key combinations. These produce the actual interactions a user would perform."
            />
            <CategoryCard
              icon={<Repeat className="w-6 h-6 text-purple-600" />}
              title="Control Flow & Data"
              description="Branch on conditions, loop over items, and read or write variables — so a transition can express logic, not just a flat list of clicks."
            />
            <CategoryCard
              icon={<Target className="w-6 h-6 text-orange-600" />}
              title="State & Code"
              description="Coordinate the model itself (navigate to a state, run another workflow) and reach beyond the GUI when needed (run a script, invoke an AI prompt)."
            />
          </div>
        </section>

        {/* The find-then-act pattern */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            The Find-Then-Act Pattern
          </h2>
          <p className="text-foreground mb-6">
            Most interactions follow the same shape: resolve where the target
            is, then act there. Understanding this pattern explains why visual
            automation tolerates layout changes that break coordinate-based
            scripts.
          </p>

          <div className="bg-muted border border-border rounded-lg p-6">
            <ol className="space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">1.</span>
                <span>
                  The action names a <strong>target</strong> — typically a state
                  image
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">2.</span>
                <span>
                  The engine <strong>finds</strong> that target on the current
                  screen
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">3.</span>
                <span>
                  The action <strong>executes</strong> at the matched location
                  (e.g. clicks its center)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">4.</span>
                <span>
                  Because the location is resolved at run time, the element can
                  move without breaking the action
                </span>
              </li>
            </ol>
          </div>
        </section>

        {/* Self-healing */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Self-Healing
          </h2>
          <p className="text-foreground mb-6">
            When an element cannot be found at the expected confidence, the
            engine does not have to fail outright. Qontinui includes an optional{" "}
            <strong>self-healing</strong> system that attempts recovery before
            giving up.
          </p>

          <div className="space-y-4">
            <HealCard
              icon={<ShieldCheck className="w-5 h-5 text-green-600" />}
              title="Action caching"
              description="Successful element locations are remembered, so a repeat lookup can replay instantly instead of searching from scratch."
            />
            <HealCard
              icon={<Search className="w-5 h-5 text-green-600" />}
              title="Visual search fallback"
              description="When exact matching fails, the engine retries at lower similarity thresholds and multiple scales to find a near match."
            />
            <HealCard
              icon={<Target className="w-5 h-5 text-green-600" />}
              title="LLM assistance (optional)"
              description="A vision model — local or cloud — can locate an element from a natural-language description when template matching alone is not enough."
            />
          </div>
        </section>

        {/* Where to author */}
        <section className="mb-12">
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> This page covers the concepts. For the
                complete catalog of action types you can drop into a workflow,
                see the{" "}
                <Link
                  href="/docs/web/actions"
                  className="text-primary hover:underline"
                >
                  Action Types reference
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
              title="Visual Recognition"
              description="How actions resolve their targets on screen"
              href="/docs/concepts/image-recognition"
            />
            <NextStepCard
              title="Action Types (How-To)"
              description="The full action catalog in Qontinui Web"
              href="/docs/web/actions"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface CategoryCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function CategoryCard({ icon, title, description }: CategoryCardProps) {
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

interface HealCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function HealCard({ icon, title, description }: HealCardProps) {
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
