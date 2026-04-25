import { Injectable, inject } from '@angular/core';
import { LoopCommandService, type LoopCycleResult } from './loop-command.service';
import { LoopVerifierService } from './loop-verifier.service';
import { LoopDocWriterService } from './loop-doc-writer.service';
import { LoopPatchEngineService } from './loop-patch-engine.service';
import { LoopTaskRouterService } from './loop-task-router.service';
import { LoopTeamManagerService } from './loop-team-manager.service';
import { LoopSandboxRunnerService } from './loop-sandbox-runner.service';
import { LoopTerminalSandboxService } from './loop-terminal-sandbox.service';
import { LoopReleaseGateService } from './loop-release-gate.service';
import { LoopArtifactStoreService } from './loop-artifact-store.service';
import { LoopDashboardService } from './loop-dashboard.service';
import type { LoopPlanStep, LoopState } from './loop-command.types';

declare const window: Window & typeof globalThis;

/** execCommand 默认超时（毫秒） */
const EXEC_TIMEOUT_MS = 120_000;

export interface LoopExecutionResult extends LoopCycleResult {
  executedStep?: LoopPlanStep;
  nextState: LoopState;
}

interface ToolOutcome {
  toolHistory: string[];
  fileChanges: string[];
  blockers: string[];
  warnings: string[];
  statusHint?: LoopState['status'];
  matrixUpdates: Array<{
    dimension: LoopState['verificationMatrix'][number]['dimension'];
    passed: boolean;
    evidence: string[];
    note?: string;
  }>;
}

@Injectable({ providedIn: 'root' })
export class LoopExecutorService {
  private readonly loopCommand = inject(LoopCommandService);
  private readonly verifier = inject(LoopVerifierService);
  private readonly docWriter = inject(LoopDocWriterService);
  private readonly patchEngine = inject(LoopPatchEngineService);
  private readonly taskRouter = inject(LoopTaskRouterService);
  private readonly teamManager = inject(LoopTeamManagerService);
  private readonly sandboxRunner = inject(LoopSandboxRunnerService);
  private readonly terminalSandbox = inject(LoopTerminalSandboxService);
  private readonly releaseGate = inject(LoopReleaseGateService);
  private readonly artifactStore = inject(LoopArtifactStoreService);
  private readonly dashboard = inject(LoopDashboardService);

  /* ── 公共 API ────────────────────────────────────────── */

  async runOnce(sessionId: string): Promise<LoopExecutionResult> {
    const state = this.requireState(sessionId);
    const executedStep = this.pickNextStep(state);
    const stepOutcome = executedStep ? await this.executeStep(sessionId, state, executedStep) : state;
    const verification = this.verifier.verify(stepOutcome);
    const finalState = await this.applyVerification(sessionId, stepOutcome, verification);

    // 每轮结束后：写入仪表盘 + 归档工件
    this.writeDashboardAndArchive(finalState, verification);

    return {
      state: finalState,
      verification,
      messages: this.buildMessages(finalState, verification, executedStep),
      executedStep,
      nextState: finalState,
    };
  }

  async runCycle(sessionId: string, maxSteps = 3): Promise<LoopExecutionResult[]> {
    const results: LoopExecutionResult[] = [];
    for (let i = 0; i < maxSteps; i += 1) {
      const current = this.loopCommand.get(sessionId);
      if (!current) break;
      if (this.isTerminalStatus(current.status)) break;
      const result = await this.runOnce(sessionId);
      results.push(result);
      if (this.isTerminalStatus(result.state.status)) break;
    }
    return results;
  }

  /* ── 步骤执行 ────────────────────────────────────────── */

