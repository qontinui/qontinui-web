/**
 * IndexedDB wrapper for storing project data
 * Stores processes, states, transitions, and images with project isolation
 */

import type { Process, State, Transition, ImageAsset } from '@/contexts/automation-context/types'

const DB_NAME = 'qontinui-project-db'
const DB_VERSION = 1

const STORES = {
  PROCESSES: 'processes',
  STATES: 'states',
  TRANSITIONS: 'transitions',
  IMAGES: 'images',
} as const

class ProjectDB {
  private dbPromise: Promise<IDBDatabase> | null = null

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('IndexedDB not available on server'))
        return
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create stores if they don't exist
        Object.values(STORES).forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' })
            store.createIndex('projectName', 'projectName', { unique: false })
          }
        })
      }
    })

    return this.dbPromise
  }

  // Generic methods for any store
  private async getAll<T>(storeName: string): Promise<T[]> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly')
        const store = transaction.objectStore(storeName)
        const request = store.getAll()

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`Error getting all from ${storeName}:`, error)
      return []
    }
  }

  private async getByProject<T>(storeName: string, projectName: string): Promise<T[]> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly')
        const store = transaction.objectStore(storeName)
        const index = store.index('projectName')
        const request = index.getAll(projectName)

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`Error getting ${storeName} for project ${projectName}:`, error)
      return []
    }
  }

  private async add<T extends { id: string }>(storeName: string, item: T): Promise<void> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        const request = store.add(item)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`Error adding to ${storeName}:`, error)
      throw error
    }
  }

  private async update<T extends { id: string }>(storeName: string, item: T): Promise<void> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        const request = store.put(item)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`Error updating ${storeName}:`, error)
      throw error
    }
  }

  private async delete(storeName: string, id: string): Promise<void> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        const request = store.delete(id)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`Error deleting from ${storeName}:`, error)
      throw error
    }
  }

  private async clear(storeName: string): Promise<void> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        const request = store.clear()

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`Error clearing ${storeName}:`, error)
      throw error
    }
  }

  // Process methods
  async getAllProcesses(): Promise<Process[]> {
    return this.getAll<Process>(STORES.PROCESSES)
  }

  async getProcessesByProject(projectName: string): Promise<Process[]> {
    return this.getByProject<Process>(STORES.PROCESSES, projectName)
  }

  async addProcess(process: Process): Promise<void> {
    return this.add(STORES.PROCESSES, process)
  }

  async updateProcess(process: Process): Promise<void> {
    return this.update(STORES.PROCESSES, process)
  }

  async deleteProcess(id: string): Promise<void> {
    return this.delete(STORES.PROCESSES, id)
  }

  async clearProcesses(): Promise<void> {
    return this.clear(STORES.PROCESSES)
  }

  // State methods
  async getAllStates(): Promise<State[]> {
    return this.getAll<State>(STORES.STATES)
  }

  async getStatesByProject(projectName: string): Promise<State[]> {
    return this.getByProject<State>(STORES.STATES, projectName)
  }

  async addState(state: State): Promise<void> {
    return this.add(STORES.STATES, state)
  }

  async updateState(state: State): Promise<void> {
    return this.update(STORES.STATES, state)
  }

  async updateStateWithIdChange(oldId: string, newState: State): Promise<void> {
    // Delete the old state and add the new one with the new ID
    await this.delete(STORES.STATES, oldId)
    await this.add(STORES.STATES, newState)
  }

  async deleteState(id: string): Promise<void> {
    return this.delete(STORES.STATES, id)
  }

  async clearStates(): Promise<void> {
    return this.clear(STORES.STATES)
  }

  // Transition methods
  async getAllTransitions(): Promise<Transition[]> {
    return this.getAll<Transition>(STORES.TRANSITIONS)
  }

  async getTransitionsByProject(projectName: string): Promise<Transition[]> {
    return this.getByProject<Transition>(STORES.TRANSITIONS, projectName)
  }

  async addTransition(transition: Transition): Promise<void> {
    return this.add(STORES.TRANSITIONS, transition)
  }

  async updateTransition(transition: Transition): Promise<void> {
    return this.update(STORES.TRANSITIONS, transition)
  }

  async deleteTransition(id: string): Promise<void> {
    return this.delete(STORES.TRANSITIONS, id)
  }

  async clearTransitions(): Promise<void> {
    return this.clear(STORES.TRANSITIONS)
  }

  // Image methods
  async getAllImages(): Promise<ImageAsset[]> {
    return this.getAll<ImageAsset>(STORES.IMAGES)
  }

  async getImagesByProject(projectName: string): Promise<ImageAsset[]> {
    return this.getByProject<ImageAsset>(STORES.IMAGES, projectName)
  }

  async addImage(image: ImageAsset): Promise<void> {
    return this.add(STORES.IMAGES, image)
  }

  async updateImage(image: ImageAsset): Promise<void> {
    return this.update(STORES.IMAGES, image)
  }

  async deleteImage(id: string): Promise<void> {
    return this.delete(STORES.IMAGES, id)
  }

  async clearImages(): Promise<void> {
    return this.clear(STORES.IMAGES)
  }

  // Bulk operations for clearing project data
  async clearProjectData(projectName: string): Promise<void> {
    const [processes, states, transitions, images] = await Promise.all([
      this.getProcessesByProject(projectName),
      this.getStatesByProject(projectName),
      this.getTransitionsByProject(projectName),
      this.getImagesByProject(projectName),
    ])

    await Promise.all([
      ...processes.map((p) => this.deleteProcess(p.id)),
      ...states.map((s) => this.deleteState(s.id)),
      ...transitions.map((t) => this.deleteTransition(t.id)),
      ...images.map((i) => this.deleteImage(i.id)),
    ])
  }

  // Clear all data (for testing or reset)
  async clearAll(): Promise<void> {
    await Promise.all([
      this.clearProcesses(),
      this.clearStates(),
      this.clearTransitions(),
      this.clearImages(),
    ])
  }

  // Rename project data
  async renameProject(oldProjectName: string, newProjectName: string): Promise<void> {
    const [processes, states, transitions, images] = await Promise.all([
      this.getProcessesByProject(oldProjectName),
      this.getStatesByProject(oldProjectName),
      this.getTransitionsByProject(oldProjectName),
      this.getImagesByProject(oldProjectName),
    ])

    // Update all items with new project name
    await Promise.all([
      ...processes.map((p) => this.updateProcess({ ...p, projectName: newProjectName })),
      ...states.map((s) => this.updateState({ ...s, projectName: newProjectName })),
      ...transitions.map((t) => this.updateTransition({ ...t, projectName: newProjectName })),
      ...images.map((i) => this.updateImage({ ...i, projectName: newProjectName })),
    ])
  }
}

// Export singleton instance
export const projectDB = new ProjectDB()
