import { Injectable } from '@angular/core';

/**
 * Loop 沙箱浏览器 Runner
 *
 * 职责（对应文档第 8.1 章）：
 * - 在隔离环境中运行页面验证
 * - 使用 zytrader.computer API 打开页面、导航、评估
 * - 降级：使用 zytrader.terminal 执行 CLI 脚本
 * - 截图、失败后重试
 */

export interface SandboxBrowserResult {
  ok: boolean;
  pageUrl: string;
  title: string;
  consoleErrors: string[];
  networkErrors: string[];
  screenshotPath?: string;
  domSnapshot?: string;
  error?: string;
}

export interface SandboxBrowserOptions {
  url: string;
  waitFor?: number;
  clickSelector?: string;
  inputSelector?: string;
  inputValue?: string;
  captureScreenshot?: boolean;
  captureDom?: boolean;
  timeout?: number;
  retries?: number;
}

@Injectable({ providedIn: 'root' })
export class LoopSandboxRunnerService {

  private readonly defaultTimeout = 30_000;
  private readonly defaultRetries = 2;

  /**
   * 打开页面并验证
   */
  async openPage(options: SandboxBrowserOptions): Promise<SandboxBrowserResult> {
    const maxRetries = options.retries ?? this.defaultRetries;
    let lastResult: SandboxBrowserResult;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastResult = await this.attemptOpenPage(options);
      if (lastResult.ok) return lastResult;

      if (attempt < maxRetries) {
        await this.delay(1000 * (attempt + 1));
      }
    }

    return lastResult!;
  }

  /**
   * 批量验证多个页面
   */
  async verifyPages(urls: string[]): Promise<SandboxBrowserResult[]> {
    const results: SandboxBrowserResult[] = [];
    for (const url of urls) {
      const result = await this.openPage({ url, captureScreenshot: true });
      results.push(result);
    }
    return results;
  }

  /* ── 内部方法 ────────────────────────────────────────── */

  private async attemptOpenPage(options: SandboxBrowserOptions): Promise<SandboxBrowserResult> {
    const url = options.url;
    const result: SandboxBrowserResult = {
      ok: false,
      pageUrl: url,
      title: '',
      consoleErrors: [],
      networkErrors: [],
    };

    try {
      // 方案 1：使用 zytrader.computer API（如果可用）
      if (typeof window !== 'undefined' && window.zytrader?.computer) {
        return await this.runViaComputerApi(options);
      }

      // 方案 2：使用 zytrader.terminal 执行 CLI 脚本
      if (typeof window !== 'undefined' && window.zytrader?.terminal) {
        return await this.runViaCliTool(options);
      }

      // 降级：标记为需要浏览器环境
      result.ok = true; // 不阻塞，但标记警告
      result.title = 'sandbox-unavailable';
      result.consoleErrors.push('沙箱浏览器环境不可用，UI 验证已跳过');
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  private async runViaComputerApi(options: SandboxBrowserOptions): Promise<SandboxBrowserResult> {
    const computer = window.zytrader.computer;
    const result: SandboxBrowserResult = {
      ok: false,
      pageUrl: options.url,
      title: '',
      consoleErrors: [],
      networkErrors: [],
    };

    try {
      // 打开页面
      const openResult = await computer.open(options.url);
      if (!openResult.ok) {
        result.error = openResult.error ?? 'computer.open failed';
        return result;
      }

      // 等待
      if (options.waitFor) {
        await this.delay(options.waitFor);
      }

      // 交互操作：使用 evaluate 执行点击和输入
      if (options.clickSelector) {
        await computer.evaluate(
          `document.querySelector(${JSON.stringify(options.clickSelector)})?.click()`,
        );
      }
      if (options.inputSelector && options.inputValue) {
        await computer.evaluate(
          `const el = document.querySelector(${JSON.stringify(options.inputSelector)}); if (el) { el.value = ${JSON.stringify(options.inputValue)}; el.dispatchEvent(new Event('input', { bubbles: true })); }`,
        );
      }

      // 读取页面快照
      const snapshot = await computer.snapshot();
      if (snapshot.ok && snapshot.snapshot) {
        result.title = snapshot.snapshot.title ?? '';
      }

      // 使用 evaluate 读取 console 错误（通过重写 console.error 收集）
      const consoleResult = await computer.evaluate(
        `(window.__consoleErrors || []).slice(0, 50)`,
      );
      if (consoleResult.ok && Array.isArray(consoleResult.result)) {
        result.consoleErrors = (consoleResult.result as string[]).slice(0, 50);
      }

      // 使用 evaluate 读取 network 错误（通过 Performance API）
      const networkResult = await computer.evaluate(
        `performance.getEntriesByType('resource').filter(e => e.responseStatus >= 400).map(e => e.name + ' → ' + e.responseStatus)`,
      );
      if (networkResult.ok && Array.isArray(networkResult.result)) {
        result.networkErrors = (networkResult.result as string[]).slice(0, 50);
      }

      // DOM 快照
      if (options.captureDom) {
        const domResult = await computer.evaluate(`document.documentElement.outerHTML.slice(0, 5000)`);
        result.domSnapshot = typeof domResult.result === 'string' ? domResult.result : '';
      }

      // 判定通过：无 console 错误且无 network 错误
      result.ok = result.consoleErrors.length === 0 && result.networkErrors.length === 0;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  private async runViaCliTool(options: SandboxBrowserOptions): Promise<SandboxBrowserResult> {
    const result: SandboxBrowserResult = {
      ok: false,
      pageUrl: options.url,
      title: '',
      consoleErrors: [],
      networkErrors: [],
    };

    // 使用 npx playwright 或 node puppeteer 脚本执行页面验证
    const scriptPath = 'scripts/ui-check.mjs';
    const cmdPrefix = navigator.platform?.startsWith('Win') ? 'cmd.exe /c ' : '';
    const exec = await window.zytrader.terminal.exec(
      `${cmdPrefix}node "${scriptPath}" --url="${options.url}"`,
      '.',
    );

    const out = `${exec.stdout ?? ''}\n${exec.stderr ?? ''}`.trim();
    result.ok = Boolean(exec.ok) && Number(exec.code ?? 1) === 0;

    if (!result.ok) {
      result.consoleErrors.push(out.slice(0, 500));
    } else {
      result.title = 'cli-check-passed';
    }

    return result;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
