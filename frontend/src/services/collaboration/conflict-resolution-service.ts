/**
 * Conflict Resolution Service
 *
 * Provides conflict detection, resolution strategies, and three-way merge
 * capabilities for collaborative editing.
 */

import {
  Conflict,
  ConflictType,
  ResolutionStrategy,
  MergeResult,
  Resolution,
  ConflictCheckResult,
  ConflictDetails,
  Change,
  ResourceType,
  ConflictDetectorConfig,
  AutoResolutionResult,
  ThreeWayMergeInfo,
  VersionInfo
} from '../../types/collaboration/conflict-types'

/**
 * Detects conflicts between different versions of a resource
 */
export class ConflictDetector {
  private config: ConflictDetectorConfig

  constructor(config: Partial<ConflictDetectorConfig> = {}) {
    this.config = {
      detectPropertyChanges: true,
      detectStructuralChanges: true,
      minimumSeverity: 'low',
      ...config
    }
  }

  /**
   * Detect conflicts between local, server, and base versions
   */
  detectConflicts(
    localVersion: any,
    serverVersion: any,
    baseVersion: any
  ): Conflict[] {
    const conflicts: Conflict[] = []

    // Detect property changes
    if (this.config.detectPropertyChanges) {
      conflicts.push(...this.detectPropertyConflicts(localVersion, serverVersion, baseVersion))
    }

    // Detect structural changes
    if (this.config.detectStructuralChanges) {
      conflicts.push(...this.detectStructuralConflicts(localVersion, serverVersion, baseVersion))
    }

    // Apply custom rules
    if (this.config.customRules) {
      for (const rule of this.config.customRules) {
        const conflict = rule(localVersion, serverVersion, baseVersion)
        if (conflict) {
          conflicts.push(conflict)
        }
      }
    }

    // Filter by minimum severity
    return conflicts.filter(c => this.getSeverityLevel(c.severity) >= this.getSeverityLevel(this.config.minimumSeverity))
  }

  /**
   * Detect property-level conflicts
   */
  private detectPropertyConflicts(
    local: any,
    remote: any,
    base: any,
    path: string[] = []
  ): Conflict[] {
    const conflicts: Conflict[] = []

    if (!local || !remote || !base) return conflicts

    // Handle different types
    if (typeof local !== 'object' || typeof remote !== 'object' || typeof base !== 'object') {
      if (local !== base && remote !== base && local !== remote) {
        conflicts.push(this.createConflict('PropertyChanged', local, remote, base, path))
      }
      return conflicts
    }

    // Get all keys from all versions
    const allKeys = new Set([
      ...Object.keys(local),
      ...Object.keys(remote),
      ...Object.keys(base)
    ])

    for (const key of allKeys) {
      const localValue = local[key]
      const remoteValue = remote[key]
      const baseValue = base[key]

      // Check if both modified the same property
      if (localValue !== baseValue && remoteValue !== baseValue && localValue !== remoteValue) {
        // Recursively check nested objects
        if (
          typeof localValue === 'object' &&
          typeof remoteValue === 'object' &&
          typeof baseValue === 'object' &&
          !Array.isArray(localValue) &&
          !Array.isArray(remoteValue) &&
          !Array.isArray(baseValue)
        ) {
          conflicts.push(...this.detectPropertyConflicts(localValue, remoteValue, baseValue, [...path, key]))
        } else {
          conflicts.push(this.createConflict('PropertyChanged', localValue, remoteValue, baseValue, [...path, key]))
        }
      }

      // Check if one deleted while other modified
      if (
        (localValue === undefined && remoteValue !== baseValue && baseValue !== undefined) ||
        (remoteValue === undefined && localValue !== baseValue && baseValue !== undefined)
      ) {
        conflicts.push(this.createConflict('ActionRemoved', localValue, remoteValue, baseValue, [...path, key]))
      }
    }

    return conflicts
  }

  /**
   * Detect structural conflicts (actions, connections, etc.)
   */
  private detectStructuralConflicts(
    local: any,
    remote: any,
    base: any,
    path: string[] = []
  ): Conflict[] {
    const conflicts: Conflict[] = []

    // Check actions array
    if (local.actions && remote.actions && base.actions) {
      conflicts.push(...this.detectArrayConflicts(local.actions, remote.actions, base.actions, [...path, 'actions'], 'ActionModified'))
    }

    // Check connections
    if (local.connections && remote.connections && base.connections) {
      conflicts.push(...this.detectArrayConflicts(local.connections, remote.connections, base.connections, [...path, 'connections'], 'ConnectionChanged'))
    }

    return conflicts
  }

