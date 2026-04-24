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

    results.push(await this.runPipeline(turn, 'extract', () => this.extractService.run(turn)));
    results.push(await this.runPipeline(turn, 'session', () => this.sessionMemoryService.run(turn)));
    results.push(await this.runPipeline(turn, 'dream', () => this.autoDreamService.run(turn)));

    return results;
  }

  private async runPipeline(
    turn: TurnContext,
    pipeline: 'extract' | 'session' | 'dream',
    runner: () => Promise<MemoryPipelineResult>,
  ): Promise<MemoryPipelineResult> {
    const gate = this.evaluateGate(pipeline);
    this.telemetry.track({
      event: 'gate',
      pipeline,
      gate_passed: gate.shouldRun,
      skip_reason: gate.reason,
      messages_seen: turn.messages.length,
      tool_calls_seen: 0,
      session_id: turn.sessionId,
      turn_id: turn.turnId,
      timestamp: Date.now(),
    });

    if (!gate.shouldRun) {
      return { pipeline, status: 'skipped', reason: gate.reason };
    }

    try {
      return await runner();
    } catch (error) {
      this.telemetry.track({
        event: 'error',
        pipeline,
        gate_passed: true,
        skip_reason: `${pipeline}_scheduler_error`,
        duration_ms: 0,
        messages_seen: turn.messages.length,
        tool_calls_seen: 0,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        timestamp: Date.now(),
      });
      return {
        pipeline,
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown_error',
        durationMs: 0,
      };
    }
  }

  private evaluateGate(pipeline: 'extract' | 'session' | 'dream') {
    if (pipeline === 'extract') return this.gates.evaluateExtractGate();
    if (pipeline === 'session') return this.gates.evaluateSessionGate();
    return this.gates.evaluateDreamGate();
  }
}
