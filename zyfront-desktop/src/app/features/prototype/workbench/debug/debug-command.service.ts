import { Injectable, inject } from '@angular/core';
import { DebugPromptAdapterService } from './debug-prompt.adapter';
import { DebugMemoryAdapterService } from './debug-memory.adapter';
import { DebugWorkbenchAdapterService } from './debug-workbench.adapter';
import { parseDebugCommand } from './debug-command-parser';
import { type DebugAction, type DebugDomain, type DebugTabPayload, type DebugTabViewModel } from './debug-command.types';
import { DebugTabStateService } from './debug-tab-state.service';
import { LoopCommandService } from './loop-command.service';
import { LoopExecutorService } from './loop-executor.service';
import { LoopTaskRouterService } from './loop-task-router.service';
import { LoopReleaseGateService } from './loop-release-gate.service';
import { LoopDashboardService } from './loop-dashboard.service';
import { LoopVerifierService } from './loop-verifier.service';
import type { LoopState } from './loop-command.types';

@Injectable({ providedIn: 'root' })
export class DebugCommandService {
  private readonly promptAdapter = inject(DebugPromptAdapterService);
  private readonly memoryAdapter = inject(DebugMemoryAdapterService);
  private readonly workbenchAdapter = inject(DebugWorkbenchAdapterService);
  private readonly tabState = inject(DebugTabStateService);
  private readonly loopCommand = inject(LoopCommandService);
  private readonly loopExecutor = inject(LoopExecutorService);
  private readonly taskRouter = inject(LoopTaskRouterService);
  private readonly releaseGate = inject(LoopReleaseGateService);
  private readonly dashboardService = inject(LoopDashboardService);
  private readonly verifier = inject(LoopVerifierService);

  parse(input: string) {
    return parseDebugCommand(input);
  }

  async build(sessionId: string, input: string): Promise<DebugTabPayload | null> {
    const parsed = parseDebugCommand(input);
    if (!parsed) return null;

    const generatedAt = Date.now();
    const tabKey = this.tabState.getTabKey(parsed.domain);
    const tabTitle = tabKey;
    const resolvedSessionId = sessionId || this.tabState.getPinnedSession(parsed.domain) || 'workbench-terminal-ai';
    const viewModel = await this.buildViewModel(resolvedSessionId, parsed.domain, parsed.action, parsed.args);
    this.tabState.setActive(parsed.domain, resolvedSessionId);

    return { tabKey, tabTitle, domain: parsed.domain, action: parsed.action, sessionId: resolvedSessionId, generatedAt, viewModel };
  }

  async executeAction(sessionId: string, input: string): Promise<void> {
    const parsed = parseDebugCommand(input);
    if (!parsed?.action) return;
    if (parsed.domain === 'prompt' && parsed.action === 'rebuild') {
      await this.promptAdapter.rebuild(sessionId);
      return;
    }
    if (parsed.domain === 'memory' && parsed.action === 'run') {
      await this.memoryAdapter.runNow({
        sessionId,
        turnId: `debug-${Date.now()}`,
        timestamp: Date.now(),
        messages: [{ role: 'user', content: 'debug memory run' }],
      });
      return;
    }
    if (parsed.domain === 'workbench' && parsed.action === 'restore') {
      this.workbenchAdapter.restore(sessionId);
    }
    if (parsed.domain === 'loop') {
      await this.executeLoopAction(sessionId, parsed.action, parsed.args);
    }
    if (parsed.domain === 'task') {
      await this.executeTaskAction(sessionId, parsed.args[0] ?? '');
    }
  }