  /**
   * Detect conflicts in arrays
   */
  private detectArrayConflicts(
    local: any[],
    remote: any[],
    base: any[],
    path: string[],
    conflictType: ConflictType
  ): Conflict[] {
    const conflicts: Conflict[] = []

    // Create maps by id for easier comparison
    const localMap = new Map(local.map(item => [item.id, item]))
    const remoteMap = new Map(remote.map(item => [item.id, item]))
    const baseMap = new Map(base.map(item => [item.id, item]))

    // Get all IDs
    const allIds = new Set([
      ...localMap.keys(),
      ...remoteMap.keys(),
      ...baseMap.keys()
    ])

    for (const id of allIds) {
      const localItem = localMap.get(id)
      const remoteItem = remoteMap.get(id)
      const baseItem = baseMap.get(id)

      // Both modified
      if (localItem && remoteItem && baseItem) {
        if (JSON.stringify(localItem) !== JSON.stringify(baseItem) &&
            JSON.stringify(remoteItem) !== JSON.stringify(baseItem) &&
            JSON.stringify(localItem) !== JSON.stringify(remoteItem)) {
          conflicts.push(this.createConflict(conflictType, localItem, remoteItem, baseItem, [...path, id]))
        }
      }

      // One deleted, one modified
      if (!localItem && remoteItem && baseItem && JSON.stringify(remoteItem) !== JSON.stringify(baseItem)) {
        conflicts.push(this.createConflict('ActionRemoved', localItem, remoteItem, baseItem, [...path, id]))
      }
      if (localItem && !remoteItem && baseItem && JSON.stringify(localItem) !== JSON.stringify(baseItem)) {
        conflicts.push(this.createConflict('ActionRemoved', localItem, remoteItem, baseItem, [...path, id]))
      }
    }

    return conflicts
  }