  private async executeStep(sessionId: string, current: LoopState, step: LoopPlanStep): Promise<LoopState> {
    const completedStep: LoopPlanStep = { ...step, status: 'done' };
    const remainingPlan = current.currentPlan.filter((item) => item.id !== step.id);
    const nextStepStatus = this.nextStepStatus(step);
    const remainingNext = remainingPlan.map((item, index) => (index === 0 ? { ...item, status: nextStepStatus } : item));
    const summary = this.buildExecutionSummary(step, remainingPlan);
    const toolHistory = [...current.toolHistory, `executed:${step.id}`].slice(-100);
    const fileChanges = [...current.fileChanges];
    const stepDocs = [...current.stepDocs];
    let status: LoopState['status'] = 'verifying';

    const toolOutcome = await this.runRealToolAction(sessionId, current, step);
    if (toolOutcome.toolHistory.length > 0) toolHistory.push(...toolOutcome.toolHistory);
    if (toolOutcome.fileChanges.length > 0) fileChanges.push(...toolOutcome.fileChanges);
    if (toolOutcome.statusHint) status = toolOutcome.statusHint;

    // 通过 DocWriter 生成真实内容落盘的步骤文档
    const stepDoc = await this.docWriter.writeStepDoc(current, step);
    stepDocs.push(stepDoc);

    // 对于非开发类任务（analysis/docs/general），analysis/summary 步骤执行后自动标记验证矩阵通过
    const autoPassedMatrixUpdates = this.buildAutoPassMatrixUpdates(current, step);

    // 合并矩阵更新：自动通过的更新优先级低于实际工具产出
    const mergedMatrixUpdates = this.mergeMatrixUpdates(autoPassedMatrixUpdates, toolOutcome.matrixUpdates);

    return this.loopCommand.update(sessionId, {
      status,
      phase: this.mapPhase(step),
      currentPlan: remainingNext,
      completedSteps: [...current.completedSteps, completedStep],
      iteration: current.iteration + 1,
      lastSummary: summary,
      toolHistory,
      fileChanges: fileChanges.slice(-200),
      stepDocs: stepDocs.slice(-50),
      memoryRefs: [...current.memoryRefs, `step:${step.id}:${Date.now()}`].slice(-100),
      retryCount: current.retryCount + (status === 'repairing' ? 1 : 0),
      verificationMatrix: this.updateVerificationMatrix(current, step, toolOutcome.blockers, mergedMatrixUpdates),
      buildStatus: this.pickBuildStatus(current, step, toolOutcome.blockers),
      uiStatus: this.pickUiStatus(current, step, toolOutcome.blockers),
      apiStatus: this.pickApiStatus(current, step, toolOutcome.blockers),
      dataStatus: this.pickDataStatus(current, step, toolOutcome.blockers),
      lastEvidence: toolOutcome.toolHistory.slice(-8),
      blockedReasons: toolOutcome.blockers.length ? [...current.blockedReasons, ...toolOutcome.blockers] : [],
      patchFailureMap: this.patchEngine.serializeFailures(),
    }) ?? current;
  }

