"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { State } from "@/contexts/automation-context/types";

interface StateColumnsProps {
  states: State[];
  fromState: string;
  availableStates: State[];
  activateStates: string[];
  deactivateStates: string[];
  onMoveToActivate: (stateId: string) => void;
  onMoveToDeactivate: (stateId: string) => void;
  onMoveToAvailable: (stateId: string, from: "activate" | "deactivate") => void;
}

function StateListItem({
  name,
  onClick,
  onKeyDown,
  icon,
}: {
  name: string;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  icon: "left" | "right";
}) {
  return (
    <div
      className="p-2 bg-surface-sunken rounded flex items-center justify-between hover:bg-surface-overlay cursor-pointer transition-colors"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {icon === "left" && <ChevronLeft className="w-4 h-4 text-text-muted" />}
      <span className="text-sm">{name}</span>
      {icon === "right" && <ChevronRight className="w-4 h-4 text-text-muted" />}
    </div>
  );
}

function handleKeyDown(callback: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      callback();
    }
  };
}

function DeactivateColumn({
  states,
  deactivateStates,
  onMoveToAvailable,
}: Pick<
  StateColumnsProps,
  "states" | "deactivateStates" | "onMoveToAvailable"
>) {
  return (
    <div>
      <Label className="text-sm font-semibold mb-2 text-red-400">
        States to Deactivate
      </Label>
      <Card className="bg-surface-overlay border-red-400/50">
        <CardContent className="p-3 h-[400px] overflow-y-auto">
          {deactivateStates.length === 0 ? (
            <p className="text-sm text-text-muted text-center pt-8">
              No states selected
            </p>
          ) : (
            <div className="space-y-2">
              {deactivateStates.map((stateId) => {
                const state = states.find((s) => s.id === stateId);
                if (!state) return null;
                const handleClick = () =>
                  onMoveToAvailable(stateId, "deactivate");
                return (
                  <StateListItem
                    key={stateId}
                    name={state.name}
                    onClick={handleClick}
                    onKeyDown={handleKeyDown(handleClick)}
                    icon="right"
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AvailableColumn({
  fromState,
  availableStates,
  onMoveToActivate,
  onMoveToDeactivate,
}: Pick<
  StateColumnsProps,
  "fromState" | "availableStates" | "onMoveToActivate" | "onMoveToDeactivate"
>) {
  return (
    <div>
      <Label className="text-sm font-semibold mb-2">Available States</Label>
      <Card className="bg-surface-overlay">
        <CardContent className="p-3 h-[400px] overflow-y-auto">
          {!fromState ? (
            <p className="text-sm text-text-muted text-center pt-8">
              Select origin state first
            </p>
          ) : availableStates.length === 0 ? (
            <p className="text-sm text-text-muted text-center pt-8">
              No states available
            </p>
          ) : (
            <div className="space-y-2">
              {availableStates.map((state) => (
                <div
                  key={state.id}
                  className="p-2 bg-surface-sunken rounded hover:bg-surface-overlay transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-1 h-auto hover:bg-red-400/20"
                      onClick={() => onMoveToDeactivate(state.id)}
                    >
                      <ChevronLeft className="w-4 h-4 text-red-400" />
                    </Button>

                    <span className="text-sm mx-2 flex-1 text-center">
                      {state.name}
                    </span>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-1 h-auto hover:bg-green-400/20"
                      onClick={() => onMoveToActivate(state.id)}
                    >
                      <ChevronRight className="w-4 h-4 text-green-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ActivateColumn({
  states,
  activateStates,
  onMoveToAvailable,
}: Pick<StateColumnsProps, "states" | "activateStates" | "onMoveToAvailable">) {
  return (
    <div>
      <Label className="text-sm font-semibold mb-2 text-green-400">
        States to Activate
      </Label>
      <Card className="bg-surface-overlay border-green-400/50">
        <CardContent className="p-3 h-[400px] overflow-y-auto">
          {activateStates.length === 0 ? (
            <p className="text-sm text-text-muted text-center pt-8">
              No states selected
            </p>
          ) : (
            <div className="space-y-2">
              {activateStates.map((stateId) => {
                const state = states.find((s) => s.id === stateId);
                if (!state) return null;
                const handleClick = () =>
                  onMoveToAvailable(stateId, "activate");
                return (
                  <StateListItem
                    key={stateId}
                    name={state.name}
                    onClick={handleClick}
                    onKeyDown={handleKeyDown(handleClick)}
                    icon="left"
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function StateColumns({
  states,
  fromState,
  availableStates,
  activateStates,
  deactivateStates,
  onMoveToActivate,
  onMoveToDeactivate,
  onMoveToAvailable,
}: StateColumnsProps) {
  return (
    <div className="grid grid-cols-3 gap-6">
      <DeactivateColumn
        states={states}
        deactivateStates={deactivateStates}
        onMoveToAvailable={onMoveToAvailable}
      />
      <AvailableColumn
        fromState={fromState}
        availableStates={availableStates}
        onMoveToActivate={onMoveToActivate}
        onMoveToDeactivate={onMoveToDeactivate}
      />
      <ActivateColumn
        states={states}
        activateStates={activateStates}
        onMoveToAvailable={onMoveToAvailable}
      />
    </div>
  );
}
