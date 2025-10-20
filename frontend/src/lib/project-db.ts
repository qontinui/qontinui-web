/**
 * IndexedDB wrapper for storing project data
 * Stores workflows, states, transitions, and images with project isolation
 */

import type { State, Transition, ImageAsset } from '@/contexts/automation-context/types'
import type { Workflow } from '@/lib/action-schema/action-types'

const DB_NAME = 'qontinui-project-db'
const DB_VERSION = 3 // Increment version to remove processes store

const STORES = {
  WORKFLOWS: 'workflows',
  STATES: 'states',
  TRANSITIONS: 'transitions',
  IMAGES: 'images',
  // Legacy store - will be deleted during upgrade
  PROCESSES: 'processes',
} as const

class ProjectDB {
  private dbPromise: Promise<IDBDatabase> | null = null
  private db: IDBDatabase | null = null

  private getDB(): Promise<IDBDatabase> {
    // Check if existing connection is still valid
    if (this.db && !this.isConnectionClosed(this.db)) {
      return Promise.resolve(this.db)
    }

    // Reset if connection is closed
    if (this.db && this.isConnectionClosed(this.db)) {
      this.db = null
      this.dbPromise = null
    }

    if (this.dbPromise) return this.dbPromise

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('IndexedDB not available on server'))
        return
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result

        // Handle connection close events
        this.db.onclose = () => {
          this.db = null
          this.dbPromise = null
        }

        resolve(request.result)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const oldVersion = event.oldVersion

        // Delete legacy processes store on upgrade
        if (oldVersion < 3 && db.objectStoreNames.contains(STORES.PROCESSES)) {
          db.deleteObjectStore(STORES.PROCESSES)
        }

        // Create stores if they don't exist (excluding PROCESSES)
        const activeStores = [STORES.WORKFLOWS, STORES.STATES, STORES.TRANSITIONS, STORES.IMAGES]
        activeStores.forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' })
            store.createIndex('projectName', 'projectName', { unique: false })
          }
        })
      }
    })

    return this.dbPromise
  }

  private isConnectionClosed(db: IDBDatabase): boolean {
    try {
      // Try to create a transaction - will throw if connection is closed
      db.transaction(Object.values(STORES)[0], 'readonly')
      return false
    } catch {
      return true
    }
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

  // Workflow methods
  async getAllWorkflows(): Promise<Workflow[]> {
    return this.getAll<Workflow>(STORES.WORKFLOWS)
  }

  async getWorkflowsByProject(projectName: string): Promise<Workflow[]> {
    return this.getByProject<Workflow>(STORES.WORKFLOWS, projectName)
  }

  async addWorkflow(workflow: Workflow & { projectName: string }): Promise<void> {
    return this.add(STORES.WORKFLOWS, workflow)
  }

  async updateWorkflow(workflow: Workflow & { projectName: string }): Promise<void> {
    return this.update(STORES.WORKFLOWS, workflow)
  }

  async deleteWorkflow(id: string): Promise<void> {
    return this.delete(STORES.WORKFLOWS, id)
  }

  async clearWorkflows(): Promise<void> {
    return this.clear(STORES.WORKFLOWS)
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
    const [workflows, states, transitions, images] = await Promise.all([
      this.getWorkflowsByProject(projectName),
      this.getStatesByProject(projectName),
      this.getTransitionsByProject(projectName),
      this.getImagesByProject(projectName),
    ])

    await Promise.all([
      ...workflows.map((w) => this.deleteWorkflow(w.id)),
      ...states.map((s) => this.deleteState(s.id)),
      ...transitions.map((t) => this.deleteTransition(t.id)),
      ...images.map((i) => this.deleteImage(i.id)),
    ])
  }

  // Clear all data (for testing or reset)
  async clearAll(): Promise<void> {
    await Promise.all([
      this.clearWorkflows(),
      this.clearStates(),
      this.clearTransitions(),
      this.clearImages(),
    ])
  }

  // Rename project data
  async renameProject(oldProjectName: string, newProjectName: string): Promise<void> {
    const [workflows, states, transitions, images] = await Promise.all([
      this.getWorkflowsByProject(oldProjectName),
      this.getStatesByProject(oldProjectName),
      this.getTransitionsByProject(oldProjectName),
      this.getImagesByProject(oldProjectName),
    ])

    // Update all items with new project name
    await Promise.all([
      ...workflows.map((w) => this.updateWorkflow({ ...w, projectName: newProjectName } as Workflow & { projectName: string })),
      ...states.map((s) => this.updateState({ ...s, projectName: newProjectName })),
      ...transitions.map((t) => this.updateTransition({ ...t, projectName: newProjectName })),
      ...images.map((i) => this.updateImage({ ...i, projectName: newProjectName })),
    ])
  }
}

// Export singleton instance
export const projectDB = new ProjectDB()