  private async runRealToolAction(
    sessionId: string,
    current: LoopState,
    step: LoopPlanStep,
  ): Promise<ToolOutcome> {
    const toolHistory: string[] = [];
    const fileChanges: string[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];
    const matrixUpdates: ToolOutcome['matrixUpdates'] = [];
    let statusHint: LoopState['status'] | undefined;

    try {
      if (typeof window === 'undefined') {
        return { toolHistory: ['tool:window-unavailable'], fileChanges, blockers, warnings, matrixUpdates, statusHint: 'paused' };
      }

      /* ── analysis / requirements 步骤：任务路由 + 团队编排 ── */
      if (step.type === 'analysis') {
        const team = this.teamManager.createTeam(current);
        const assignments = this.teamManager.assignSteps(team, [step]);
        for (const a of assignments) {
          toolHistory.push(`team:${team.name}:${a.assigneeRole}:${a.stepId}`);
        }

        const agentRequestPath = '02-AGENT-MEMORY/01-Short-Term/loop-agent-request.md';
        const agentRequest = [
          `# Loop Agent Request`,
          ``,
          `- loopId: ${sessionId}`,
          `- objective: ${current.objective}`,
          `- taskType: ${current.taskType}`,
          `- step: ${step.id} (${step.title})`,
          `- riskLevel: ${step.riskLevel}`,
          `- acceptance: ${step.acceptance.join('; ')}`,
          `- assignedTo: ${assignments[0]?.assigneeName ?? 'general-agent'} (${assignments[0]?.assigneeRole ?? 'general-agent'})`,
          `- timestamp: ${new Date().toISOString()}`,
          ``,
          `## 状态`,
          ``,
          `> **requires-agent**: 此步骤需要 AI Agent 执行。`,
          `> Loop 将暂停等待 Agent 完成后继续验证。`,
        ].join('\n');
        const write = await window.zytrader.fs.write(agentRequestPath, agentRequest, { scope: 'vault' });
        if (write.ok) {
          fileChanges.push(agentRequestPath);
          toolHistory.push(`fs.write:${agentRequestPath}`);
        }

        statusHint = 'paused';
        warnings.push('analysis 步骤已强制指派 AI Agent/团队执行，当前暂停等待');
      }

      /* ── design 步骤：需求→设计门禁确认 ── */
      if (step.type === 'design') {
        const hasRequirements = current.completedSteps.some((s) => s.id === 'requirements' || s.type === 'analysis');
        if (!hasRequirements && current.taskType === 'development') {
          blockers.push('开发任务必须先完成需求阶段才能进入设计');
          statusHint = 'paused';
        }
        toolHistory.push(`design:gate:${blockers.length === 0 ? 'passed' : 'blocked'}`);
      }

      /* ── implementation 步骤：团队分配 + Agent 接口 ── */
      if (step.type === 'implementation') {
        // 1. 团队角色分配
        const team = this.teamManager.createTeam(current);
        const assignments = this.teamManager.assignSteps(team, [step]);
        for (const a of assignments) {
          toolHistory.push(`team:${team.name}:${a.assigneeRole}:${a.stepId}`);
        }

        // 2. 写入 Agent 需求文件（等待 AI Agent 对接）
        const agentRequestPath = '02-AGENT-MEMORY/01-Short-Term/loop-agent-request.md';
        const agentRequest = [
          `# Loop Agent Request`,
          ``,
          `- loopId: ${sessionId}`,
          `- objective: ${current.objective}`,
          `- step: ${step.id} (${step.title})`,
          `- riskLevel: ${step.riskLevel}`,
          `- acceptance: ${step.acceptance.join('; ')}`,
          `- assignedTo: ${assignments[0]?.assigneeName ?? 'developer'} (${assignments[0]?.assigneeRole ?? 'developer'})`,
          `- timestamp: ${new Date().toISOString()}`,
          ``,
          `## 状态`,
          ``,
          `> **requires-agent**: 此步骤需要 AI Agent 执行代码修改。`,
          `> Loop 将暂停等待 Agent 完成后继续验证。`,
        ].join('\n');
        const write = await window.zytrader.fs.write(agentRequestPath, agentRequest, { scope: 'vault' });
        if (write.ok) {
          fileChanges.push(agentRequestPath);
          toolHistory.push(`fs.write:${agentRequestPath}`);
        }

        // 暂停等待 Agent
        statusHint = 'paused';
        warnings.push('implementation 步骤需要 AI Agent 执行代码修改，当前暂停等待');
      }

      /* ── test 步骤：使用 TerminalSandbox ── */
      if (step.type === 'test') {
        const testRun = await this.terminalSandbox.runUnitTests();
        toolHistory.push(`terminal-sandbox:test:${testRun.exitCode}`);
        const out = `${testRun.stdout}\n${testRun.stderr}`.trim();
        let testPassed = testRun.ok;

        if (!testPassed && this.isMissingScript(out)) {
          const fallback = await this.terminalSandbox.runUtf8Check();
          toolHistory.push(`terminal-sandbox:verify:utf8:${fallback.exitCode}`);
          const fallbackOut = `${fallback.stdout}\n${fallback.stderr}`.trim();
          testPassed = fallback.ok;
          if (fallback.ok) warnings.push('npm test 不可用，已回退到 verify:utf8');
        }

        matrixUpdates.push({
          dimension: 'terminal',
          passed: testPassed,
          evidence: [out.slice(0, 400) || 'test output empty'],
          note: testPassed ? 'terminal checks passed' : 'terminal checks failed',
        });

        if (!testPassed) {
          blockers.push(out.slice(0, 1200) || 'test command failed');
          const repairResult = await this.patchEngine.autoRepair(out, '.');
          toolHistory.push(`patch-engine:${repairResult.strategy}:${repairResult.ok ? 'applied' : 'failed'}`);
          if (repairResult.ok && repairResult.targetPath) fileChanges.push(repairResult.targetPath);
          if (!repairResult.ok) blockers.push(repairResult.error || 'patch-engine repair failed');
          statusHint = 'repairing';
          return { toolHistory, fileChanges, blockers, warnings, matrixUpdates, statusHint };
        }
      }

      /* ── verification 步骤：按任务类型差异化验证 ── */
      if (step.type === 'verification') {
        // 根据任务类型决定验证范围：开发类任务走完整矩阵，非开发类跳过编译/终端
        const isDevLikeTask = current.taskType === 'development' || current.taskType === 'testing' || current.taskType === 'ops';

        if (isDevLikeTask) {
          // 开发类任务：完整验证矩阵（compile + terminal + ui + api + data + sandbox）
          const batch = await this.terminalSandbox.runVerificationMatrix();
          toolHistory.push(`terminal-sandbox:matrix:${batch.allPassed ? 'passed' : 'failed'}`);

          for (const r of batch.results) {
            const out = `${r.stdout}\n${r.stderr}`.trim();
            const dimension = out.includes('compile') || r.command.includes('tsc') || r.command.includes('build')
              ? 'compile' as const
              : 'terminal' as const;
            matrixUpdates.push({
              dimension,
              passed: r.ok,
              evidence: [out.slice(0, 300) || `${dimension} output empty`],
              note: r.ok ? `${dimension} pass` : `${dimension} failed`,
            });
            if (!r.ok && !batch.allPassed) blockers.push(`${dimension} verification failed`);
          }

          // UI/API/Data 维度通过 check 脚本
          for (const dimension of ['ui', 'api', 'data'] as const) {
            const probe = await this.execCommand(`${this.cmdPrefix()}npm run ${dimension}:check`);
            const missingScript = this.isMissingScript(probe.out);
            const passed = probe.ok || missingScript;
            toolHistory.push(`terminal.exec:${dimension}:${probe.code}`);
            matrixUpdates.push({
              dimension,
              passed,
              evidence: [probe.out.slice(0, 240) || `${dimension} output empty`],
              note: missingScript ? `${dimension} script missing, skipped` : passed ? `${dimension} pass` : `${dimension} failed`,
            });
            if (!passed) blockers.push(`${dimension} verification failed`);
            if (missingScript) warnings.push(`${dimension} 验证脚本未配置，当前记为跳过`);
          }

          // 沙箱浏览器 UI 验证（可选）
          if (current.uiStatus === 'unknown' || current.uiStatus === 'failed') {
            try {
              const sandboxResult = await this.sandboxRunner.openPage({
                url: 'http://localhost:4200',
                waitFor: 3000,
                captureScreenshot: true,
                captureDom: false,
                retries: 1,
              });
              toolHistory.push(`sandbox-runner:${sandboxResult.ok ? 'passed' : 'failed'}`);
              matrixUpdates.push({
                dimension: 'ui',
                passed: sandboxResult.ok,
                evidence: sandboxResult.consoleErrors.length > 0 ? sandboxResult.consoleErrors.slice(0, 3) : ['page opened'],
                note: sandboxResult.ok ? 'UI sandbox passed' : `UI sandbox: ${sandboxResult.error || 'console errors'}`,
              });
              if (sandboxResult.screenshotPath) fileChanges.push(sandboxResult.screenshotPath);
            } catch {
              warnings.push('沙箱浏览器不可用，UI 验证已跳过');
            }
          }
        } else {
          // 非开发类任务（analysis/docs/general）：轻量级验证，直接通过
          toolHistory.push('verification:skipped-for-non-dev-task');

          // 将验证矩阵中所有 pending/skipped 维度标记为通过
          for (const entry of current.verificationMatrix) {
            if (!entry.passed) {
              matrixUpdates.push({
                dimension: entry.dimension,
                passed: true,
                evidence: [`auto-passed for ${current.taskType} task verification`],
                note: 'skipped',
              });
            }
          }
        }
      }

      /* ── repair 步骤：使用 PatchEngine ── */
      if (step.type === 'repair') {
        const reportPath = '02-AGENT-MEMORY/01-Short-Term/loop-repair-notes.txt';
        const report = [
          `loopId=${sessionId}`,
          `objective=${current.objective}`,
          `step=${step.id}`,
          `repairAt=${new Date().toISOString()}`,
          '',
          '修复建议：',
          '- 回看最近一次测试失败输出',
          '- 仅修改与失败栈最相关的文件',
          '- 修复后立即重跑最小测试集',
        ].join('\n');
        const write = await window.zytrader.fs.write(reportPath, report, { scope: 'vault' });
        if (write.ok) {
          fileChanges.push(reportPath);
          toolHistory.push(`fs.write:${reportPath}`);
        }
      }

      /* ── release_check 步骤：使用 ReleaseGate ── */
      if (step.type === 'release_check') {
        const verification = this.verifier.verify(current);
        const releaseResult = this.releaseGate.checkReadiness(current, verification);
        toolHistory.push(`release-gate:${releaseResult.canRelease ? 'can-release' : 'not-ready'}`);
        if (releaseResult.requiresApproval) {
          warnings.push(`发布需要审批: ${releaseResult.approvalReasons.join('; ')}`);
        }
        if (!releaseResult.canRelease && !releaseResult.requiresApproval) {
          blockers.push(`发布条件未满足: ${releaseResult.summary}`);
        }
      }

      return { toolHistory, fileChanges, blockers, warnings, matrixUpdates, statusHint: 'verifying' };
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
      return { toolHistory, fileChanges, blockers, warnings, matrixUpdates, statusHint: 'paused' };
    }
  }

