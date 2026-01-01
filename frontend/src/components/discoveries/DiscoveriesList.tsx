"use client";

import { useState } from "react";
import { DiscoveryCard } from "./DiscoveryCard";
import {
  useDiscoveries,
  useAcceptDiscovery,
  useRejectDiscovery,
} from "@/hooks/useDiscoveries";
import type {
  DiscoveryFilters,
  DiscoveryType,
  DiscoveryStatus,
} from "@/types/discoveries";
import { Loader2, Inbox, Filter } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DiscoveriesListProps {
  status?: DiscoveryStatus;
  projectId?: string;
}

const discoveryTypes: { value: DiscoveryType | "all"; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "new_element", label: "New Element" },
  { value: "new_transition", label: "New Transition" },
  { value: "timing_update", label: "Timing Update" },
  { value: "flaky_detection", label: "Flaky Detection" },
  { value: "unexpected_element", label: "Unexpected Element" },
];

export function DiscoveriesList({ status, projectId }: DiscoveriesListProps) {
  const [typeFilter, setTypeFilter] = useState<DiscoveryType | "all">("all");

  const filters: DiscoveryFilters = {
    status,
    project_id: projectId,
    discovery_type: typeFilter === "all" ? undefined : typeFilter,
  };

  const { data, isLoading, error } = useDiscoveries(filters);
  const acceptMutation = useAcceptDiscovery();
  const rejectMutation = useRejectDiscovery();

  const handleAccept = async (id: string, notes?: string) => {
    try {
      await acceptMutation.mutateAsync({ id, notes });
      toast.success("Discovery accepted", {
        description: "The discovery has been marked as accepted.",
      });
    } catch (err) {
      toast.error("Failed to accept discovery", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleReject = async (id: string, notes?: string) => {
    try {
      await rejectMutation.mutateAsync({ id, notes });
      toast.success("Discovery rejected", {
        description: "The discovery has been marked as rejected.",
      });
    } catch (err) {
      toast.error("Failed to reject discovery", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-500 mb-2">Failed to load discoveries</div>
        <div className="text-sm text-gray-400">
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    );
  }

  const discoveries = data?.discoveries || [];

  return (
    <div className="space-y-4">
      {/* Type filter */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Filter size={14} />
          <span>Filter by type:</span>
        </div>
        <Select
          value={typeFilter}
          onValueChange={(value) =>
            setTypeFilter(value as DiscoveryType | "all")
          }
        >
          <SelectTrigger className="w-[180px] bg-gray-900/50 border-gray-700 text-white">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent className="bg-[#1A1A1B] border-gray-700">
            {discoveryTypes.map((type) => (
              <SelectItem
                key={type.value}
                value={type.value}
                className="text-white hover:bg-gray-800"
              >
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-sm text-gray-500">
          {discoveries.length}{" "}
          {discoveries.length === 1 ? "discovery" : "discoveries"}
        </div>
      </div>

      {/* Empty state */}
      {discoveries.length === 0 ? (
        <div className="text-center py-12 bg-[#1A1A1B] rounded-lg border border-gray-800">
          <Inbox className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <div className="text-lg text-gray-400 mb-1">No discoveries found</div>
          <div className="text-sm text-gray-500">
            {status === "pending"
              ? "There are no pending discoveries to review."
              : status === "accepted"
                ? "No discoveries have been accepted yet."
                : status === "rejected"
                  ? "No discoveries have been rejected yet."
                  : "No discoveries match your filters."}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {discoveries.map((discovery) => (
            <DiscoveryCard
              key={discovery.id}
              discovery={discovery}
              onAccept={handleAccept}
              onReject={handleReject}
              isAccepting={
                acceptMutation.isPending &&
                acceptMutation.variables?.id === discovery.id
              }
              isRejecting={
                rejectMutation.isPending &&
                rejectMutation.variables?.id === discovery.id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
