import { Injectable } from '@angular/core';

export interface MemorySystemConfig {
  enabled: boolean;
  memoryRootKey: string;
  extract: {
    enabled: boolean;
    everyNTurns: number;
    maxTurns: number;
  };
  session: {
    enabled: boolean;
    minTokenDelta: number;
    minToolCalls: number;
  };
  dream: {
    enabled: boolean;
    minHours: number;
    minSessions: number;
  };
}

const DEFAULT_MEMORY_SYSTEM_CONFIG: MemorySystemConfig = {
  enabled: true,
  memoryRootKey: 'agent-memory-root',
  extract: {
    enabled: true,
    everyNTurns: 1,
    maxTurns: 5,
  },
  session: {
    enabled: true,
    minTokenDelta: 10,
    minToolCalls: 1,
  },
  dream: {
    enabled: true,
    minHours: 6,
    minSessions: 3,
  },
};

@Injectable({ providedIn: 'root' })
export class MemoryConfigService {
  private readonly config: MemorySystemConfig = DEFAULT_MEMORY_SYSTEM_CONFIG;

  getConfig(): MemorySystemConfig {
    return this.config;
  }
}
