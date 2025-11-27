import { useMemo } from "react"
import { Transition, State } from "@/contexts/automation-context/types"
import { TransitionFilters, TransitionValidation } from "../types"

export function useTransitionFilters(
  transitions: Transition[],
  filters: TransitionFilters,
  states: State[],
  validation: TransitionValidation
): Transition[] {
  return useMemo(() => {
    return transitions.filter((t) => {
      // Search query
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        const fromStateName =
          t.type === "OutgoingTransition"
            ? states.find((s) => s.id === t.fromState)?.name.toLowerCase()
            : ""
        const toStateName =
          t.type === "IncomingTransition"
            ? states.find((s) => s.id === t.toState)?.name.toLowerCase()
            : t.type === "OutgoingTransition"
            ? t.activateStates
                .map((id) => states.find((s) => s.id === id)?.name.toLowerCase())
                .join(" ")
            : ""

        if (
          !fromStateName?.includes(query) &&
          !toStateName?.includes(query)
        ) {
          return false
        }
      }

      // From state filter
      if (
        filters.fromState !== "all" &&
        t.type === "OutgoingTransition" &&
        t.fromState !== filters.fromState
      ) {
        return false
      }

      // To state filter
      if (filters.toState !== "all") {
        if (t.type === "IncomingTransition" && t.toState !== filters.toState) {
          return false
        }
        if (
          t.type === "OutgoingTransition" &&
          !t.activateStates.includes(filters.toState)
        ) {
          return false
        }
      }

      // Action type filter
      if (filters.actionType === "with_workflow" && t.workflows.length === 0) {
        return false
      }
      if (
        filters.actionType === "without_workflow" &&
        t.workflows.length > 0
      ) {
        return false
      }

      // Has workflow filter
      if (
        filters.hasWorkflow !== "all" &&
        !t.workflows.includes(filters.hasWorkflow)
      ) {
        return false
      }

      // Show circular filter
      if (filters.showCircular && !validation.circular.includes(t.id)) {
        return false
      }

      // Show broken filter
      if (
        filters.showBroken &&
        !validation.brokenStateReferences.includes(t.id)
      ) {
        return false
      }

      return true
    })
  }, [transitions, filters, states, validation])
}
