"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RAGExportRequest } from "@/services/rag-export-service";

interface ExportOptionsCardProps {
  options: RAGExportRequest;
  setOptions: React.Dispatch<React.SetStateAction<RAGExportRequest>>;
}

export function ExportOptionsCard({
  options,
  setOptions,
}: ExportOptionsCardProps) {
  return (
    <Card className="bg-surface-canvas border-border-subtle">
      <CardHeader>
        <CardTitle className="text-lg">Export Options</CardTitle>
        <CardDescription>
          Configure what to include in the RAG export
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Include OCR Text</Label>
            <p className="text-sm text-text-muted">
              Include extracted text from elements for text search
            </p>
          </div>
          <Switch
            checked={options.include_ocr}
            onCheckedChange={(checked) =>
              setOptions((prev) => ({ ...prev, include_ocr: checked }))
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Include Screenshots</Label>
            <p className="text-sm text-text-muted">
              Include full screenshot references (increases file size)
            </p>
          </div>
          <Switch
            checked={options.include_screenshots}
            onCheckedChange={(checked) =>
              setOptions((prev) => ({
                ...prev,
                include_screenshots: checked,
              }))
            }
          />
        </div>

        <Separator className="bg-border-default" />

        <div className="space-y-2">
          <Label>Embedding Model</Label>
          <Select
            value={options.embedding_model}
            onValueChange={(value) =>
              setOptions((prev) => ({ ...prev, embedding_model: value }))
            }
          >
            <SelectTrigger className="bg-surface-canvas border-border-default">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-MiniLM-L6-v2">
                all-MiniLM-L6-v2 (Fast, 384-dim)
              </SelectItem>
              <SelectItem value="all-mpnet-base-v2">
                all-mpnet-base-v2 (Balanced, 768-dim)
              </SelectItem>
              <SelectItem value="multi-qa-MiniLM-L6-cos-v1">
                multi-qa-MiniLM-L6-cos-v1 (QA optimized)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-text-muted">
            Model used for text embeddings in the runner
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
