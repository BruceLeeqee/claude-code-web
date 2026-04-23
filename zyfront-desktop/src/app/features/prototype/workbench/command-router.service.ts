import { Injectable } from '@angular/core';
import {
  type CommandRoute,
  type RouteOptions,
  type RouteResult,
  type RoutingContext,
  extractRoutingContext,
  ROUTING_CONSTANTS,
} from './command-routing.types';
import { findDirectiveDefinition, isBridgeSafeDirectiveName } from './directive-registry';

export type { CommandRoute, RouteOptions, RouteResult, RoutingContext } from './command-routing.types';

@Injectable({ providedIn: 'root' })
export class CommandRouterService {
  private readonly shellCommands = ROUTING_CONSTANTS.SHELL_COMMANDS;
  private readonly naturalKeywords = ROUTING_CONSTANTS.NATURAL_LANGUAGE_KEYWORDS;

  route(input: string, options: RouteOptions = {}): CommandRoute {
    return this.routeWithExplanation(input, options).route;
  }

  routeWithExplanation(input: string, options: RouteOptions = {}): RouteResult {
    const ctx = extractRoutingContext(input);
    const reasons: string[] = [];
    let confidence = 0;
    let suggestedFallback: CommandRoute | undefined;

    if (!ctx.firstToken) {
      return {
        route: 'natural',
        confidence: 1.0,
        reasons: ['Empty input defaults to natural language'],
      };
    }

    if (options.skipSlashCommands && ctx.startsWithSlash) {
      if (options.bridgeOrigin) {
        const def = this.findDirective(ctx.firstToken);
        if (def && isBridgeSafeDirectiveName(def.name)) {
          reasons.push('Bridge origin allows bridge-safe slash directive');
          return { route: 'directive', confidence: 1.0, reasons };
        }
      }

      reasons.push('skipSlashCommands flag set, treating slash as natural');
      return { route: 'natural', confidence: 0.9, reasons, suggestedFallback: 'directive' };
    }

    if (ctx.startsWithSlash) {
      const def = this.findDirective(ctx.firstToken);
      confidence += 0.95;
      reasons.push('Starts with / → directive');

      if (def) {
        confidence = 1.0;
        reasons.push(`${ctx.firstToken} is a registered directive`);
      } else {
        confidence = 0.7;
        reasons.push(`${ctx.firstToken} is not a registered directive, may fall back to natural`);
        suggestedFallback = 'natural';
      }

      return { route: 'directive', confidence, reasons, suggestedFallback };
    }

    if (ctx.startsWithExclamation) {
      reasons.push('Starts with ! → shell (explicit shell prefix)');
      return { route: 'shell', confidence: 1.0, reasons };
    }

    if (ctx.startsWithQuestion) {
      reasons.push('Starts with ? → natural (explicit natural prefix)');
      return { route: 'natural', confidence: 1.0, reasons };
    }

    if (ctx.hasChinese) {
      confidence += 0.9;
      reasons.push('Contains Chinese characters → strong natural language signal');
    }

    const likelyNaturalSentence = this.evaluateNaturalLanguageLikelihood(ctx);
    const likelyShell = this.evaluateShellLikelihood(ctx);

    if (likelyNaturalSentence && !likelyShell) {
      confidence += 0.8;
      reasons.push('High word count with no shell indicators → natural language');
      return { route: 'natural', confidence, reasons, suggestedFallback: 'shell' };
    }

    if (likelyShell && !likelyNaturalSentence) {
      confidence += 0.85;
      reasons.push('Shell indicators present → shell command');
      return { route: 'shell', confidence, reasons, suggestedFallback: 'natural' };
    }

    if (likelyNaturalSentence && likelyShell) {
      if (ctx.hasChinese) {
        confidence = 0.85;
        reasons.push('Conflict resolved: Chinese + shell indicators → natural (cultural context)');
        return { route: 'natural', confidence, reasons, suggestedFallback: 'shell' };
      }

      confidence = 0.5;
      reasons.push('Ambiguous input, defaulting to natural language');
      return { route: 'natural', confidence, reasons, suggestedFallback: 'shell' };
    }

    if (options.preferNaturalLanguage && ctx.hasWhitespace) {
      confidence = 0.6;
      reasons.push('preferNaturalLanguage option set');
      return { route: 'natural', confidence, reasons, suggestedFallback: 'shell' };
    }

    confidence = 0.55;
    reasons.push('No strong indicators, defaulting to natural language');
    return { route: 'natural', confidence, reasons, suggestedFallback: 'shell' };
  }

  private findDirective(token: string) {
    const normalized = token.startsWith('/') ? token : `/${token}`;
    return findDirectiveDefinition(normalized);
  }

  private evaluateNaturalLanguageLikelihood(ctx: RoutingContext): boolean {
    if (ctx.endsWithQuestionMark) return true;

    const hasQuestionWords = /\b(how|why|what|when|where|who|which|can|could|would|should)\b/i.test(ctx.firstToken);
    if (hasQuestionWords && ctx.wordCount >= 2) return true;

    for (const keyword of this.naturalKeywords) {
      if (ctx.firstToken.includes(keyword)) return true;
    }

    if (ctx.wordCount >= 4 && !this.shellCommands.has(ctx.firstToken) && !ctx.hasShellOperators) {
      return true;
    }

    return false;
  }

  private evaluateShellLikelihood(ctx: RoutingContext): boolean {
    if (this.shellCommands.has(ctx.firstToken)) return true;

    if (ctx.hasPathPattern) return true;

    if (ctx.hasShellOperators) return true;

    return false;
  }
}
