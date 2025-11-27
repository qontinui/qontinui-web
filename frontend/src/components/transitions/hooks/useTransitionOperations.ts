import { useCallback } from "react"
import { Transition, OutgoingTransition } from "@/contexts/automation-context/types"
import { toast } from "sonner"

interface UseTransitionOperationsProps {
  addTransition: (transition: Transition) => void
  updateTransition: (transition: Transition) => void
  deleteTransition: (id: string) => void
}

export function useTransitionOperations({
  addTransition,
  updateTransition,
  deleteTransition,
}: UseTransitionOperationsProps) {
  const handleBulkDelete = useCallback(
    (selectedTransitions: Set<string>) => {
      selectedTransitions.forEach((id) => deleteTransition(id))
      toast.success(`Deleted ${selectedTransitions.size} transition(s)`)
    },
    [deleteTransition]
  )

  const handleBulkCreate = useCallback(
    (newTransitions: Transition[]) => {
      newTransitions.forEach((t) => addTransition(t))
      toast.success(`Created ${newTransitions.length} transition(s)`)
    },
    [addTransition]
  )

  const handleExport = useCallback(
    (transitions: Transition[]) => {
      const data = JSON.stringify(transitions, null, 2)
      const blob = new Blob([data], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `transitions-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Transitions exported")
    },
    []
  )

  const handleUpdate = useCallback(
    (transition: Transition, updates: Partial<Transition>) => {
      updateTransition({ ...transition, ...updates })
      toast.success("Transition updated")
    },
    [updateTransition]
  )

  const handleDelete = useCallback(
    (id: string) => {
      deleteTransition(id)
      toast.success("Transition deleted")
    },
    [deleteTransition]
  )

  const findMatchingTransitions = useCallback(
    (transitions: Transition[], fromState: string, toState: string): OutgoingTransition[] => {
      return transitions.filter(
        (t): t is OutgoingTransition =>
          t.type === "OutgoingTransition" &&
          t.fromState === fromState &&
          t.activateStates.includes(toState)
      )
    },
    []
  )

  return {
    handleBulkDelete,
    handleBulkCreate,
    handleExport,
    handleUpdate,
    handleDelete,
    findMatchingTransitions,
  }
}
