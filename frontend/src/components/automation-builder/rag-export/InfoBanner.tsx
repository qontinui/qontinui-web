"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";

export function InfoBanner() {
  return (
    <Card className="border-blue-500/30 bg-blue-950/20">
      <CardContent className="flex items-start gap-3 py-4">
        <Info className="w-5 h-5 text-blue-400 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-blue-300">About RAG Export</p>
          <p className="text-sm text-blue-200/70 mt-1">
            RAG (Retrieval-Augmented Generation) export creates a configuration
            optimized for AI-powered automation. Elements are structured for
            vector database indexing, enabling semantic search to find UI
            components using natural language queries like &quot;login
            button&quot; or &quot;submit form&quot;.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
