import React from "react";

interface NameFieldProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const NameField: React.FC<NameFieldProps> = ({ value, onChange }) => (
  <div>
    <label
      htmlFor="lpp-name"
      className="block text-sm font-medium text-text-secondary mb-1"
    >
      Name
    </label>
    <input
      id="lpp-name"
      type="text"
      value={value}
      onChange={onChange}
      className="w-full px-3 py-2 border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-text-primary"
    />
  </div>
);

export default NameField;
