import { Process } from "./types"

export class ProcessManager {
  static addProcess(processes: Process[], newProcess: Process): Process[] {
    return [...processes, newProcess]
  }

  static updateProcess(processes: Process[], updatedProcess: Process): Process[] {
    return processes.map((p) => (p.id === updatedProcess.id ? updatedProcess : p))
  }

  static deleteProcess(processes: Process[], processId: string): Process[] {
    return processes.filter((p) => p.id !== processId)
  }
}
