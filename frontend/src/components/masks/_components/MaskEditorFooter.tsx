import React from "react";

export const MaskEditorFooter: React.FC = () => {
  return (
    <div className="text-sm text-text-muted">
      <p>• Use Brush to add to mask, Eraser to remove from mask</p>
      <p>• Hold Shift + drag or use middle mouse to pan</p>
      <p>• Purple overlay shows active mask areas</p>
    </div>
  );
};
