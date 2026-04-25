import { Injectable } from '@angular/core';

declare const window: Window & typeof globalThis;

/**
 * Loop 终端沙箱服务
 *
 * 职责（对应文档第 8.2 章）：
 * - 在终端 tab 中运行自动化验证
 * - 编译、测试、构建
 * - 接口模拟调用
 * - 数据检查脚本
 */

export interface TerminalSandboxResult {
  ok: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface TerminalSandboxBatch {
  results: TerminalSandboxResult[];
  allPassed: boolean;
  totalDuration: number;
  failedCommands: string[];
}

@Injectable({ providedIn: 'root' })
export class LoopTerminalSandboxService {

  /**
   * 执行单条终端命令
   */
  async exec(command: string, cwd = '.'): Promise<TerminalSandboxResult> {
    const start = Date.now();

    if (typeof window === 'undefined' || !window.zytrader?.terminal?.exec) {
      return {
        ok: false,
        command,
        exitCode: 1,
        stdout: '',
        stderr: 'terminal sandbox unavailable',
        duration: Date.now() - start,
      };
    }

    const terminalHint = this.getTerminalAvailabilityHint();
    if (terminalHint.blocked) {
      return {
        ok: false,
        command,
        exitCode: 1,
        stdout: '',
        stderr: terminalHint.message,
        duration: Date.now() - start,
      };
    }

    const exec = await window.zytrader.terminal.exec(command, cwd);
    const stdout = (exec.stdout ?? '').toString();
    const stderr = (exec.stderr ?? '').toString();
    const exitCode = Number(exec.code ?? 1);

    return {
      ok: exitCode === 0,
      command,
      exitCode,
      stdout,
      stderr,
      duration: Date.now() - start,
    };
  }

  /**
   * 批量执行终端命令
   */
  async execBatch(commands: string[], cwd = '.'): Promise<TerminalSandboxBatch> {
    const results: TerminalSandboxResult[] = [];
    const failedCommands: string[] = [];
    let totalDuration = 0;

    for (const cmd of commands) {
      const result = await this.exec(cmd, cwd);
      results.push(result);
      totalDuration += result.duration;
      if (!result.ok) failedCommands.push(cmd);
    }

    return {
      results,
      allPassed: failedCommands.length === 0,
      totalDuration,
      failedCommands,
    };
  }

  /**
   * 运行编译验证
   */
  async runCompileCheck(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npx ng build zyfront-desktop-web --base-href ./');
  }

  /**
   * 运行类型检查
   */
  async runTypeCheck(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npx tsc --noEmit --project tsconfig.app.json');
  }

  /**
   * 运行 lint 检查
   */
  async runLint(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npx ng lint');
  }

  /**
   * 运行单元测试
   */
  async runUnitTests(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npm test -- --runInBand --no-watch');
  }

  /**
   * 运行综合验证（npm run check）
   */
  async runFullCheck(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npm run check');
  }

  /**
   * 运行 UTF-8 验证
   */
  async runUtf8Check(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npm run verify:utf8');
  }

  /**
   * 运行 API 检查
   */
  async runApiCheck(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npm run api:check');
  }

  /**
   * 运行数据检查
   */
  async runDataCheck(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npm run data:check');
  }

  /**
   * 运行 UI 检查
   */
  async runUiCheck(): Promise<TerminalSandboxResult> {
    return this.exec('cmd.exe /c npm run ui:check');
  }

  /**
   * 运行完整验证矩阵（编译 + lint + 类型检查 + check）
   */
  async runVerificationMatrix(): Promise<TerminalSandboxBatch> {
    return this.execBatch([
      'cmd.exe /c npx tsc --noEmit --project tsconfig.app.json',
      'cmd.exe /c npm run verify:utf8',
      'cmd.exe /c npm run check',
    ]);
  }

  private getTerminalAvailabilityHint(): { blocked: boolean; message: string } {
    if (typeof navigator === 'undefined') {
      return { blocked: true, message: '终端环境不可用，Loop 任务已阻断' };
    }

    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?? navigator.platform
      ?? '';
    const isWindows = /win/i.test(platform);
    const hasWslHint = typeof window !== 'undefined' && Boolean((window as Window & { zytrader?: { env?: { wsl?: boolean } } }).zytrader?.env?.wsl);
    const hasTerminal = typeof window !== 'undefined' && Boolean(window.zytrader?.terminal?.exec);

    if (!hasTerminal) {
      return { blocked: true, message: '终端不可用：缺少 zytrader.terminal.exec，Loop 任务已阻断' };
    }

    if (isWindows && !hasWslHint) {
      return { blocked: true, message: '检测到 Windows 环境但未检测到 WSL 可用，Loop 任务已阻断，请先启用 WSL/终端沙箱' };
    }

    return { blocked: false, message: '' };
  }
}
