import React from "react";

interface DurationInputProps {
  duration: number;
  onChange: (value: number) => void;
}

export const DurationInput: React.FC<DurationInputProps> = ({
  duration,
  onChange,
}) => {
  return (
    <div>
      <label htmlFor="asb-duration" className="block text-sm font-medium mb-1">
        Expected Duration (ms)
      </label>
      <input
        id="asb-duration"
        type="number"
        min="0"
        value={duration}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full px-3 py-1 border rounded"
      />
    </div>
  );
};
