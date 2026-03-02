import React from "react";

interface SuccessConfigProps {
  actionSuccess: boolean;
  resultSuccess: boolean;
  onActionSuccessChange: (value: boolean) => void;
  onResultSuccessChange: (value: boolean) => void;
}

export const SuccessConfig: React.FC<SuccessConfigProps> = ({
  actionSuccess,
  resultSuccess,
  onActionSuccessChange,
  onResultSuccessChange,
}) => {
  return (
    <div className="space-y-2">
      <h3 className="font-medium">Success Configuration</h3>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={actionSuccess}
          onChange={(e) => onActionSuccessChange(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-sm">Action succeeds</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={resultSuccess}
          onChange={(e) => onResultSuccessChange(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-sm">Result succeeds</span>
      </label>
    </div>
  );
};