  /* ── 验证后处理 ──────────────────────────────────────── */

  private nextStepStatus(step: LoopPlanStep): LoopPlanStep['status'] {
    if (step.type === 'test') return 'running';
    if (step.type === 'repair') return 'running';
    return 'pending';
  }

  private async applyVerification(sessionId: string, current: LoopState, verification: ReturnType<LoopVerifierService['verify']>): Promise<LoopState> {
    // 所有计划步骤是否已完成
    const allPlanDone = current.currentPlan.length === 0;

    let nextStatus: LoopState['status'];
    if (verification.passed) {
      nextStatus = verification.recommendation === 'release'
        ? 'ready_for_release'
        : verification.recommendation === 'stop'
          ? 'completed'
          : allPlanDone
            ? 'ready_for_review'
            : 'executing';
    } else {
      // 验证未通过，但所有计划步骤已完成
      // 对于非开发类任务，验证矩阵中可能存在与任务无关的 pending 维度，
      // 此时不应阻塞，直接进入 ready_for_review
      const nonDevTaskTypes: LoopState['taskType'][] = ['analysis', 'docs', 'general'];
      if (allPlanDone && nonDevTaskTypes.includes(current.taskType)) {
        nextStatus = 'ready_for_review';
      } else if (verification.recommendation === 'pause') {
        nextStatus = 'paused';
      } else {
        nextStatus = 'repairing';
      }
    }

    // 验证通过时清空 blockedReasons
    const nextBlockedReasons = verification.passed ? [] : (
      verification.blockers.length ? [...current.blockedReasons, ...verification.blockers] : current.blockedReasons
    );

    // 验证后写入真实内容的验证文档
    const currentStep = current.currentPlan[0];
    const verificationDoc = currentStep
      ? await this.docWriter.writeStepDoc(current, currentStep, verification)
      : undefined;
    const stepDocs = verificationDoc
      ? [...current.stepDocs, verificationDoc]
      : current.stepDocs;

    const next = this.loopCommand.update(sessionId, {
      status: nextStatus,
      stepDocs: stepDocs.slice(-50),
      validationHistory: [...current.validationHistory, verification].slice(-50),
      blockedReasons: nextBlockedReasons.slice(-20),
      lastSummary: verification.passed ? current.lastSummary : `验证失败：${verification.blockers.join(', ') || verification.errors.join(', ')}`,
      memoryRefs: [...current.memoryRefs, `verification:${verification.stage}:${Date.now()}`].slice(-100),
    });

    return next ?? current;
  }

