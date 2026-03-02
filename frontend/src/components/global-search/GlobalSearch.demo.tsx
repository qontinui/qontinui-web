"use client";

import { useState } from "react";
import { GlobalSearch } from "./GlobalSearch";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw } from "lucide-react";
import { useDemoSearchIndex } from "./_hooks/useDemoSearchIndex";
import { DemoStatsGrid } from "./_components/DemoStatsGrid";
import { DemoInstructions } from "./_components/DemoInstructions";
import { DemoDataPreview } from "./_components/DemoDataPreview";

export function GlobalSearchDemo() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { indexLoaded, handleReset } = useDemoSearchIndex();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Global Search Demo</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Test the global search component with mock data
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleReset} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset
              </Button>

              <button
                onClick={() => setSearchOpen(true)}
                disabled={!indexLoaded}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
                <span className="hidden md:inline">Search...</span>
                <kbd className="hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-2">
                  ⌘K
                </kbd>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <DemoStatsGrid />
          <DemoInstructions />
          <DemoDataPreview />
        </div>
      </main>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

export default GlobalSearchDemo;
