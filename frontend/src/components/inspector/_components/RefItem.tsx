import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Copy, Check } from "lucide-react";
import { getRoleBadgeVariant } from "../_utils";

export function RefItem({
  ref_id,
  role,
  name,
}: {
  ref_id: string;
  role: string;
  name?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(ref_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors group">
      <span className="text-[10px] font-mono text-blue-400 flex-shrink-0">
        {ref_id}
      </span>
      <Badge
        variant={getRoleBadgeVariant(role)}
        className="text-[9px] px-1 py-0"
      >
        {role}
      </Badge>
      {name && (
        <span className="text-[11px] text-text-muted truncate flex-1">
          {name}
        </span>
      )}
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-white"
        title="Copy ref"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}