  /* ── 辅助方法 ────────────────────────────────────────── */

  private buildMessages(state: LoopState, verification: ReturnType<LoopVerifierService['verify']>, executedStep?: LoopPlanStep): string[] {
    const messages = [
      executedStep ? `执行步骤：${executedStep.title}` : '本轮未执行具体步骤',
      `状态：${state.status}`,
      `轮次：${state.iteration}/${state.maxIterations}`,
      `验证：${verification.passed ? '通过' : '未通过'}`,
    ];

    if (verification.errors.length > 0) messages.push(`错误：${verification.errors.join('; ')}`);
    if (verification.warnings.length > 0) messages.push(`警告：${verification.warnings.join('; ')}`);
    if (verification.blockers.length > 0) messages.push(`阻塞：${verification.blockers.join('; ')}`);
    if (state.currentPlan.length > 0) messages.push(`下一步：${state.currentPlan[0]!.title}`);
    else messages.push('计划已收敛');
    return messages;
  }

  private pickNextStep(state: LoopState): LoopPlanStep | undefined {
    return state.currentPlan.find((step) => step.status === 'pending' || step.status === 'failed');
  }

  private buildExecutionSummary(step: LoopPlanStep, remainingPlan: LoopPlanStep[]): string {
    const tail = remainingPlan[0]?.title ?? '无后续步骤';
    return `已执行：${step.title}；下一步：${tail}`;
  }

