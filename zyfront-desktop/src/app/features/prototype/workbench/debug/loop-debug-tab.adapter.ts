import type { DebugTabViewModel } from './debug-command.types';
import type { LoopState, LoopValidationResult } from './loop-command.types';

export interface LoopDebugViewModel {
  state: LoopState;
  verification: LoopValidationResult | null;
  messages: string[];
}

export function buildLoopDebugViewModel(state: LoopState, verification: LoopValidationResult | null, messages: string[]): DebugTabViewModel {
  return {
    source: 'LoopCommandService + LoopExecutorService + LoopVerifierService',
    header: [
      { label: 'loopId', value: state.loopId },
      { label: 'taskId', value: state.taskId },
      { label: 'team', value: state.teamName },
      { label: 'taskType', value: state.taskType },
      { label: 'phase', value: state.phase },
      { label: 'status', value: state.status },
      { label: 'iteration', value: `${state.iteration}/${state.maxIterations}` },
      { label: 'fileChanges', value: String(state.fileChanges.length) },
      { label: 'toolHistory', value: String(state.toolHistory.length) },
    ],
    sections: [
      {
        kind: 'rows',
        title: 'Objective',
        items: [{ label: 'objective', value: state.objective }],
      },
      {
        kind: 'rows',
        title: 'Plan',
        items: state.currentPlan.map((step) => ({ label: step.type, value: `${step.title} (${step.status})` })),
      },
      {
        kind: 'rows',
        title: 'Verification Matrix',
        items: state.verificationMatrix.map((item) => ({
          label: item.dimension,
          value: `${item.passed ? 'passed' : 'pending/failed'} | ${item.note ?? ''}`,
        })),
      },
      {
        kind: 'rows',
        title: 'Validation',
        items: verification
          ? [
              { label: 'stage', value: verification.stage },
              { label: 'passed', value: String(verification.passed) },
              { label: 'recommendation', value: verification.recommendation },
              { label: 'blockers', value: verification.blockers.join(', ') || 'none' },
            ]
          : [{ label: 'verification', value: 'none' }],
      },
      {
        kind: 'text',
        title: 'Cycle Messages',
        items: messages.length > 0 ? messages.map((m) => `- ${m}`).join('\n') : '（暂无消息）',
      },
    ],
    footer: [
      { label: 'completedSteps', value: String(state.completedSteps.length) },
      { label: 'blockedReasons', value: String(state.blockedReasons.length) },
    ],
  };
}