  /**
   * Create a conflict object
   */
  private createConflict(
    type: ConflictType,
    localValue: any,
    remoteValue: any,
    baseValue: any,
    path: string[]
  ): Conflict {
    return {
      id: `conflict-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      resourceType: this.inferResourceType(path),
      resourceId: path[0] || '',
      localVersion: localValue,
      serverVersion: remoteValue,
      baseVersion: baseValue,
      path,
      severity: this.determineSeverity(type, path),
      autoResolvable: this.isAutoResolvable(type, localValue, remoteValue, baseValue),
      createdAt: new Date()
    }
  }

  /**
   * Determine if a conflict can be automatically resolved
   */
  private isAutoResolvable(type: ConflictType, local: any, remote: any, base: any): boolean {
    // Simple heuristics for auto-resolution
    switch (type) {
      case 'PropertyChanged':
        // Can auto-resolve if values are compatible (e.g., both incremented a counter)
        if (typeof local === 'number' && typeof remote === 'number' && typeof base === 'number') {
          return true
        }
        return false

      case 'MetadataChanged':
        // Metadata changes are usually safe to merge
        return true

      case 'ActionRemoved':
      case 'ConnectionChanged':
      case 'StructureChanged':
        // These require manual resolution
        return false

      default:
        return false
    }
  }

  /**
   * Determine severity of a conflict
   */
  private determineSeverity(type: ConflictType, path: string[]): 'low' | 'medium' | 'high' {
    // High severity for structural changes
    if (type === 'ActionRemoved' || type === 'StructureChanged' || type === 'ConnectionChanged') {
      return 'high'
    }

    // Medium severity for action modifications
    if (type === 'ActionModified') {
      return 'medium'
    }

    // Low severity for property and metadata changes
    return 'low'
  }

  /**
   * Infer resource type from path
   */
  private inferResourceType(path: string[]): ResourceType {
    if (path.length === 0) return 'workflow'

    const firstSegment = path[0].toLowerCase()
    if (firstSegment.includes('action')) return 'action'
    if (firstSegment.includes('connection')) return 'connection'
    if (firstSegment.includes('state')) return 'state'
    if (firstSegment.includes('image')) return 'image'
    if (firstSegment.includes('transition')) return 'transition'

    return 'workflow'
  }

  /**
   * Get numeric severity level
   */
  private getSeverityLevel(severity: 'low' | 'medium' | 'high'): number {
    const levels = { low: 1, medium: 2, high: 3 }
    return levels[severity]
  }

  /**
   * Resolve a conflict using the specified strategy
   */
  resolveConflict(conflict: Conflict, strategy: ResolutionStrategy): any {
    switch (strategy) {
      case 'KeepLocal':
        return conflict.localVersion

      case 'KeepRemote':
        return conflict.serverVersion

      case 'Merge':
        return this.attemptAutoMerge(conflict)

      case 'Manual':
        throw new Error('Manual resolution required - no automatic resolution available')

      default:
        throw new Error(`Unknown resolution strategy: ${strategy}`)
    }
  }

  /**
   * Attempt to automatically merge a conflict
   */
  private attemptAutoMerge(conflict: Conflict): any {
    const { localVersion, serverVersion, baseVersion, type } = conflict

    switch (type) {
      case 'PropertyChanged':
        // For numeric values, try to merge changes
        if (typeof localVersion === 'number' && typeof serverVersion === 'number' && typeof baseVersion === 'number') {
          const localDelta = localVersion - baseVersion
          const remoteDelta = serverVersion - baseVersion
          return baseVersion + localDelta + remoteDelta
        }
        // For strings, keep the longer one (heuristic)
        if (typeof localVersion === 'string' && typeof serverVersion === 'string') {
          return localVersion.length >= serverVersion.length ? localVersion : serverVersion
        }
        // Default to local version
        return localVersion

      case 'MetadataChanged':
        // Merge metadata objects
        return { ...baseVersion, ...serverVersion, ...localVersion }

      default:
        // For other types, default to local version
        return localVersion
    }
  }

  /**
   * Perform three-way merge
   */
  threeWayMerge(local: any, remote: any, base: any): MergeResult {
    const conflicts = this.detectConflicts(local, remote, base)
    const resolutions: Resolution[] = []
    let mergedVersion = { ...base }

    // Try to auto-resolve conflicts
    for (const conflict of conflicts) {
      if (conflict.autoResolvable) {
        try {
          const resolvedValue = this.resolveConflict(conflict, 'Merge')
          this.applyResolution(mergedVersion, conflict.path, resolvedValue)

          resolutions.push({
            conflictId: conflict.id,
            strategy: 'Merge',
            resolvedValue,
            resolvedAt: new Date()
          })
        } catch (error) {
          // Leave conflict unresolved
        }
      }
    }

    // Apply non-conflicting changes from local
    this.applyNonConflictingChanges(mergedVersion, local, base, conflicts, 'local')

    // Apply non-conflicting changes from remote
    this.applyNonConflictingChanges(mergedVersion, remote, base, conflicts, 'remote')

    return {
      success: conflicts.filter(c => !c.autoResolvable).length === 0,
      conflicts: conflicts.filter(c => !c.autoResolvable),
      mergedVersion,
      resolutions
    }
  }

  /**
   * Apply resolution to merged version
   */
  private applyResolution(target: any, path: string[], value: any): void {
    if (path.length === 0) return

    let current = target
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) {
        current[path[i]] = {}
      }
      current = current[path[i]]
    }

    current[path[path.length - 1]] = value
  }

  /**
   * Apply non-conflicting changes
   */
  private applyNonConflictingChanges(
    target: any,
    source: any,
    base: any,
    conflicts: Conflict[],
    side: 'local' | 'remote'
  ): void {
    if (!source || typeof source !== 'object') return

    for (const key in source) {
      const sourcePath = [key]
      const hasConflict = conflicts.some(c =>
        c.path.length > 0 && c.path[0] === key
      )

      if (!hasConflict) {
        const sourceValue = source[key]
        const baseValue = base?.[key]

        if (JSON.stringify(sourceValue) !== JSON.stringify(baseValue)) {
          target[key] = sourceValue
        }
      }
    }
  }
}

/**
 * Main conflict resolution service
 */
export class ConflictResolutionService {
  private detector: ConflictDetector
  private apiBaseUrl: string

  constructor(apiBaseUrl: string = '/api', detectorConfig?: Partial<ConflictDetectorConfig>) {
    this.apiBaseUrl = apiBaseUrl
    this.detector = new ConflictDetector(detectorConfig)
  }

  /**
   * Check for conflicts before saving
   */
  async checkForConflicts(
    projectId: string,
    resourceType: string,
    resourceId: string,
    localChanges: any
  ): Promise<ConflictCheckResult> {
    try {
      // Get current server version
      const response = await fetch(
        `${this.apiBaseUrl}/projects/${projectId}/${resourceType}/${resourceId}/version`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch server version: ${response.statusText}`)
      }

      const { version: serverVersion, baseVersion } = await response.json()

