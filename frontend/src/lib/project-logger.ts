/**
 * Project Logger - Centralized logging for project operations
 *
 * Single Responsibility: Provides structured logging for debugging project operations.
 * All project-related operations should use this logger for consistent formatting.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  component: string
  action: string
  data?: Record<string, unknown>
}

class ProjectLogger {
  private enabled: boolean = true
  private logHistory: LogEntry[] = []
  private maxHistory: number = 100

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  private formatData(data: Record<string, unknown> | undefined): string {
    if (!data) return ''

    // Truncate large data for readability
    const formatted: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length > 100) {
        formatted[key] = value.substring(0, 100) + '...'
      } else if (Array.isArray(value)) {
        formatted[key] = `Array(${value.length})`
      } else if (typeof value === 'object' && value !== null) {
        formatted[key] = '{...}'
      } else {
        formatted[key] = value
      }
    }
    return JSON.stringify(formatted)
  }

  private log(level: LogLevel, component: string, action: string, data?: Record<string, unknown>) {
    if (!this.enabled) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      action,
      data,
    }

    // Store in history
    this.logHistory.push(entry)
    if (this.logHistory.length > this.maxHistory) {
      this.logHistory.shift()
    }

    // Format for console
    const prefix = `[${entry.timestamp.split('T')[1].split('.')[0]}] [${component}]`
    const dataStr = this.formatData(data)
    const message = `${prefix} ${action}${dataStr ? ` | ${dataStr}` : ''}`

    switch (level) {
      case 'debug':
        console.debug(`%c${message}`, 'color: #888')
        break
      case 'info':
        console.info(`%c${message}`, 'color: #00D9FF')
        break
      case 'warn':
        console.warn(message)
        break
      case 'error':
        console.error(message)
        break
    }
  }

  // Component-specific loggers
  debug(component: string, action: string, data?: Record<string, unknown>) {
    this.log('debug', component, action, data)
  }

  info(component: string, action: string, data?: Record<string, unknown>) {
    this.log('info', component, action, data)
  }

  warn(component: string, action: string, data?: Record<string, unknown>) {
    this.log('warn', component, action, data)
  }

  error(component: string, action: string, data?: Record<string, unknown>) {
    this.log('error', component, action, data)
  }

  // Get log history for debugging
  getHistory(): LogEntry[] {
    return [...this.logHistory]
  }

  // Clear history
  clearHistory() {
    this.logHistory = []
  }

  // Convenience methods for common components
  urlHandler(action: string, data?: Record<string, unknown>) {
    this.debug('URLHandler', action, data)
  }

  projectLoader(action: string, data?: Record<string, unknown>) {
    this.info('ProjectLoader', action, data)
  }

  contextProvider(action: string, data?: Record<string, unknown>) {
    this.info('ContextProvider', action, data)
  }

  configLoader(action: string, data?: Record<string, unknown>) {
    this.info('ConfigLoader', action, data)
  }

  indexedDB(action: string, data?: Record<string, unknown>) {
    this.debug('IndexedDB', action, data)
  }
}

// Singleton instance
export const projectLogger = new ProjectLogger()

// Enable/disable via window for debugging
if (typeof window !== 'undefined') {
  (window as any).projectLogger = projectLogger
}
