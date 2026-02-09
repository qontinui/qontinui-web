"use client";

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  ApiRequestStep,
  HttpMethod,
  ApiContentType,
  ApiVariableExtraction,
  ApiAssertion,
} from "@/types/unified-workflow";

interface ApiRequestStepEditorProps {
  isOpen: boolean;
  onClose: () => void;
  step: ApiRequestStep;
  onSave: (updates: Partial<ApiRequestStep>) => void;
}

export function ApiRequestStepEditor({
  isOpen,
  onClose,
  step,
  onSave,
}: ApiRequestStepEditorProps) {
  const [method, setMethod] = useState<HttpMethod>(step.method);
  const [url, setUrl] = useState(step.url);
  const [headers, setHeaders] = useState<Record<string, string>>(
    step.headers ?? {}
  );
  const [body, setBody] = useState(step.body ?? "");
  const [contentType, setContentType] = useState<ApiContentType>(
    step.content_type ?? "application/json"
  );
  const [timeoutMs, setTimeoutMs] = useState(step.timeout_ms ?? 30000);
  const [extractions, setExtractions] = useState<ApiVariableExtraction[]>(
    step.extractions ?? []
  );
  const [assertions, setAssertions] = useState<ApiAssertion[]>(
    step.assertions ?? []
  );
  const [outputVariable, setOutputVariable] = useState(
    step.output_variable ?? ""
  );

  const [newHeaderKey, setNewHeaderKey] = useState("");
  const [newHeaderValue, setNewHeaderValue] = useState("");

  const handleSave = () => {
    onSave({
      method,
      url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body || undefined,
      content_type: contentType !== "none" ? contentType : undefined,
      timeout_ms: timeoutMs,
      extractions: extractions.length > 0 ? extractions : undefined,
      assertions: assertions.length > 0 ? assertions : undefined,
      output_variable: outputVariable || undefined,
    });
    onClose();
  };

  const addHeader = () => {
    if (newHeaderKey) {
      setHeaders({ ...headers, [newHeaderKey]: newHeaderValue });
      setNewHeaderKey("");
      setNewHeaderValue("");
    }
  };

  const removeHeader = (key: string) => {
    const next = { ...headers };
    delete next[key];
    setHeaders(next);
  };

  const addExtraction = () => {
    setExtractions([...extractions, { variable_name: "", json_path: "" }]);
  };

  const updateExtraction = (
    index: number,
    updates: Partial<ApiVariableExtraction>
  ) => {
    const next = [...extractions];
    next[index] = { ...next[index], ...updates } as ApiVariableExtraction;
    setExtractions(next);
  };

  const removeExtraction = (index: number) => {
    setExtractions(extractions.filter((_, i) => i !== index));
  };

  const addAssertion = () => {
    setAssertions([...assertions, { type: "status_code", expected: 200 }]);
  };

  const updateAssertion = (index: number, updates: Partial<ApiAssertion>) => {
    const next = [...assertions];
    next[index] = { ...next[index], ...updates } as ApiAssertion;
    setAssertions(next);
  };

  const removeAssertion = (index: number) => {
    setAssertions(assertions.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>API Request Editor</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            {/* Method + URL */}
            <div className="flex gap-2">
              <div className="w-28">
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Method
                </label>
                <Select
                  value={method}
                  onValueChange={(v: HttpMethod) => setMethod(v)}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      ["GET", "POST", "PUT", "PATCH", "DELETE"] as HttpMethod[]
                    ).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  URL
                </label>
                <Input
                  className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  placeholder="https://api.example.com/endpoint"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            </div>

            {/* Content Type */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Content Type
              </label>
              <Select
                value={contentType}
                onValueChange={(v: ApiContentType) => setContentType(v)}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="application/json">JSON</SelectItem>
                  <SelectItem value="application/x-www-form-urlencoded">
                    Form URL Encoded
                  </SelectItem>
                  <SelectItem value="text/plain">Text</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Headers */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Headers
              </label>
              {Object.entries(headers).map(([key, value]) => (
                <div key={key} className="flex gap-2 mb-1">
                  <Input
                    className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    value={key}
                    readOnly
                  />
                  <Input
                    className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    value={value}
                    readOnly
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-400"
                    onClick={() => removeHeader(key)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  placeholder="Header name"
                  value={newHeaderKey}
                  onChange={(e) => setNewHeaderKey(e.target.value)}
                />
                <Input
                  className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  placeholder="Value"
                  value={newHeaderValue}
                  onChange={(e) => setNewHeaderValue(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={addHeader}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Body */}
            {method !== "GET" && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Request Body
                </label>
                <Textarea
                  className="min-h-[100px] font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  placeholder='{"key": "value"}'
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
            )}

            {/* Timeout */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Timeout (ms)
              </label>
              <Input
                type="number"
                className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                value={timeoutMs}
                onChange={(e) =>
                  setTimeoutMs(parseInt(e.target.value) || 30000)
                }
              />
            </div>

            {/* Output variable */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Output Variable
              </label>
              <Input
                className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                placeholder="Variable name to store response"
                value={outputVariable}
                onChange={(e) => setOutputVariable(e.target.value)}
              />
            </div>

            {/* Variable Extractions */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-400">
                  Variable Extractions
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={addExtraction}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              {extractions.map((ext, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <Input
                    className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    placeholder="Variable name"
                    value={ext.variable_name}
                    onChange={(e) =>
                      updateExtraction(i, { variable_name: e.target.value })
                    }
                  />
                  <Input
                    className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    placeholder="$.data.id"
                    value={ext.json_path}
                    onChange={(e) =>
                      updateExtraction(i, { json_path: e.target.value })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-400"
                    onClick={() => removeExtraction(i)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Assertions */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-400">
                  Assertions
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={addAssertion}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              {assertions.map((assertion, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <Select
                    value={assertion.type}
                    onValueChange={(v) =>
                      updateAssertion(i, { type: v as ApiAssertion["type"] })
                    }
                  >
                    <SelectTrigger className="w-40 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="status_code">Status Code</SelectItem>
                      <SelectItem value="json_path">JSON Path</SelectItem>
                      <SelectItem value="header">Header</SelectItem>
                      <SelectItem value="body_contains">
                        Body Contains
                      </SelectItem>
                      <SelectItem value="response_time">
                        Response Time
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    placeholder="Expected value"
                    value={String(assertion.expected)}
                    onChange={(e) =>
                      updateAssertion(i, { expected: e.target.value })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-400"
                    onClick={() => removeAssertion(i)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
