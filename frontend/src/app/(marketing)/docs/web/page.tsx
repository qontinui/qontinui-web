import Link from "next/link";
import {
  Globe,
  Box,
  Zap,
  GitBranch,
  Play,
  Keyboard,
  Sparkles,
} from "lucide-react";

export const metadata = {
  title: "Qontinui Web Documentation - Visual Automation Builder",
  description:
    "Complete guide to building GUI automation workflows with Qontinui Web's visual configuration builder.",
};

export default function WebDocsPage() {
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
            Qontinui Web
          </h1>
          <p className="text-xl text-muted-foreground">
            Visual configuration builder for creating intelligent GUI automation
            workflows
          </p>
        </div>

        {/* What is Qontinui Web */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What is Qontinui Web?
          </h2>
          <p className="text-foreground mb-4">
            Qontinui Web is a browser-based visual builder that lets you create
            sophisticated GUI automation workflows without writing code. It uses
            a <strong>model-based approach</strong> where you define:
          </p>
          <ul className="space-y-2 text-foreground ml-6">
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>
                <strong>States</strong> - Different screens or conditions in
                your application
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>
                <strong>Actions</strong> - Operations to perform (click, type,
                wait, etc.)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>
                <strong>Transitions</strong> - How to navigate between states
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">•</span>
              <span>
                <strong>Images</strong> - Visual elements for state
                identification and targeting
              </span>
            </li>
          </ul>

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mt-6">
            <p className="text-sm text-foreground">
              <strong>Mock Execution:</strong> Test your automation logic
              directly in the browser without requiring a real GUI environment.
              Perfect for rapid iteration and development.
            </p>
          </div>
        </section>

        {/* Documentation Sections */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Documentation Sections
          </h2>
          <div className="grid gap-4">
            <DocLink
              icon={<Box className="w-5 h-5" />}
              title="Working with States"
              description="Define application states, add identifying images, and configure state properties"
              href="/docs/web/states"
            />
            <DocLink
              icon={<Zap className="w-5 h-5" />}
              title="Action Types"
              description="Learn about all available actions: click, type, find, wait, and more"
              href="/docs/web/actions"
            />
            <DocLink
              icon={<Sparkles className="w-5 h-5" />}
              title="AI Actions"
              description="Integrate AI-powered automation: prompts, sequences, and checkpoint workflows"
              href="/docs/web/ai-actions"
            />
            <DocLink
              icon={<GitBranch className="w-5 h-5" />}
              title="State Transitions"
              description="Connect states with transitions and build your automation flow"
              href="/docs/web/transitions"
            />
            <DocLink
              icon={<Play className="w-5 h-5" />}
              title="Mock Testing"
              description="Test your automation logic in the browser before deploying"
              href="/docs/web/testing"
            />
            <DocLink
              icon={<Keyboard className="w-5 h-5" />}
              title="Keyboard Shortcuts"
              description="Master shortcuts and modifier keys for efficient workflow building"
              href="/docs/web/keyboard-shortcuts"
            />
          </div>
        </section>

        {/* Key Concepts */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Key Concepts
          </h2>

          <div className="space-y-6">
            <ConceptSection
              title="Model-Based Automation"
              description="Unlike traditional script-based automation, Qontinui uses a state machine model. This means:"
              points={[
                "Automation adapts to unexpected changes (dialog boxes, popups)",
                "State identification is visual, not position-based",
                "Built-in pathfinding navigates through complex workflows",
                "Easier to maintain and update as applications change",
              ]}
            />

            <ConceptSection
              title="State Identification"
              description="States are identified by visual elements (images) on screen:"
              points={[
                "Upload screenshots of unique UI elements for each state",
                "Set similarity thresholds for fuzzy matching",
                "Mark images as required or optional",
                "Multiple images can identify a single state",
              ]}
            />

            <ConceptSection
              title="Visual Action Targeting"
              description="Actions can target elements visually:"
              points={[
                "Click on images instead of hardcoded coordinates",
                "Actions adapt to element positions automatically",
                "Support for offset clicks relative to images",
                "Fallback to coordinate-based actions when needed",
              ]}
            />
          </div>
        </section>

        {/* Workflow */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Typical Workflow
          </h2>
          <div className="space-y-4">
            <WorkflowStep
              number={1}
              title="Create Your Project"
              description="Start a new automation project and give it a descriptive name"
            />
            <WorkflowStep
              number={2}
              title="Define States"
              description="Add all the different screens/states in your application workflow"
            />
            <WorkflowStep
              number={3}
              title="Upload Identifying Images"
              description="Capture screenshots of unique UI elements for state identification"
            />
            <WorkflowStep
              number={4}
              title="Add Transitions"
              description="Connect states and define the actions to perform during transitions"
            />
            <WorkflowStep
              number={5}
              title="Test with Mock Execution"
              description="Validate your automation logic in the browser"
            />
            <WorkflowStep
              number={6}
              title="Export Configuration"
              description="Download the JSON configuration for use with Qontinui Runner"
            />
          </div>
        </section>

        {/* Features */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Advanced Features
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <FeatureCard
              title="Parallel States"
              description="Multiple states can be active simultaneously for complex UIs with overlays or multi-panel layouts"
            />
            <FeatureCard
              title="Conditional Actions"
              description="Actions can have conditions and continue-on-error flags for robust error handling"
            />
            <FeatureCard
              title="Image Library"
              description="Reuse images across multiple states and actions with a centralized image library"
            />
            <FeatureCard
              title="Export/Import"
              description="Save your work as JSON and share configurations with team members"
            />
          </div>
        </section>

        {/* Getting Started CTA */}
        <section className="bg-primary/5 border border-primary/20 rounded-lg p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Ready to Build Your First Automation?
          </h2>
          <p className="text-muted-foreground mb-6">
            Sign up for free and start building intelligent GUI automation
            workflows today.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="https://qontinui.com"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-semibold transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Globe className="w-5 h-5" />
              Open Qontinui Web
            </Link>
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              Getting Started Guide →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

interface DocLinkProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
}

function DocLink({ icon, title, description, href }: DocLinkProps) {
  return (
    <Link
      href={href}
      className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <div className="flex items-start gap-4">
        <div className="text-primary mt-1">{icon}</div>
        <div>
          <h3 className="font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </Link>
  );
}

interface ConceptSectionProps {
  title: string;
  description: string;
  points: string[];
}

function ConceptSection({ title, description, points }: ConceptSectionProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground mb-3">{description}</p>
      <ul className="space-y-1 ml-6">
        {points.map((point, idx) => (
          <li key={idx} className="text-foreground flex items-start gap-2">
            <span className="text-primary">•</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface WorkflowStepProps {
  number: number;
  title: string;
  description: string;
}

function WorkflowStep({ number, title, description }: WorkflowStepProps) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

interface FeatureCardProps {
  title: string;
  description: string;
}

function FeatureCard({ title, description }: FeatureCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