      // Detect conflicts
      const conflicts = this.detector.detectConflicts(localChanges, serverVersion, baseVersion)

      // Determine if we can save
      const canSave = conflicts.length === 0 || conflicts.every(c => c.autoResolvable)

      // Suggest resolution strategy
      let suggestedStrategy: ResolutionStrategy | undefined
      if (conflicts.length > 0) {
        if (conflicts.every(c => c.autoResolvable)) {
          suggestedStrategy = 'Merge'
        } else {
          suggestedStrategy = 'Manual'
        }
      }

      return {
        hasConflicts: conflicts.length > 0,
        conflicts,
        serverVersion,
        canSave,
        suggestedStrategy
      }
    } catch (error) {
      console.error('Error checking for conflicts:', error)
      throw error
    }
  }

  /**
   * Get detailed conflict information
   */
  async getConflictDetails(conflictId: string): Promise<ConflictDetails> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/conflicts/${conflictId}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch conflict details: ${response.statusText}`)
      }

      const conflict = await response.json()

      // Generate strategy previews
      const strategyPreviews: Record<ResolutionStrategy, any> = {
        KeepLocal: conflict.localVersion,
        KeepRemote: conflict.serverVersion,
        Merge: this.detector.resolveConflict(conflict, 'Merge'),
        Manual: null
      }

      // Determine available and recommended strategies
      const availableStrategies: ResolutionStrategy[] = ['KeepLocal', 'KeepRemote', 'Manual']
      if (conflict.autoResolvable) {
        availableStrategies.push('Merge')
      }

      const recommendedStrategy: ResolutionStrategy = conflict.autoResolvable ? 'Merge' : 'Manual'

      return {
        ...conflict,
        localChanges: [],
        remoteChanges: [],
        availableStrategies,
        recommendedStrategy,
        strategyPreviews
      }
    } catch (error) {
      console.error('Error fetching conflict details:', error)
      throw error
    }
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    conflictId: string,
    strategy: ResolutionStrategy,
    resolution?: any
  ): Promise<void> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          strategy,
          resolution
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to resolve conflict: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Error resolving conflict:', error)
      throw error
    }
  }

  /**
   * Automatically resolve conflicts when possible
   */
  async autoResolve(conflicts: Conflict[]): Promise<AutoResolutionResult> {
    const resolved: Resolution[] = []
    const requiresManual: Conflict[] = []

    for (const conflict of conflicts) {
      if (conflict.autoResolvable) {
        try {
          const resolvedValue = this.detector.resolveConflict(conflict, 'Merge')
          await this.resolveConflict(conflict.id, 'Merge', resolvedValue)

          resolved.push({
            conflictId: conflict.id,
            strategy: 'Merge',
            resolvedValue,
            resolvedAt: new Date()
          })
        } catch (error) {
          console.error(`Failed to auto-resolve conflict ${conflict.id}:`, error)
          requiresManual.push(conflict)
        }
      } else {
        requiresManual.push(conflict)
      }
    }

    return {
      resolved,
      requiresManual,
      successRate: conflicts.length > 0 ? resolved.length / conflicts.length : 1
    }
  }

  /**
   * Merge two branches/versions
   */
  async mergeBranches(
    sourceVersionId: string,
    targetVersionId: string
  ): Promise<MergeResult> {
    try {
      // Fetch both versions and their common base
      const [sourceVersion, targetVersion, baseVersion] = await Promise.all([
        this.fetchVersion(sourceVersionId),
        this.fetchVersion(targetVersionId),
        this.findCommonBase(sourceVersionId, targetVersionId)
      ])

      // Perform three-way merge
      return this.detector.threeWayMerge(sourceVersion.data, targetVersion.data, baseVersion.data)
    } catch (error) {
      console.error('Error merging branches:', error)
      throw error
    }
  }

  /**
   * Fetch a version by ID
   */
  private async fetchVersion(versionId: string): Promise<VersionInfo> {
    const response = await fetch(`${this.apiBaseUrl}/versions/${versionId}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch version: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Find common base version for two versions
   */
  private async findCommonBase(versionId1: string, versionId2: string): Promise<VersionInfo> {
    const response = await fetch(
      `${this.apiBaseUrl}/versions/common-base?v1=${versionId1}&v2=${versionId2}`
    )

    if (!response.ok) {
      throw new Error(`Failed to find common base: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get the conflict detector instance
   */
  getDetector(): ConflictDetector {
    return this.detector
  }
}

// Export singleton instance
export const conflictResolutionService = new ConflictResolutionService()