  private isTerminalStatus(status: LoopState['status']): boolean {
    return ['blocked', 'paused', 'completed', 'ready_for_release', 'failed'].includes(status);
  }

  private requireState(sessionId: string): LoopState {
    const state = this.loopCommand.get(sessionId);
    if (!state) throw new Error(`Loop state not found for session ${sessionId}`);
    return state;
  }

  private mapPhase(step: LoopPlanStep): LoopState['phase'] {
    if (step.id === 'requirements') return 'requirements';
    if (step.type === 'design') return 'design';
    if (step.type === 'test' || step.type === 'verification') return 'verification';
    if (step.type === 'repair') return 'repair';
    if (step.type === 'summary') return 'summary';
    return 'development';
  }

  private updateVerificationMatrix(
    current: LoopState,
    step: LoopPlanStep,
    blockers: string[],
    matrixUpdates: ToolOutcome['matrixUpdates'],
  ): LoopState['verificationMatrix'] {
    if (matrixUpdates.length > 0) {
      return current.verificationMatrix.map((entry) => {
        const patch = matrixUpdates.find((item) => item.dimension === entry.dimension);
        if (!patch) return entry;
        return {
          ...entry,
          passed: patch.passed,
          evidence: patch.evidence,
          note: patch.note,
          updatedAt: new Date().toISOString(),
        };
      });
    }

    // 根据步骤类型和任务类型决定映射的验证维度
    // 仅开发/测试/运维类任务才将步骤结果映射到 compile/terminal 维度
    const isDevLikeTask = current.taskType === 'development' || current.taskType === 'testing' || current.taskType === 'ops';
    let dimension: LoopState['verificationMatrix'][number]['dimension'] | null = null;

    if (isDevLikeTask) {
      if (step.type === 'test' || step.type === 'verification') dimension = 'terminal';
      else if (step.type === 'implementation') dimension = 'compile';
    } else {
      // 非开发类任务：不映射到任何验证维度（避免 compile/terminal 被错误标记）
      dimension = null;
    }

    if (!dimension) return current.verificationMatrix;

    // 仅更新存在的维度
    const hasDimension = current.verificationMatrix.some((e) => e.dimension === dimension);
    if (!hasDimension) return current.verificationMatrix;

    return current.verificationMatrix.map((entry) =>
      entry.dimension === dimension
        ? {
            ...entry,
            passed: blockers.length === 0,
            evidence: blockers.length === 0 ? [`${step.id}:ok`] : blockers.slice(0, 3),
            updatedAt: new Date().toISOString(),
          }
        : entry,
    );
  }

  private pickBuildStatus(current: LoopState, step: LoopPlanStep, blockers: string[]): LoopState['buildStatus'] {
    // 仅开发/测试/运维类任务才更新 buildStatus
    const isDevLikeTask = current.taskType === 'development' || current.taskType === 'testing' || current.taskType === 'ops';
    if (!isDevLikeTask || !['test', 'implementation', 'verification'].includes(step.type)) return current.buildStatus;
    return blockers.length === 0 ? 'passed' : 'failed';
  }

  private pickUiStatus(current: LoopState, step: LoopPlanStep, blockers: string[]): LoopState['uiStatus'] {
    // 仅开发/测试类任务才更新 uiStatus
    const isDevLikeTask = current.taskType === 'development' || current.taskType === 'testing';
    if (!isDevLikeTask || step.type !== 'verification') return current.uiStatus;
    return blockers.length === 0 ? 'passed' : 'failed';
  }

  private pickApiStatus(current: LoopState, step: LoopPlanStep, blockers: string[]): LoopState['apiStatus'] {
    // 仅开发/测试类任务才更新 apiStatus
    const isDevLikeTask = current.taskType === 'development' || current.taskType === 'testing';
    if (!isDevLikeTask || step.type !== 'verification') return current.apiStatus;
    return blockers.length === 0 ? 'passed' : 'failed';
  }

