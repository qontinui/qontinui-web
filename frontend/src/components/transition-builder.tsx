"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowRight, Plus, Trash2, MoveRight, Target } from "lucide-react"
import { toast } from "sonner"
import { useAutomation } from "@/contexts/automation-context"

export function TransitionBuilder() {
  const { states, processes, addTransition } = useAutomation()
  const [open, setOpen] = useState(false)
  const [transitionType, setTransitionType] = useState<"OutgoingTransition" | "IncomingTransition">("OutgoingTransition")
  
  // OutgoingTransition fields
  const [fromState, setFromState] = useState("")
  const [toState, setToState] = useState("")
  const [staysVisible, setStaysVisible] = useState(false)
  const [activateStates, setActivateStates] = useState<string[]>([])
  const [deactivateStates, setDeactivateStates] = useState<string[]>([])
  
  // IncomingTransition fields
  const [incomingTransitionState, setIncomingTransitionState] = useState("")
  
  // Common fields
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([])
  const [timeout, setTimeout] = useState(5000)
  const [retryCount, setRetryCount] = useState(3)

  const handleCreate = () => {
    if (transitionType === "OutgoingTransition") {
      if (!fromState || !toState) {
        toast.error("Please select both from and to states")
        return
      }
      
      const transition = {
        id: `transition-${Date.now()}`,
        type: "OutgoingTransition" as const,
        fromState,
        toState,
        staysVisible,
        activateStates,
        deactivateStates,
        processes: selectedProcesses,
        timeout,
        retryCount,
      }
      
      addTransition(transition)
      toast.success("OutgoingTransition created")
    } else {
      if (!incomingTransitionState) {
        toast.error("Please select a state for the IncomingTransition")
        return
      }
      
      const transition = {
        id: `transition-${Date.now()}`,
        type: "IncomingTransition" as const,
        toState: incomingTransitionState,
        processes: selectedProcesses,
        timeout,
        retryCount,
      }
      
      addTransition(transition)
      toast.success("IncomingTransition created")
    }
    
    setOpen(false)
  }

  const toggleStateSelection = (stateId: string, list: string[], setList: (states: string[]) => void) => {
    if (list.includes(stateId)) {
      setList(list.filter(s => s !== stateId))
    } else {
      setList([...list, stateId])
    }
  }

  const toggleProcessSelection = (processId: string) => {
    if (selectedProcesses.includes(processId)) {
      setSelectedProcesses(selectedProcesses.filter(p => p !== processId))
    } else {
      setSelectedProcesses([...selectedProcesses, processId])
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="w-full bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Transition
        </Button>
      </DialogTrigger>
      
      <DialogContent className="bg-[#27272A] border-gray-700 max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#00D9FF]">Create Transition</DialogTitle>
        </DialogHeader>

        <Tabs value={transitionType} onValueChange={(v) => setTransitionType(v as any)}>
          <TabsList className="grid w-full grid-cols-2 bg-gray-800">
            <TabsTrigger value="OutgoingTransition" className="data-[state=active]:bg-[#BD00FF]">
              <MoveRight className="w-4 h-4 mr-2" />
              OutgoingTransition
            </TabsTrigger>
            <TabsTrigger value="IncomingTransition" className="data-[state=active]:bg-[#00FF88]">
              <Target className="w-4 h-4 mr-2" />
              IncomingTransition
            </TabsTrigger>
          </TabsList>

          <TabsContent value="OutgoingTransition" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>From State</Label>
                <Select value={fromState} onValueChange={setFromState}>
                  <SelectTrigger className="bg-transparent border-gray-600">
                    <SelectValue placeholder="Select origin state" />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label>To State</Label>
                <Select value={toState} onValueChange={setToState}>
                  <SelectTrigger className="bg-transparent border-gray-600">
                    <SelectValue placeholder="Select target state" />
                  </SelectTrigger>
                  <SelectContent>
                    {states.filter(s => s.id !== fromState).map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="stays-visible"
                checked={staysVisible}
                onCheckedChange={(checked) => setStaysVisible(checked as boolean)}
              />
              <Label htmlFor="stays-visible" className="text-sm">
                Origin state stays visible after transition
              </Label>
            </div>

            <div>
              <Label>Additional States to Activate</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {states.filter(s => s.id !== toState).map((state) => (
                  <Badge
                    key={state.id}
                    variant={activateStates.includes(state.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleStateSelection(state.id, activateStates, setActivateStates)}
                  >
                    {state.name}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <Label>States to Deactivate</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {states.filter(s => s.id !== fromState || !staysVisible).map((state) => (
                  <Badge
                    key={state.id}
                    variant={deactivateStates.includes(state.id) ? "destructive" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleStateSelection(state.id, deactivateStates, setDeactivateStates)}
                  >
                    {state.name}
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="IncomingTransition" className="space-y-4 mt-4">
            <div>
              <Label>State (IncomingTransition will execute when entering this state)</Label>
              <Select value={incomingTransitionState} onValueChange={setIncomingTransitionState}>
                <SelectTrigger className="bg-transparent border-gray-600">
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {states.map((state) => (
                    <SelectItem key={state.id} value={state.id}>
                      {state.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="p-4 bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-400">
                IncomingTransitions are executed automatically after any successful OutgoingTransition 
                that navigates to this state. They're useful for setup actions that should 
                always happen when entering a state.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-4 pt-4 border-t border-gray-700">
          <div>
            <Label>Processes to Execute</Label>
            <div className="space-y-2 mt-2 max-h-32 overflow-y-auto">
              {processes.length === 0 ? (
                <p className="text-sm text-gray-500">No processes available. Create processes in the Process Builder tab.</p>
              ) : (
                processes.map((process) => (
                  <div
                    key={process.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      selectedProcesses.includes(process.id)
                        ? "bg-[#BD00FF]/20 border border-[#BD00FF]"
                        : "bg-gray-800 border border-gray-700 hover:border-gray-600"
                    }`}
                    onClick={() => toggleProcessSelection(process.id)}
                  >
                    <Checkbox checked={selectedProcesses.includes(process.id)} />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{process.name}</p>
                      {process.description && (
                        <p className="text-xs text-gray-400">{process.description}</p>
                      )}
                    </div>
                    <Badge variant="secondary">{process.actions.length} actions</Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Timeout (ms)</Label>
              <Input
                type="number"
                value={timeout}
                onChange={(e) => setTimeout(Number(e.target.value))}
                className="bg-transparent border-gray-600"
                min={100}
                step={100}
              />
            </div>
            
            <div>
              <Label>Retry Count</Label>
              <Input
                type="number"
                value={retryCount}
                onChange={(e) => setRetryCount(Number(e.target.value))}
                className="bg-transparent border-gray-600"
                min={0}
                max={10}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            className="flex-1 border-gray-600"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="flex-1 bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
          >
            Create {transitionType}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}