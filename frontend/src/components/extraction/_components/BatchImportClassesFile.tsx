"use client";

import { Label } from "@/components/ui/label";

interface BatchImportClassesFileProps {
  importing: boolean;
  classesContent: string;
  classesInputRef: React.RefObject<HTMLInputElement | null>;
  onClassesFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function BatchImportClassesFile({
  importing,
  classesContent,
  classesInputRef,
  onClassesFileSelect,
}: BatchImportClassesFileProps) {
  return (
    <div className="space-y-2">
      <Label>Classes File (optional)</Label>
      <div
        className="border-2 border-dashed rounded-lg p-3 text-center cursor-pointer hover:border-primary/50 transition-colors"
        role="button"
        tabIndex={0}
        onClick={() => !importing && classesInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!importing) classesInputRef.current?.click();
          }
        }}
      >
        <input
          ref={classesInputRef}
          type="file"
          accept=".txt"
          onChange={onClassesFileSelect}
          className="hidden"
        />
        {classesContent ? (
          <span className="text-sm text-primary">classes.txt loaded</span>
        ) : (
          <p className="text-sm text-muted-foreground">
            Upload classes.txt for class names
          </p>
        )}
      </div>
    </div>
  );
}