  private pickDataStatus(current: LoopState, step: LoopPlanStep, blockers: string[]): LoopState['dataStatus'] {
    // 仅开发/测试类任务才更新 dataStatus
    const isDevLikeTask = current.taskType === 'development' || current.taskType === 'testing';
    if (!isDevLikeTask || step.type !== 'verification') return current.dataStatus;
    return blockers.length === 0 ? 'passed' : 'failed';
  }

  /**
   * 对于非开发类任务（analysis/docs/general），analysis/summary 步骤完成后
   * 自动将验证矩阵中尚处于 pending 状态的维度标记为通过（跳过），
   * 因为这些任务不需要编译/终端等验证。
   */
  private buildAutoPassMatrixUpdates(
    current: LoopState,
    step: LoopPlanStep,
  ): ToolOutcome['matrixUpdates'] {
    // 仅对非开发类任务，且步骤类型为 analysis/summary 时自动通过
    const nonDevTaskTypes: LoopState['taskType'][] = ['analysis', 'docs', 'general'];
    if (!nonDevTaskTypes.includes(current.taskType)) return [];
    if (step.type !== 'analysis' && step.type !== 'summary') return [];

    const updates: ToolOutcome['matrixUpdates'] = [];
    for (const entry of current.verificationMatrix) {
      // 只自动通过尚未完成的维度（pending 状态）
      if (!entry.passed && (entry.note === 'pending' || entry.note === 'skipped')) {
        updates.push({
          dimension: entry.dimension,
          passed: true,
          evidence: [`auto-skipped for ${current.taskType} task`],
          note: 'skipped',
        });
      }
    }
    return updates;
  }

  /**
   * 合并矩阵更新：toolOutcome 的实际结果优先，自动通过的作为兜底。
   */
  private mergeMatrixUpdates(
    autoPassUpdates: ToolOutcome['matrixUpdates'],
    toolUpdates: ToolOutcome['matrixUpdates'],
  ): ToolOutcome['matrixUpdates'] {
    const result = [...toolUpdates];
    for (const auto of autoPassUpdates) {
      // 如果 toolOutcome 已有同维度的更新，优先使用 toolOutcome 的结果
      const alreadyHas = result.some((r) => r.dimension === auto.dimension);
      if (!alreadyHas) {
        result.push(auto);
      }
    }
    return result;
  }

  /* ── 终端命令执行 ────────────────────────────────────── */

  /** 跨平台命令前缀 */
  private cmdPrefix(): string {
    if (typeof navigator !== 'undefined' && /win/i.test(navigator.platform)) return 'cmd.exe /c ';
    return '';
  }

  /** 带超时的终端命令执行 */
  private async execCommand(command: string): Promise<{ ok: boolean; code: number; out: string }> {
    const timeoutPromise = new Promise<{ ok: false; code: 124; out: string }>((resolve) => {
      setTimeout(() => resolve({ ok: false, code: 124, out: `命令超时（${EXEC_TIMEOUT_MS}ms）` }), EXEC_TIMEOUT_MS);
    });

    const execPromise = (async () => {
      const exec = await window.zytrader.terminal.exec(command, '.');
      const out = `${exec.stdout ?? ''}\n${exec.stderr ?? ''}`.trim();
      return {
        ok: Boolean(exec.ok) && Number(exec.code ?? 1) === 0,
        code: Number(exec.code ?? 1),
        out,
      };
    })();

    return Promise.race([execPromise, timeoutPromise]);
  }

  private isMissingScript(output: string): boolean {
    return /Missing script:/i.test(output);
  }

  /* ── 仪表盘 + 工件归档 ───────────────────────────────── */

  private writeDashboardAndArchive(state: LoopState, verification: ReturnType<LoopVerifierService['verify']>): void {
    const dashboardVm = this.dashboard.buildDashboard(state, verification);
    this.dashboard.writeDashboardToDisk(dashboardVm).catch((err) => {
      console.warn('[LoopExecutor] Dashboard 写入失败:', err);
    });

    const index = this.artifactStore.buildIndex(state);
    this.artifactStore.writeIndexToDisk(index).catch((err) => {
      console.warn('[LoopExecutor] ArtifactIndex 写入失败:', err);
    });
  }
}
