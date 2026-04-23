import { Injectable, inject } from '@angular/core';
import { CommandRouterService, type RouteResult, type CommandRoute } from './command-router.service';
import { CommandExecutorService, type ExecutionInput, type ExecutionResult } from './command-executor.service';
import { InputPreprocessorService, type InputSource, type PreprocessedInput, type InputPreprocessorOptions } from './input-preprocessor.service';
import {
  parseDirectiveWithValidation,
  type ParseResult,
} from './directive-parser';
import {
  DIRECTIVE_REGISTRY,
  type DirectiveDefinition,
} from './directive-registry';

export interface CommandProcessingContext {
  sessionId?: string;
  mode?: string;
  source?: InputSource;
}

export interface ProcessedCommand {
  originalInput: string;
  preprocessed: PreprocessedInput;
  routeResult: RouteResult;
  parseResult?: ParseResult;
  executionResult: ExecutionResult;
  timestamp: number;
}

export interface CommandProcessorOptions {
  source?: InputSource;
  isMeta?: boolean;
  preservePrefixes?: boolean;
  allowBridgeSlashCommands?: boolean;
  skipExecution?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CommandProcessingService {
  private readonly router = inject(CommandRouterService);
  private readonly executor = inject(CommandExecutorService);
  private readonly preprocessor = inject(InputPreprocessorService);

  async process(
    input: string,
    context: CommandProcessingContext = {},
    options: CommandProcessorOptions = {}
  ): Promise<ProcessedCommand> {
    const timestamp = Date.now();

    const preprocessorOptions: InputPreprocessorOptions = {
      source: options.source ?? context.source,
      isMeta: options.isMeta,
      preservePrefixes: options.preservePrefixes,
      allowBridgeSlashCommands: options.allowBridgeSlashCommands,
    };

    const preprocessed = this.preprocessor.preprocess(input, preprocessorOptions);

    const routeOptions = {
      skipSlashCommands: preprocessed.shouldSkipSlashCommands,
      bridgeOrigin: preprocessed.isBridgeOrigin,
    };

    const routeResult = this.router.routeWithExplanation(preprocessed.normalized, routeOptions);

    let parseResult: ParseResult | undefined;

    if (routeResult.route === 'directive' && !preprocessed.shouldSkipSlashCommands) {
      parseResult = parseDirectiveWithValidation(preprocessed.normalized, {
        skipUnknownCommands: preprocessed.source === 'bridge',
      });
    }

    let executionResult: ExecutionResult;

    if (options.skipExecution) {
      executionResult = {
        success: true,
        route: routeResult.route,
        responseType: 'fallback',
        content: preprocessed.normalized,
        shouldQuery: false,
        displayType: 'message',
      };
    } else {
      const normalizedSource = preprocessed.source === 'unknown' ? 'user' : preprocessed.source;
      const executionInput: ExecutionInput = {
        raw: preprocessed.normalized,
        context: {
          source: normalizedSource,
          sessionId: context.sessionId,
          mode: context.mode,
        },
        options: routeOptions,
      };

      executionResult = await this.executor.execute(executionInput);
    }

    return {
      originalInput: input,
      preprocessed,
      routeResult,
      parseResult,
      executionResult,
      timestamp,
    };
  }

  async processDirective(
    input: string,
    context: CommandProcessingContext = {}
  ): Promise<ExecutionResult> {
    const result = await this.process(input, context, {
      skipExecution: false,
    });

    return result.executionResult;
  }

  async processShell(
    input: string,
    context: CommandProcessingContext = {}
  ): Promise<ExecutionResult> {
    const result = await this.process(input, context, {
      skipExecution: false,
    });

    return result.executionResult;
  }

  async processNatural(
    input: string,
    context: CommandProcessingContext = {}
  ): Promise<ExecutionResult> {
    const result = await this.process(input, context, {
      skipExecution: false,
    });

    return result.executionResult;
  }

  routeOnly(input: string, options?: { source?: InputSource }): RouteResult {
    const preprocessed = this.preprocessor.preprocess(input, {
      source: options?.source,
    });

    return this.router.routeWithExplanation(preprocessed.normalized, {
      skipSlashCommands: preprocessed.shouldSkipSlashCommands,
      bridgeOrigin: preprocessed.isBridgeOrigin,
    });
  }

  parseOnly(input: string): ParseResult {
    return parseDirectiveWithValidation(input);
  }

  getDiagnosticInfo(input: string): {
    preprocessed: PreprocessedInput;
    routeResult: RouteResult;
    parseResult?: ParseResult;
    suggestions?: DirectiveDefinition[];
  } {
    const preprocessed = this.preprocessor.preprocess(input);
    const routeResult = this.router.routeWithExplanation(preprocessed.normalized);
    const parseResult = input.trim().startsWith('/')
      ? parseDirectiveWithValidation(input)
      : undefined;

    let suggestions: DirectiveDefinition[] | undefined;

    if (!parseResult?.success && input.trim().startsWith('/')) {
      const partial = input.trim().slice(1).split(/\s+/)[0];
      if (partial) {
        suggestions = DIRECTIVE_REGISTRY.filter(def =>
          def.name.toLowerCase().includes(partial.toLowerCase())
        ).slice(0, 5);
      }
    }

    return {
      preprocessed,
      routeResult,
      parseResult,
      suggestions,
    };
  }

  formatRoutingExplanation(routeResult: RouteResult): string {
    const lines: string[] = [];
    lines.push(`**路由结果**: ${routeResult.route}`);
    lines.push(`**置信度**: ${(routeResult.confidence * 100).toFixed(0)}%`);
    lines.push('');
    lines.push('**路由原因**:');
    for (const reason of routeResult.reasons) {
      lines.push(`- ${reason}`);
    }

    if (routeResult.suggestedFallback) {
      lines.push('');
      lines.push(`**建议回退**: ${routeResult.suggestedFallback}`);
    }

    return lines.join('\n');
  }

  formatCommandPreview(command: ProcessedCommand): string {
    const lines: string[] = [];
    lines.push(`**原始输入**: ${command.originalInput}`);
    lines.push(`**标准化输入**: ${command.preprocessed.normalized}`);
    lines.push(`**输入来源**: ${command.preprocessed.source}`);
    lines.push(`**路由结果**: ${command.routeResult.route} (${(command.routeResult.confidence * 100).toFixed(0)}%)`);

    if (command.parseResult?.directive.def) {
      lines.push(`**识别命令**: ${command.parseResult.directive.def.name}`);
      lines.push(`**命令描述**: ${command.parseResult.directive.def.desc}`);
    }

    lines.push(`**执行结果**: ${command.executionResult.success ? '成功' : '失败'}`);
    lines.push(`**需要查询**: ${command.executionResult.shouldQuery ? '是' : '否'}`);

    return lines.join('\n');
  }
}