  renderTabContent(payload: DebugTabPayload): string {
    const lines = [
      `**${payload.tabTitle}**`,
      `- source: ${payload.viewModel.source}`,
      `- generatedAt: ${new Date(payload.generatedAt).toISOString()}`,
    ];
    for (const h of payload.viewModel.header) lines.push(`- ${h.label}: ${h.value}`);
    for (const section of payload.viewModel.sections) {
      lines.push('', `**${section.title}**`);
      if (typeof section.items === 'string') {
        lines.push(section.items);
      } else if (Array.isArray(section.items)) {
        for (const item of section.items) {
          if (typeof item === 'string') lines.push(item);
          else lines.push(`- ${item.label}: ${item.value}`);
        }
      }
    }
    lines.push('', '**验证**');
    for (const f of payload.viewModel.footer) lines.push(`- ${f.label}: ${f.value}`);
    return lines.join('\n');
  }

  private async buildViewModel(sessionId: string, domain: DebugDomain, action?: DebugAction, args: string[] = []): Promise<DebugTabViewModel> {
    if (domain === 'prompt') return this.buildPromptView(sessionId, action, args);
    if (domain === 'memory') return this.buildMemoryView(sessionId, action, args);
    if (domain === 'loop') return this.buildLoopView(sessionId, action, args);
    if (domain === 'task') return this.buildTaskView(sessionId, args);
    return this.buildWorkbenchView(sessionId, action, args);
  }

  private buildPromptView(sessionId: string, action?: DebugAction, args: string[] = []): DebugTabViewModel {
    const { snap, report } = this.promptAdapter.snapshot(sessionId);
    const reportLines = report
      ? report.layers.map((l) => ({ label: l.name, value: `${l.charsAfter} chars${l.truncated ? ' (truncated)' : ''}` }))
      : [{ label: 'report', value: 'none' }];

    return {
      source: 'PromptBuildContextService + PromptDebugReportService',
      header: [
        { label: 'session', value: sessionId },
        { label: 'action', value: action ?? 'latest' },
        { label: 'generatedAt', value: new Date(snap?.generatedAt ?? report?.builtAt ?? Date.now()).toISOString() },
      ],
      sections: [
        { kind: 'rows', title: 'Snapshot', items: [
          { label: 'hasSnapshot', value: String(Boolean(snap)) },
          { label: 'userQuery', value: snap?.userQuery ?? '(none)' },
          { label: 'systemPrompt', value: snap?.systemPrompt ?? '(none)' },
          { label: 'promptLength', value: String(snap?.prompt.length ?? 0) },
        ] },
        { kind: 'rows', title: 'Build Report', items: reportLines },
        { kind: 'text', title: 'Prompt Text', items: snap?.prompt ? snap.prompt.slice(0, 4000) : '(none)' },
      ],
      footer: [
        { label: 'verify', value: '输入长 prompt 后检查 layer 截断与生成时间' },
      ],
    };
  }

  private buildMemoryView(sessionId: string, action?: DebugAction, args: string[] = []): DebugTabViewModel {
    const snap = this.memoryAdapter.snapshot();
    const last = snap.status.lastResult;
    return {
      source: 'MemoryConfigService + MemoryOrchestratorService + MemoryTelemetryService',
      header: [
        { label: 'session', value: sessionId },
        { label: 'action', value: action ?? 'pipeline' },
        { label: 'enabled', value: String(snap.config.enabled) },
        { label: 'inProgress', value: String(snap.status.inProgress) },
        { label: 'lastRunAt', value: snap.status.lastRunAt ? new Date(snap.status.lastRunAt).toISOString() : 'N/A' },
      ],
      sections: [
        { kind: 'rows', title: 'Config', items: [
          { label: 'extract', value: String(snap.config.extract.enabled) },
          { label: 'session', value: String(snap.config.session.enabled) },
          { label: 'dream', value: String(snap.config.dream.enabled) },
          { label: 'everyNTurns', value: String(snap.config.extract.everyNTurns) },
          { label: 'minHours', value: String(snap.config.dream.minHours) },
        ] },
        { kind: 'rows', title: 'Last Result', items: [
          { label: 'pipeline', value: last?.pipeline ?? 'N/A' },
          { label: 'skipReason', value: last?.reason ?? 'none' },
          { label: 'status', value: last?.status ?? 'N/A' },
        ] },
        { kind: 'rows', title: 'Telemetry', items: snap.telemetry.map((e) => ({ label: e.event, value: `${e.pipeline} / ${e.skip_reason ?? 'none'}` })) },
      ],
      footer: [
        { label: 'verify', value: '检查 pipeline state / telemetry / config 是否一致' },
      ],
    };
  }

