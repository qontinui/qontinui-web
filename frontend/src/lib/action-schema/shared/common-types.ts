/**
 * Common types used across all action configurations
 */

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Coordinates {
  x: number;
  y: number;
}

export type MouseButton = 'LEFT' | 'RIGHT' | 'MIDDLE';

export type SearchStrategy = 'FIRST' | 'ALL' | 'BEST' | 'EACH';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';
