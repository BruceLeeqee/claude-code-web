import { Injectable } from '@angular/core';
import { ExtractService } from './extract/extract.service';
import { MemoryGatesService } from './memory.gates';
import { MemoryTelemetryService } from './memory.telemetry';
import { SessionMemoryService } from './session/session-memory.service';
import { AutoDreamService } from './dream/auto-dream.service';
import { type MemoryPipelineResult, type TurnContext } from './memory.types';

@Injectable({ providedIn: 'root' })
export class MemorySchedulerService {
  constructor(
    private readonly gates: MemoryGatesService,
    private readonly extractService: ExtractService,
    private readonly sessionMemoryService: SessionMemoryService,
    private readonly autoDreamService: AutoDreamService,
    private readonly telemetry: MemoryTelemetryService,
  ) {}

  async runOnTurnEnd(turn: TurnContext): Promise<MemoryPipelineResult[]> {
    const results: MemoryPipelineResult[] = [];

    const extractGate = this.gates.evaluateExtractGate();
    this.telemetry.track({
      event: 'gate',
      pipeline: 'extract',
      gate_passed: extractGate.shouldRun,
      skip_reason: extractGate.reason,
      messages_seen: turn.messages.length,
      tool_calls_seen: 0,
      session_id: turn.sessionId,
      turn_id: turn.turnId,
      timestamp: Date.now(),
    });

    if (extractGate.shouldRun) {
      results.push(await this.extractService.run(turn));
    } else {
      results.push({ pipeline: 'extract', status: 'skipped', reason: extractGate.reason });
    }

    const sessionGate = this.gates.evaluateSessionGate();
    this.telemetry.track({
      event: 'gate',
      pipeline: 'session',
      gate_passed: sessionGate.shouldRun,
      skip_reason: sessionGate.reason,
      messages_seen: turn.messages.length,
      tool_calls_seen: 0,
      session_id: turn.sessionId,
      turn_id: turn.turnId,
      timestamp: Date.now(),
    });
    if (sessionGate.shouldRun) {
      results.push(await this.sessionMemoryService.run(turn));
    } else {
      results.push({ pipeline: 'session', status: 'skipped', reason: sessionGate.reason });
    }

    const dreamGate = this.gates.evaluateDreamGate();
    this.telemetry.track({
      event: 'gate',
      pipeline: 'dream',
      gate_passed: dreamGate.shouldRun,
      skip_reason: dreamGate.reason,
      messages_seen: turn.messages.length,
      tool_calls_seen: 0,
      session_id: turn.sessionId,
      turn_id: turn.turnId,
      timestamp: Date.now(),
    });
    if (dreamGate.shouldRun) {
      results.push(await this.autoDreamService.run(turn));
    } else {
      results.push({ pipeline: 'dream', status: 'skipped', reason: dreamGate.reason });
    }

    return results;
  }
}