  private buildWorkbenchView(sessionId: string, action?: DebugAction, args: string[] = []): DebugTabViewModel {
    const snap = this.workbenchAdapter.snapshot(sessionId);
    const turns = snap.report.turns;
    return {
      source: 'WorkbenchContextService + TerminalDisplayDebugService + TurnMetadataService',
      header: [
        { label: 'session', value: sessionId },
        { label: 'action', value: action ?? 'context' },
        { label: 'generatedAt', value: new Date(snap.context.generatedAt).toISOString() },
      ],
      sections: [
        { kind: 'rows', title: 'Context', items: [
          { label: 'turnId', value: snap.context.turnId ?? 'N/A' },
          { label: 'userPrompt', value: snap.context.userPrompt ?? 'N/A' },
          { label: 'prompt', value: snap.context.prompt ? snap.context.prompt.slice(0, 240) : 'N/A' },
        ] },
        { kind: 'rows', title: 'Terminal Debug', items: [
          { label: 'panelMode', value: snap.report.panelMode },
          { label: 'thinkingBlocks', value: String(snap.report.thinkingBlockCount) },
          { label: 'replayMode', value: String(snap.replay.mode) },
          { label: 'frameCount', value: String(snap.replay.frameCount) },
        ] },
        { kind: 'rows', title: 'Turns', items: turns.map((t) => ({ label: t.turnId, value: t.userPrompt.slice(0, 120) })) },
      ],
      footer: [
        { label: 'verify', value: '刷新页面后检查 restore / replay / block state' },
      ],
    };
  }

  /* ── Loop / Task 域 ────────────────────────────────────── */

  private async executeLoopAction(sessionId: string, action: DebugAction, args: string[]): Promise<void> {
    const sid = args[0] || sessionId;
    if (action === 'stop') {
      this.loopCommand.update(sid, { status: 'paused' });
    } else if (action === 'resume') {
      const state = this.loopCommand.get(sid);
      if (state) this.loopCommand.update(sid, { status: 'executing' });
    } else if (action === 'step') {
      await this.loopExecutor.runOnce(sid);
    }
    // status 只读不执行
  }

  private async executeTaskAction(sessionId: string, taskBody: string): Promise<void> {
    const parsed = this.taskRouter.parseTaskCommand(`/task ${taskBody}`);
    if (!parsed) return;
    // 将 /task 命令转成 /loop 启动
    const request = {
      objective: parsed.objective,
      teamName: parsed.teamName !== 'general' ? parsed.teamName : undefined,
    };
    this.loopCommand.start(`/loop ${request.objective}${request.teamName ? ` --team=${request.teamName}` : ''}`, sessionId);
  }

