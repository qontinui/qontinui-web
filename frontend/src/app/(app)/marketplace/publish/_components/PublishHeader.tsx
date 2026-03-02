"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PublishHeaderProps {
  onBack: () => void;
}

export function PublishHeader({ onBack }: PublishHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <h1 className="text-lg font-semibold text-foreground">
          Publish Package
        </h1>
        <span className="text-sm text-muted-foreground">
          Share your automation code with the community
        </span>
      </div>
    </div>
  );
}
