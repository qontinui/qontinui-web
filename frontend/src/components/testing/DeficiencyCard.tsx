"use client";

import { useState } from "react";
import { useUpdateDeficiency } from "@/hooks/useTesting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import Image from "next/image";
import type { Deficiency } from "@/services/testing-service";

interface DeficiencyCardProps {
  deficiency: Deficiency;
}

export function DeficiencyCard({ deficiency }: DeficiencyCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const updateDeficiency = useUpdateDeficiency();

  const handleStatusChange = async (newStatus: Deficiency["status"]) => {
    try {
      await updateDeficiency.mutateAsync({
        id: deficiency.id,
        data: { status: newStatus },
      });
      toast.success("Deficiency status updated");
    } catch (error) {
      toast.error("Failed to update status");
      console.error("Update failed:", error);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "high":
        return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "medium":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "low":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "in_progress":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "resolved":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "wont_fix":
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg bg-[#0A0A0B]/50 border border-gray-800/30 hover:border-gray-700/50 transition-colors">
        {/* Header */}
        <CollapsibleTrigger asChild>
          <div className="flex items-start gap-4 p-4 cursor-pointer">
            <div className="flex-shrink-0 mt-1">
              <AlertTriangle
                className={`w-5 h-5 ${
                  deficiency.severity === "critical" ||
                  deficiency.severity === "high"
                    ? "text-red-400"
                    : deficiency.severity === "medium"
                      ? "text-yellow-400"
                      : "text-blue-400"
                }`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4 mb-2">
                <h3 className="font-medium text-lg">{deficiency.title}</h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge className={getSeverityColor(deficiency.severity)}>
                    {deficiency.severity}
                  </Badge>
                  <Badge className={getStatusColor(deficiency.status)}>
                    {deficiency.status.replace("_", " ")}
                  </Badge>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-400 mb-2">
                {deficiency.description}
              </p>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>State: {deficiency.state_name}</span>
                {deficiency.transition_from && deficiency.transition_to && (
                  <span>
                    Transition: {deficiency.transition_from} →{" "}
                    {deficiency.transition_to}
                  </span>
                )}
                <span>
                  Created:{" "}
                  {format(new Date(deficiency.created_at), "MMM dd, yyyy")}
                </span>
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Expanded Content */}
        <CollapsibleContent>
          <div className="border-t border-gray-800/30 p-4 space-y-4">
            {/* Status Update */}
            <div className="flex items-center gap-4">
              <label className="text-sm text-gray-400">Update Status:</label>
              <Select
                value={deficiency.status}
                onValueChange={(value) =>
                  handleStatusChange(value as Deficiency["status"])
                }
              >
                <SelectTrigger className="w-[180px] bg-[#1A1A1B] border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="wont_fix">Won't Fix</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Expected vs Actual */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-300">
                  Expected Behavior
                </h4>
                <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-sm">
                  {deficiency.expected_behavior}
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-300">
                  Actual Behavior
                </h4>
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm">
                  {deficiency.actual_behavior}
                </div>
              </div>
            </div>

            {/* Reproduction Steps */}
            {deficiency.reproduction_steps &&
              deficiency.reproduction_steps.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-300">
                    Reproduction Steps
                  </h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
                    {deficiency.reproduction_steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}

            {/* Error Message */}
            {deficiency.error_message && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-300">
                  Error Message
                </h4>
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm font-mono text-red-400">
                  {deficiency.error_message}
                </div>
              </div>
            )}

            {/* Screenshot */}
            {deficiency.screenshot_url && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-300">
                  Screenshot
                </h4>
                <div className="relative inline-block">
                  <Image
                    src={deficiency.screenshot_url}
                    alt="Deficiency screenshot"
                    width={600}
                    height={400}
                    className="rounded border border-gray-700"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-2 right-2 border-gray-700 hover:border-[#00D9FF]"
                    onClick={() =>
                      window.open(deficiency.screenshot_url!, "_blank")
                    }
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Additional Info */}
            <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-800/30">
              <div className="flex items-center gap-4">
                {deficiency.assigned_to && (
                  <span>Assigned to: {deficiency.assigned_to}</span>
                )}
                {deficiency.resolved_at && (
                  <span>
                    Resolved:{" "}
                    {format(new Date(deficiency.resolved_at), "MMM dd, yyyy")}
                  </span>
                )}
              </div>
              <div>ID: {deficiency.id}</div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
