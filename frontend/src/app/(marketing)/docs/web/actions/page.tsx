import Link from "next/link";

export const metadata = {
  title: "Action Types - Qontinui Web Documentation",
  description:
    "Complete reference for all action types available in Qontinui workflows.",
};

export default function ActionsDocPage() {
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
            Action Types
          </h1>
          <p className="text-xl text-muted-foreground">
            Complete reference for all automation actions in Qontinui
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What are Actions?
          </h2>
          <p className="text-foreground mb-4">
            Actions are the atomic operations performed during automation. They
            represent specific tasks like clicking a button, typing text, or
            finding an image on screen. Actions are organized into workflows and
            executed during state transitions.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: Action Categories
            </h3>
            <p className="text-sm text-foreground">
              Actions are organized into <strong>7 categories</strong> based on
              their purpose: Find, Mouse, Keyboard, Control Flow, Data, State,
              and Code. Each category groups related operations together for
              easy discovery in the workflow builder.
            </p>
          </div>
        </section>

        {/* Find Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Find Actions
          </h2>
          <p className="text-muted-foreground mb-6">
            Image matching and element detection on screen.
          </p>

          <div className="space-y-4">
            <ActionCard
              name="Find"
              type="FIND"
              description="Find element on screen using image matching"
            />
            <ActionCard
              name="Vanish"
              type="VANISH"
              description="Wait for element to disappear from screen"
            />
            <ActionCard
              name="RAG Find"
              type="RAG_FIND"
              description="Find element using AI embeddings (RAG)"
            />
          </div>
        </section>

        {/* Mouse Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Mouse Actions
          </h2>
          <p className="text-muted-foreground mb-6">
            Mouse interactions and movements.
          </p>

          <div className="space-y-4">
            <ActionCard
              name="Click"
              type="CLICK"
              description="Click on element (left, right, middle, or double)"
            />
            <ActionCard
              name="Mouse Move"
              type="MOUSE_MOVE"
              description="Move mouse cursor to position"
            />
            <ActionCard
              name="Mouse Down"
              type="MOUSE_DOWN"
              description="Press mouse button down"
            />
            <ActionCard
              name="Mouse Up"
              type="MOUSE_UP"
              description="Release mouse button"
            />
            <ActionCard
              name="Drag"
              type="DRAG"
              description="Drag element from one position to another"
            />
            <ActionCard
              name="Scroll"
              type="SCROLL"
              description="Scroll page or element"
            />
          </div>
        </section>

        {/* Keyboard Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Keyboard Actions
          </h2>
          <p className="text-muted-foreground mb-6">
            Keyboard input and shortcuts.
          </p>

          <div className="space-y-4">
            <ActionCard
              name="Type"
              type="TYPE"
              description="Type text into an element"
            />
            <ActionCard
              name="Key Press"
              type="KEY_PRESS"
              description="Press a single key"
            />
            <ActionCard
              name="Key Down"
              type="KEY_DOWN"
              description="Press key down (hold)"
            />
            <ActionCard name="Key Up" type="KEY_UP" description="Release key" />
            <ActionCard
              name="Hotkey"
              type="HOTKEY"
              description="Execute keyboard shortcut combination"
            />
          </div>
        </section>

        {/* Control Flow Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Control Flow Actions
          </h2>
          <p className="text-muted-foreground mb-6">
            Conditional logic and loops.
          </p>

          <div className="space-y-4">
            <ActionCard
              name="If"
              type="IF"
              description="Conditional branching based on condition"
            />
            <ActionCard
              name="Loop"
              type="LOOP"
              description="Repeat actions multiple times"
            />
            <ActionCard
              name="Break"
              type="BREAK"
              description="Exit from loop early"
            />
            <ActionCard
              name="Continue"
              type="CONTINUE"
              description="Skip to next loop iteration"
            />
            <ActionCard
              name="Switch"
              type="SWITCH"
              description="Multi-way branching based on value"
            />
            <ActionCard
              name="Try/Catch"
              type="TRY_CATCH"
              description="Error handling and recovery"
            />
          </div>
        </section>

        {/* Data Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Data Actions
          </h2>
          <p className="text-muted-foreground mb-6">
            Variables and data operations.
          </p>

          <div className="space-y-4">
            <ActionCard
              name="Set Variable"
              type="SET_VARIABLE"
              description="Store a value in a variable"
            />
            <ActionCard
              name="Get Variable"
              type="GET_VARIABLE"
              description="Retrieve a variable value"
            />
            <ActionCard
              name="Sort"
              type="SORT"
              description="Sort array or list of items"
            />
            <ActionCard
              name="Filter"
              type="FILTER"
              description="Filter array based on condition"
            />
            <ActionCard
              name="Map"
              type="MAP"
              description="Transform each item in array"
            />
            <ActionCard
              name="Reduce"
              type="REDUCE"
              description="Reduce array to single value"
            />
            <ActionCard
              name="String Operation"
              type="STRING_OPERATION"
              description="Manipulate text strings"
            />
            <ActionCard
              name="Math Operation"
              type="MATH_OPERATION"
              description="Perform mathematical calculations"
            />
          </div>
        </section>

        {/* State Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            State Actions
          </h2>
          <p className="text-muted-foreground mb-6">
            State management and process control.
          </p>

          <div className="space-y-4">
            <ActionCard
              name="Go To State"
              type="GO_TO_STATE"
              description="Navigate to a different workflow state"
            />
            <ActionCard
              name="Run Workflow"
              type="RUN_WORKFLOW"
              description="Execute another workflow"
            />
            <ActionCard
              name="Screenshot"
              type="SCREENSHOT"
              description="Capture screen or region"
            />
          </div>
        </section>

        {/* Code Actions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Code Actions
          </h2>
          <p className="text-muted-foreground mb-6">
            Python code execution, shell commands, and AI automation.
          </p>

          <h3 className="text-lg font-semibold text-foreground mb-3">Python</h3>
          <div className="space-y-4 mb-6">
            <ActionCard
              name="Code Block"
              type="CODE_BLOCK"
              description="Execute inline Python code with access to workflow context"
            />
            <ActionCard
              name="Custom Function"
              type="CUSTOM_FUNCTION"
              description="Execute pre-registered custom Python function"
            />
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-3">Shell</h3>
          <div className="space-y-4 mb-6">
            <ActionCard
              name="Run Command"
              type="SHELL"
              description="Execute a shell command and capture output"
            />
            <ActionCard
              name="Run Script"
              type="SHELL_SCRIPT"
              description="Execute a multi-line shell script"
            />
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-3">AI</h3>
          <div className="space-y-4">
            <ActionCard
              name="AI Prompt"
              type="AI_PROMPT"
              description="Execute an AI prompt with context isolation"
            />
          </div>

          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mt-6">
            <p className="text-sm text-foreground">
              <strong>Learn more:</strong> See the{" "}
              <Link
                href="/docs/web/ai-actions"
                className="text-purple-700 hover:text-purple-800 underline"
              >
                AI Actions documentation
              </Link>{" "}
              for detailed information on AI-powered automation.
            </p>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="AI Actions"
              description="Learn about AI-powered automation with Claude"
              href="/docs/web/ai-actions"
            />
            <NextStepCard
              title="State Transitions"
              description="Connect states using workflows"
              href="/docs/web/transitions"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface ActionCardProps {
  name: string;
  type: string;
  description: string;
}

function ActionCard({ name, type, description }: ActionCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-4">
      <div className="flex items-center gap-3 mb-2">
        <h4 className="font-semibold text-foreground">{name}</h4>
        <span className="text-xs font-mono bg-muted-foreground/20 px-2 py-0.5 rounded text-muted-foreground">
          {type}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
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
      className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
