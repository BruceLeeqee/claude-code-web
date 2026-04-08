import { Injectable } from '@angular/core';
import { MemoryConfigService } from './memory.config';
import { type MemoryGateResult } from './memory.types';

@Injectable({ providedIn: 'root' })
export class MemoryGatesService {
  constructor(private readonly configService: MemoryConfigService) {}

  evaluateExtractGate(): MemoryGateResult {
    const cfg = this.configService.getConfig();
    if (!cfg.enabled) return { pipeline: 'extract', shouldRun: false, reason: 'memory_disabled' };
    if (!cfg.extract.enabled) return { pipeline: 'extract', shouldRun: false, reason: 'extract_disabled' };
    return { pipeline: 'extract', shouldRun: true, reason: 'passed' };
  }

  evaluateSessionGate(): MemoryGateResult {
    const cfg = this.configService.getConfig();
    if (!cfg.enabled) return { pipeline: 'session', shouldRun: false, reason: 'memory_disabled' };
    if (!cfg.session.enabled) return { pipeline: 'session', shouldRun: false, reason: 'session_disabled' };
    return { pipeline: 'session', shouldRun: true, reason: 'passed' };
  }

  evaluateDreamGate(): MemoryGateResult {
    const cfg = this.configService.getConfig();
    if (!cfg.enabled) return { pipeline: 'dream', shouldRun: false, reason: 'memory_disabled' };
    if (!cfg.dream.enabled) return { pipeline: 'dream', shouldRun: false, reason: 'dream_disabled' };
    return { pipeline: 'dream', shouldRun: true, reason: 'passed' };
  }
}
