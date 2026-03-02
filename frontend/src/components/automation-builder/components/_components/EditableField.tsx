import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EditableFieldBaseProps {
  label: string;
  htmlFor: string;
  isEditing: boolean;
  displayValue: string;
  onStartEditing: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  displayClassName?: string;
}

interface TextFieldProps extends EditableFieldBaseProps {
  type: "text";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  dataUiId?: string;
  dataTutorialId?: string;
}

interface TextareaFieldProps extends EditableFieldBaseProps {
  type: "textarea";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  dataUiId?: string;
}

interface SelectFieldProps extends EditableFieldBaseProps {
  type: "select";
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  dataUiId?: string;
}

type EditableFieldProps =
  | TextFieldProps
  | TextareaFieldProps
  | SelectFieldProps;

function ReadOnlyDisplay({
  displayValue,
  onStartEditing,
  className,
}: {
  displayValue: string;
  onStartEditing: () => void;
  className?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onStartEditing}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStartEditing();
        }
      }}
      className={`px-3 py-2 bg-surface-canvas border border-border-subtle rounded-md cursor-pointer hover:border-border-default transition-colors ${className || ""}`}
    >
      <span className="text-white">{displayValue}</span>
    </div>
  );
}

export function EditableField(props: EditableFieldProps) {
  const { label, htmlFor, isEditing, displayValue, onStartEditing } = props;

  return (
    <div className="mb-4">
      <Label
        htmlFor={htmlFor}
        className="text-sm font-medium text-text-muted mb-1.5"
      >
        {label}
      </Label>
      {isEditing ? (
        <EditingInput {...props} />
      ) : (
        <ReadOnlyDisplay
          displayValue={displayValue}
          onStartEditing={onStartEditing}
          className={props.type === "textarea" ? "min-h-[80px]" : undefined}
        />
      )}
    </div>
  );
}

function EditingInput(props: EditableFieldProps) {
  const { htmlFor, onKeyDown } = props;

  if (props.type === "text") {
    return (
      <Input
        id={htmlFor}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={onKeyDown}
        data-tutorial-id={props.dataTutorialId}
        data-ui-id={props.dataUiId}
        className="bg-surface-canvas border-border-default text-white"
        placeholder={props.placeholder}
      />
    );
  }

  if (props.type === "textarea") {
    return (
      <Textarea
        id={htmlFor}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="bg-surface-canvas border-border-default text-white min-h-[80px]"
        placeholder={props.placeholder}
        data-ui-id={props.dataUiId}
      />
    );
  }

  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger
        className="bg-surface-canvas border-border-default text-white"
        data-ui-id={props.dataUiId}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
