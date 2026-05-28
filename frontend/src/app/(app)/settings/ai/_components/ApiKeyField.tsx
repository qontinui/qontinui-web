import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, KeyRound, Trash2 } from "lucide-react";

interface ApiKeyFieldProps {
  providerKey: string;
  placeholder: string;
  statusLabel: string;
  isConfigured: boolean;
  keyInput: string;
  onKeyInputChange: (value: string) => void;
  onSave: (
    providerKey: string,
    key: string,
    setConfigured: (v: boolean) => void,
    setInput: (v: string) => void
  ) => void;
  onDelete: (providerKey: string, setConfigured: (v: boolean) => void) => void;
  setConfigured: (v: boolean) => void;
  setKeyInput: (v: string) => void;
}

export function ApiKeyField({
  providerKey,
  placeholder,
  statusLabel,
  isConfigured,
  keyInput,
  onKeyInputChange,
  onSave,
  onDelete,
  setConfigured,
  setKeyInput,
}: ApiKeyFieldProps) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <KeyRound className="size-3.5" />
        API Key
      </Label>
      {isConfigured ? (
        <div className="flex items-center justify-between rounded-lg border border-green-500/20 bg-green-500/5 p-3">
          <div
            data-content-role="status"
            data-content-label={statusLabel}
            className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
          >
            <CheckCircle className="size-4" />
            API key configured securely
          </div>
          <DestructiveButton
            size="sm"
            onClick={() => onDelete(providerKey, setConfigured)}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </DestructiveButton>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={placeholder}
            value={keyInput}
            onChange={(e) => onKeyInputChange(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={() =>
              onSave(providerKey, keyInput, setConfigured, setKeyInput)
            }
          >
            Save Key
          </Button>
        </div>
      )}
    </div>
  );
}
