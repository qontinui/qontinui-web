import Link from "next/link";
import {
  Box,
  Image,
  MapPin,
  FileText,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export const metadata = {
  title: "Working with States - Qontinui Web Documentation",
  description:
    "Learn how to define states in Qontinui for model-based GUI automation using visual identification.",
};

export default function StatesDocPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/web"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Qontinui Web Docs
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Working with States
          </h1>
          <p className="text-xl text-muted-foreground">
            Define and identify application states using visual elements
          </p>
        </div>

        {/* What is a State */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What is a State?
          </h2>
          <p className="text-foreground mb-4">
            A <strong>State</strong> represents a distinct screen, dialog, or
            condition in your application. In model-based automation, states
            form the nodes of a state machine graph that defines your automation
            workflow.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: Visual Identification
            </h3>
            <p className="text-sm text-foreground">
              Unlike traditional automation that relies on hardcoded positions
              or element IDs, Qontinui identifies states{" "}
              <strong>visually</strong> by looking for identifying images on
              screen. This makes automation resilient to UI changes and
              resolution differences.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Examples of States:
            </h3>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <Box className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-foreground">
                  <strong>Login Screen</strong> - Identified by login form and
                  submit button
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Box className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-foreground">
                  <strong>Dashboard</strong> - Identified by navigation menu and
                  welcome message
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Box className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-foreground">
                  <strong>Error Dialog</strong> - Identified by error icon and
                  close button
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Creating a State */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Creating a State
          </h2>

          <div className="space-y-6">
            <StepCard
              number={1}
              title="Add a New State"
              description="Click the 'Add State' button in the state diagram panel"
            />

            <StepCard
              number={2}
              title="Name Your State"
              description="Give it a descriptive name like 'Login Screen' or 'Dashboard'. The name should clearly indicate what this state represents."
            />

            <StepCard
              number={3}
              title="Add a Description"
              description="Write a detailed description of when this state is active and what it represents in your application."
            />

            <StepCard
              number={4}
              title="Upload Identifying Images"
              description="Add screenshots of unique UI elements that identify this state. See the Identifying Images section below for details."
            />
          </div>
        </section>

        {/* Identifying Images */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Identifying Images
          </h2>

          <p className="text-foreground mb-6">
            Identifying images are visual elements that Qontinui uses to
            recognize when a state is active. When automation runs, Qontinui
            checks if all <strong>required</strong> identifying images are
            visible on screen to determine the current state.
          </p>

          <div className="bg-muted border border-border rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-4">
              Best Practices
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">
                    Choose Unique Elements
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    Select UI elements that only appear in this state (e.g.,
                    specific titles, icons, or buttons)
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">
                    Use Multiple Images
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    2-3 identifying images per state increases reliability and
                    reduces false matches
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">
                    Capture Clear Screenshots
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    Avoid blurry or low-contrast images. Higher quality = better
                    recognition
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Keep Images Small</strong>
                  <p className="text-sm text-muted-foreground">
                    Crop to just the identifying element (e.g., a button, not
                    the entire screen)
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Image Properties
            </h3>

            <PropertyCard
              icon={<Image className="w-5 h-5 text-purple-600" />}
              title="Similarity Threshold"
              description="Controls how closely the screen image must match your uploaded image (0.7-0.95 typical). Lower = more fuzzy matching, higher = exact matching required."
              defaultValue="0.85"
            />

            <PropertyCard
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
              title="Required"
              description="If checked, this image MUST be visible for the state to be considered active. Uncheck for optional images that only appear sometimes."
              defaultValue="Checked"
            />

            <PropertyCard
              icon={<Box className="w-5 h-5 text-primary" />}
              title="Shared"
              description="Check this if the image appears in multiple states (e.g., a common toolbar). Shared images alone don't uniquely identify a state."
              defaultValue="Unchecked"
            />
          </div>
        </section>

        {/* State Properties */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            State Properties
          </h2>

          <div className="space-y-4">
            <PropertyCard
              icon={<Box className="w-5 h-5 text-primary" />}
              title="Initial State"
              description="Mark one or more states as initial where automation begins. Multiple initial states are allowed for parallel starting conditions."
              isBoolean
            />

            <PropertyCard
              icon={<Box className="w-5 h-5 text-red-600" />}
              title="Final State"
              description="Mark states where automation should stop. Multiple final states are allowed for different end conditions."
              isBoolean
            />
          </div>
        </section>

        {/* Advanced: State Elements */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Advanced: Additional State Elements
          </h2>

          <p className="text-foreground mb-6">
            Beyond identifying images, states can contain additional elements
            for more complex automation:
          </p>

          <div className="grid gap-4">
            <ElementCard
              icon={<Box className="w-6 h-6 text-primary" />}
              title="State Regions"
              description="Define rectangular areas within the state for searching or interaction"
              examples={["Sidebar region", "Content area", "Button panel"]}
            />

            <ElementCard
              icon={<MapPin className="w-6 h-6 text-green-600" />}
              title="State Locations"
              description="Define specific point coordinates for precise clicking or positioning"
              examples={[
                "Submit button center",
                "Logo position",
                "Drag anchor point",
              ]}
            />

            <ElementCard
              icon={<FileText className="w-6 h-6 text-purple-600" />}
              title="State Strings"
              description="Define text values for identification, input, or verification"
              examples={[
                "Username field value",
                "Welcome message",
                "Error text pattern",
              ]}
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> Most automations only need identifying
                images. State regions, locations, and strings are advanced
                features for complex scenarios.
              </p>
            </div>
          </div>
        </section>

        {/* State Machine Concepts */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            State Machine Concepts
          </h2>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">
                Parallel States
              </h3>
              <p className="text-foreground mb-3">
                Multiple states can be active simultaneously. This is useful
                for:
              </p>
              <ul className="list-disc list-inside space-y-1 text-foreground ml-4">
                <li>Dialog boxes that appear over other screens</li>
                <li>
                  Multi-panel UIs where different sections have independent
                  states
                </li>
                <li>Persistent elements like navigation bars</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">
                State Verification
              </h3>
              <p className="text-foreground">
                Qontinui verifies states by template matching: it searches the
                screen for your identifying images and checks if all required
                images are found. This happens automatically before executing
                actions and during state transitions.
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
              title="Action Types"
              description="Learn how to perform actions within states"
              href="/docs/web/actions"
            />
            <NextStepCard
              title="State Transitions"
              description="Connect states to build your automation flow"
              href="/docs/web/transitions"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface StepCardProps {
  number: number;
  title: string;
  description: string;
}

function StepCard({ number, title, description }: StepCardProps) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-foreground">{description}</p>
      </div>
    </div>
  );
}

interface PropertyCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  defaultValue?: string;
  isBoolean?: boolean;
}

function PropertyCard({
  icon,
  title,
  description,
  defaultValue,
  isBoolean,
}: PropertyCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div className="flex-grow">
          <h4 className="font-semibold text-foreground mb-1">{title}</h4>
          <p className="text-sm text-muted-foreground mb-2">{description}</p>
          {defaultValue && (
            <p className="text-xs text-muted-foreground">
              Default:{" "}
              <span className="font-mono bg-muted border border-border px-1 rounded">
                {defaultValue}
              </span>
            </p>
          )}
          {isBoolean && (
            <p className="text-xs text-muted-foreground">
              Type:{" "}
              <span className="font-mono bg-muted border border-border px-1 rounded">
                Boolean (checkbox)
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ElementCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  examples: string[];
}

function ElementCard({ icon, title, description, examples }: ElementCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <h3 className="font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground mb-3">{description}</p>
          <div>
            <p className="text-xs text-muted-foreground font-semibold mb-1">
              Examples:
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {examples.map((example, idx) => (
                <li key={idx}>• {example}</li>
              ))}
            </ul>
          </div>
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
