"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Target } from "lucide-react";

interface TransitionConfigProps {
  onCreateOutgoing: () => void;
  onCreateIncoming: () => void;
}

export function TransitionConfig({
  onCreateOutgoing,
  onCreateIncoming,
}: TransitionConfigProps) {
  return (
    <Card className="border-border-default bg-surface-raised/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-text-muted">
          Use as Transition
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          onClick={onCreateOutgoing}
          className="w-full bg-brand-secondary hover:bg-brand-secondary/80 text-white"
        >
          <ArrowRight className="w-4 h-4 mr-2" />
          Create Outgoing Transition
        </Button>
        <Button
          onClick={onCreateIncoming}
          className="w-full bg-brand-success hover:bg-brand-success/80 text-black"
        >
          <Target className="w-4 h-4 mr-2" />
          Create Incoming Transition
        </Button>
      </CardContent>
    </Card>
  );
}
