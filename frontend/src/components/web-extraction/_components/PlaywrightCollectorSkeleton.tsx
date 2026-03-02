"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function PlaywrightCollectorSkeleton() {
  return (
    <div className="space-y-4 pb-6">
      <Card className="border-cyan-500/30 bg-cyan-500/5 animate-pulse">
        <CardHeader className="py-3">
          <div className="h-4 w-24 bg-cyan-500/20 rounded" />
        </CardHeader>
        <CardContent>
          <div className="h-10 w-full bg-cyan-500/10 rounded" />
        </CardContent>
      </Card>
      <Card className="border-purple-500/30 bg-purple-500/5 animate-pulse">
        <CardHeader className="py-3">
          <div className="h-4 w-32 bg-purple-500/20 rounded" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-10 w-full bg-purple-500/10 rounded" />
          <div className="h-10 w-full bg-purple-500/10 rounded" />
        </CardContent>
      </Card>
    </div>
  );
}