  private buildLoopView(sessionId: string, action?: DebugAction, _args: string[] = []): DebugTabViewModel {
    const state = this.loopCommand.get(sessionId);
    if (!state) {
      return {
        source: 'LoopCommandService',
        header: [{ label: 'session', value: sessionId }],
        sections: [{ kind: 'text', title: 'Loop State', items: '无活跃 loop 会话' }],
        footer: [{ label: 'hint', value: '使用 /loop <目标> 启动 loop' }],
      };
    }

    const verification = this.verifier.verify(state);
    const releaseCheck = this.releaseGate.checkReadiness(state, verification);
    const dashboardVm = this.dashboardService.buildDashboard(state, verification);

    const matrixRows = state.verificationMatrix.map((e) => ({
      label: e.dimension,
      value: `${e.passed ? '✅' : '❌'} ${e.note ?? ''}`,
    }));

    const planRows = state.currentPlan.map((s) => ({
      label: s.type,
      value: `${s.title} [${s.status}]`,
    }));

    const teamRows = state.teamMembers.map((m) => ({
      label: m.role,
      value: m.name,
    }));

    const releaseRows = releaseCheck.checklist.map((c) => ({
      label: c.label,
      value: `${c.passed ? '✅' : '❌'} ${c.evidence}`,
    }));

    return {
      source: 'LoopCommandService + LoopVerifierService + LoopReleaseGateService + LoopDashboardService',
      header: [
        { label: 'loopId', value: state.loopId },
        { label: 'action', value: action ?? 'status' },
        { label: 'status', value: state.status },
        { label: 'phase', value: state.phase },
        { label: 'iteration', value: `${state.iteration}/${state.maxIterations}` },
        { label: 'team', value: state.teamName },
        { label: 'taskType', value: state.taskType },
        { label: 'canRelease', value: String(releaseCheck.canRelease) },
        { label: 'requiresApproval', value: String(releaseCheck.requiresApproval) },
      ],
      sections: [
        { kind: 'rows', title: 'Objective', items: [{ label: 'objective', value: state.objective }] },
        { kind: 'rows', title: 'Plan', items: planRows.length > 0 ? planRows : [{ label: '-', value: '计划已收敛' }] },
        { kind: 'rows', title: 'Verification Matrix', items: matrixRows },
        { kind: 'rows', title: 'Team', items: teamRows.length > 0 ? teamRows : [{ label: '-', value: '无团队' }] },
        { kind: 'rows', title: 'Release Gate', items: releaseRows },
        { kind: 'rows', title: 'Validation', items: [
          { label: 'passed', value: String(verification.passed) },
          { label: 'recommendation', value: verification.recommendation },
          { label: 'blockers', value: verification.blockers.join(', ') || 'none' },
          { label: 'warnings', value: verification.warnings.join('; ') || 'none' },
        ] },
        { kind: 'rows', title: 'Artifacts', items: [
          { label: 'documents', value: String(dashboardVm.artifactSummary.documents) },
          { label: 'screenshots', value: String(dashboardVm.artifactSummary.screenshots) },
          { label: 'patches', value: String(dashboardVm.artifactSummary.patches) },
        ] },
      ],
      footer: [
        { label: 'completedSteps', value: String(state.completedSteps.length) },
        { label: 'blockedReasons', value: String(state.blockedReasons.length) },
        { label: 'commands', value: '/loop status | /loop stop | /loop resume | /loop step' },
      ],
    };
  }

  private buildTaskView(sessionId: string, args: string[] = []): DebugTabViewModel {
    const taskBody = args[0] ?? '';
    const parsed = this.taskRouter.parseTaskCommand(`/task ${taskBody}`);

    if (!parsed) {
      return {
        source: 'LoopTaskRouterService',
        header: [{ label: 'session', value: sessionId }],
        sections: [{ kind: 'text', title: 'Parse Error', items: '无法解析 /task 命令。格式: /task team=<团队> objective=<目标>' }],
        footer: [{ label: 'example', value: '/task team=dev objective=实现登录页' }],
      };
    }

    const routing = this.taskRouter.route({ objective: parsed.objective, teamName: parsed.teamName });

    return {
      source: 'LoopTaskRouterService',
      header: [
        { label: 'teamName', value: routing.teamName },
        { label: 'taskType', value: routing.taskType },
        { label: 'phase', value: routing.phase },
        { label: 'gatePassed', value: String(routing.gatePassed) },
        { label: 'gateReason', value: routing.gateReason ?? '-' },
      ],
      sections: [
        { kind: 'rows', title: 'Parsed', items: [
          { label: 'objective', value: parsed.objective },
          { label: 'teamName', value: parsed.teamName },
        ] },
        { kind: 'rows', title: 'Routing', items: [
          { label: 'routedTeam', value: routing.teamName },
          { label: 'routedTaskType', value: routing.taskType },
          { label: 'initialPhase', value: routing.phase },
        ] },
      ],
      footer: [
        { label: 'action', value: '执行后自动创建 loop 会话' },
      ],
    };
  }
}
