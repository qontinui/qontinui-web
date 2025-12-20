import Link from "next/link";
import { Keyboard, Move, GitBranch, MousePointer } from "lucide-react";

export const metadata = {
  title: "Keyboard Shortcuts - Qontinui Web Documentation",
  description:
    "Learn keyboard shortcuts and modifier keys for efficient workflow building in Qontinui Web.",
};

export default function KeyboardShortcutsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/web"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Web Documentation
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Keyboard Shortcuts
          </h1>
          <p className="text-xl text-muted-foreground">
            Master keyboard shortcuts and modifier keys for efficient workflow
            building in Qontinui Web
          </p>
        </div>

        {/* State Machine Editor Shortcuts */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-primary" />
            State Machine Editor
          </h2>
          <p className="text-foreground mb-6">
            These shortcuts work in the State Machine page (/states) for
            managing states and transitions.
          </p>

          <div className="space-y-4">
            <ShortcutCategory title="StateImage Operations">
              <ShortcutItem
                keys={["Drag"]}
                description="Drag from the purple dot below a StateImage thumbnail to create a transition to another state"
              />
              <ShortcutItem
                keys={["Alt", "Drag"]}
                alternativeKeys={["Option", "Drag"]}
                description="Move a StateImage from one state to another instead of creating a transition"
                highlight
              />
            </ShortcutCategory>

            <ShortcutCategory title="Canvas Navigation">
              <ShortcutItem
                keys={["Scroll"]}
                description="Zoom in/out on the canvas"
              />
              <ShortcutItem
                keys={["Click + Drag"]}
                description="Pan around the canvas"
              />
            </ShortcutCategory>

            <ShortcutCategory title="Selection">
              <ShortcutItem
                keys={["Click"]}
                description="Select a state or transition node"
              />
              <ShortcutItem
                keys={["Escape"]}
                description="Deselect current selection"
              />
            </ShortcutCategory>
          </div>
        </section>

        {/* Modifier Keys Reference */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Keyboard className="w-6 h-6 text-primary" />
            Modifier Keys Reference
          </h2>

          <div className="bg-card border border-border rounded-lg p-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-foreground mb-3">Windows</h3>
                <ul className="space-y-2 text-foreground">
                  <li className="flex items-center gap-2">
                    <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono">
                      Alt
                    </kbd>
                    <span>Move operations (Alt+Drag)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono">
                      Ctrl
                    </kbd>
                    <span>Multi-select (future)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono">
                      Shift
                    </kbd>
                    <span>Constrain movement (future)</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-3">macOS</h3>
                <ul className="space-y-2 text-foreground">
                  <li className="flex items-center gap-2">
                    <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono">
                      Option
                    </kbd>
                    <span>Move operations (Option+Drag)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono">
                      Cmd
                    </kbd>
                    <span>Multi-select (future)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono">
                      Shift
                    </kbd>
                    <span>Constrain movement (future)</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Moving StateImages Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <Move className="w-6 h-6 text-primary" />
            Moving StateImages Between States
          </h2>

          <p className="text-foreground mb-6">
            There are two ways to move StateImages from one state to another:
          </p>

          <div className="space-y-6">
            <MethodCard
              title="Method 1: Properties Panel (Recommended)"
              steps={[
                "Select the source state in the canvas",
                "In the right panel, find the StateImage you want to move",
                "Click the arrow icon (↔) next to the StateImage name",
                "Select the target state from the dropdown menu",
                "The StateImage will be moved instantly",
              ]}
            />

            <MethodCard
              title="Method 2: Alt/Option + Drag on Canvas"
              steps={[
                "Locate the StateImage thumbnail in the state node on the canvas",
                "Hold Alt (Windows) or Option (macOS)",
                "Drag from the purple dot below the thumbnail",
                "Drop on the target state node",
                "The StateImage will be moved to the target state",
              ]}
              tip="Without Alt/Option, dragging creates a transition instead of moving the StateImage"
            />
          </div>
        </section>

        {/* Tips Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
            <MousePointer className="w-6 h-6 text-primary" />
            Tips & Best Practices
          </h2>

          <div className="space-y-4">
            <TipCard
              title="Drag Handle Location"
              description="The purple drag handle appears below each StateImage thumbnail in the state node. Hover over a thumbnail to see it."
            />
            <TipCard
              title="Visual Feedback"
              description="When dragging without Alt/Option, you're creating a transition. The cursor shows a link icon. When Alt/Option is held, you're moving the StateImage."
            />
            <TipCard
              title="Undo Moves"
              description="If you accidentally move a StateImage to the wrong state, you can move it again using either method to place it correctly."
            />
          </div>
        </section>

        {/* Related Documentation */}
        <section className="bg-gradient-to-r from-primary/10 to-green-500/10 border border-primary/30 rounded-lg p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Related Documentation
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Link
              href="/docs/web/states"
              className="block bg-background p-4 rounded-lg border border-border hover:border-primary/50 transition-colors"
            >
              <h3 className="font-semibold text-foreground mb-1">
                Working with States
              </h3>
              <p className="text-sm text-muted-foreground">
                Learn about states, StateImages, and state properties
              </p>
            </Link>
            <Link
              href="/docs/web/transitions"
              className="block bg-background p-4 rounded-lg border border-border hover:border-primary/50 transition-colors"
            >
              <h3 className="font-semibold text-foreground mb-1">
                State Transitions
              </h3>
              <p className="text-sm text-muted-foreground">
                Connect states with transitions and define automation flow
              </p>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

interface ShortcutCategoryProps {
  title: string;
  children: React.ReactNode;
}

function ShortcutCategory({ title, children }: ShortcutCategoryProps) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="bg-muted px-4 py-2 border-b border-border">
        <h3 className="font-semibold text-foreground">{title}</h3>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

interface ShortcutItemProps {
  keys: string[];
  alternativeKeys?: string[];
  description: string;
  highlight?: boolean;
}

function ShortcutItem({
  keys,
  alternativeKeys,
  description,
  highlight,
}: ShortcutItemProps) {
  return (
    <div
      className={`px-4 py-3 flex items-center justify-between gap-4 ${
        highlight ? "bg-primary/10" : ""
      }`}
    >
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1">
          {keys.map((key, idx) => (
            <span key={idx} className="flex items-center gap-1">
              {idx > 0 && (
                <span className="text-muted-foreground text-sm">+</span>
              )}
              <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono text-foreground">
                {key}
              </kbd>
            </span>
          ))}
        </div>
        {alternativeKeys && (
          <>
            <span className="text-muted-foreground text-sm">/</span>
            <div className="flex items-center gap-1">
              {alternativeKeys.map((key, idx) => (
                <span key={idx} className="flex items-center gap-1">
                  {idx > 0 && (
                    <span className="text-muted-foreground text-sm">+</span>
                  )}
                  <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono text-foreground">
                    {key}
                  </kbd>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <p className="text-foreground text-sm text-right">{description}</p>
    </div>
  );
}

interface MethodCardProps {
  title: string;
  steps: string[];
  tip?: string;
}

function MethodCard({ title, steps, tip }: MethodCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h3 className="font-semibold text-foreground mb-4">{title}</h3>
      <ol className="space-y-2 mb-4">
        {steps.map((step, idx) => (
          <li key={idx} className="flex items-start gap-3 text-foreground">
            <span className="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
              {idx + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {tip && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-sm text-foreground">
          <strong>Tip:</strong> {tip}
        </div>
      )}
    </div>
  );
}

interface TipCardProps {
  title: string;
  description: string;
}

function TipCard({ title, description }: TipCardProps) {
  return (
    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-foreground">{description}</p>
    </div>
  );
}
