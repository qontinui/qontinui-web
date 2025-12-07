"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { MaskEditor } from "../mask-editor";
import { Edit } from "lucide-react";
import type { ExtractedPattern } from "@/types/pattern-optimization";
import { toast } from "sonner";

interface PatternEditorProps {
  pattern: ExtractedPattern;
  onUpdatePattern: (patternId: string, customMask: string) => void;
}

export const PatternEditor: React.FC<PatternEditorProps> = ({
  pattern,
  onUpdatePattern,
}) => {
  const [showMaskEditor, setShowMaskEditor] = useState(false);

  const handleSaveMask = (maskedImage: string) => {
    onUpdatePattern(pattern.id, maskedImage);
    setShowMaskEditor(false);
    toast.success("Pattern mask updated");
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setShowMaskEditor(true)}
        className="border-gray-700 hover:border-[#BD00FF]"
      >
        <Edit className="w-3 h-3 mr-1" />
        Edit Mask
      </Button>

      {showMaskEditor && (
        <MaskEditor
          imageUrl={pattern.imageUrl || pattern.patternImage}
          initialMask={pattern.customMask || pattern.maskImage}
          onSave={handleSaveMask}
          onCancel={() => setShowMaskEditor(false)}
          open={showMaskEditor}
        />
      )}
    </>
  );
};
