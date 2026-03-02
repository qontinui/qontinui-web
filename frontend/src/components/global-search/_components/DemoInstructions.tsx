"use client";

export function DemoInstructions() {
  return (
    <div className="p-6 border rounded-lg bg-card space-y-4">
      <h2 className="text-xl font-semibold">How to Test</h2>

      <div className="space-y-3">
        <div>
          <h3 className="font-medium mb-2">1. Open Search</h3>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li>
              Press{" "}
              <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">
                Cmd/Ctrl + K
              </kbd>
            </li>
            <li>Or click the &quot;Search...&quot; button above</li>
          </ul>
        </div>

        <div>
          <h3 className="font-medium mb-2">2. Try These Searches</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="p-3 bg-secondary/50 rounded text-sm">
              <code>login</code> - Find login-related items
            </div>
            <div className="p-3 bg-secondary/50 rounded text-sm">
              <code>type:workflow</code> - Search workflows only
            </div>
            <div className="p-3 bg-secondary/50 rounded text-sm">
              <code>export</code> - Find export workflow
            </div>
            <div className="p-3 bg-secondary/50 rounded text-sm">
              <code>type:state dashboard</code> - Find dashboard state
            </div>
            <div className="p-3 bg-secondary/50 rounded text-sm">
              <code>button</code> - Find button images
            </div>
            <div className="p-3 bg-secondary/50 rounded text-sm">
              <code>type:folder auth</code> - Find auth folder
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-medium mb-2">3. Navigation</h3>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li>
              Use{" "}
              <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">↑</kbd>{" "}
              <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">↓</kbd>{" "}
              arrow keys to navigate
            </li>
            <li>
              Press{" "}
              <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">
                Enter
              </kbd>{" "}
              to select
            </li>
            <li>
              Press{" "}
              <kbd className="px-2 py-0.5 bg-secondary rounded text-xs">
                ESC
              </kbd>{" "}
              to close
            </li>
          </ul>
        </div>

        <div>
          <h3 className="font-medium mb-2">4. Filters</h3>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li>Click type badges to filter by resource type</li>
            <li>Use multiple filters together</li>
            <li>Clear filters by clicking again</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
