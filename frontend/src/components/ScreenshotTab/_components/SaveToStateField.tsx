import React from "react";
import { State } from "../../../contexts/automation-context/types";

interface SaveToStateFieldProps {
  stateId: string;
  states: State[];
  onChange: (stateId: string) => void;
}

const SaveToStateField: React.FC<SaveToStateFieldProps> = ({
  stateId,
  states,
  onChange,
}) => (
  <div>
    <label
      htmlFor="lpp-state"
      className="block text-sm font-medium text-text-secondary mb-1"
    >
      Save to State
    </label>
    <select
      id="lpp-state"
      value={stateId || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-text-primary"
    >
      <option value="">Select state</option>
      {states.map((state) => (
        <option key={state.id} value={state.id}>
          {state.name}
        </option>
      ))}
    </select>
  </div>
);

export default SaveToStateField;
