import { Injectable } from '@angular/core';

export type InputSource = 'user' | 'bridge' | 'system' | 'unknown';

export interface PreprocessedInput {
  original: string;
  normalized: string;
  source: InputSource;
  shouldSkipSlashCommands: boolean;
  isBridgeOrigin: boolean;
  isMeta: boolean;
  prefixPreserved: string | null;
}

export interface InputPreprocessorOptions {
  source?: InputSource;
  isMeta?: boolean;
  preservePrefixes?: boolean;
  allowBridgeSlashCommands?: boolean;
}

@Injectable({ providedIn: 'root' })
export class InputPreprocessorService {
  private readonly BRIDGE_SAFE_PREFIXES = ['/help', '/status', '/doctor', '/plugin:list'];
  private readonly SYSTEM_GENERATED_PATTERNS = [
    /^【.*】$/,
    /^\[系统提示\]/,
    /^\[Auto\]/,
    /^助理提示：/,
  ];
  private readonly ESCAPE_PREFIXES = ['\\/', '\\!', '\\?'];

  preprocess(
    input: string,
    options: InputPreprocessorOptions = {}
  ): PreprocessedInput {
    const source = options.source ?? this.detectSource(input);
    const normalized = this.normalizeInput(input, options);
    const prefixPreserved = this.extractPrefix(normalized);

    let shouldSkipSlashCommands = source === 'bridge';
    let isBridgeOrigin = source === 'bridge';
    let isMeta = options.isMeta ?? this.isSystemGenerated(normalized);

    if (source === 'bridge' && options.allowBridgeSlashCommands) {
      const prefix = prefixPreserved?.toLowerCase();
      if (prefix && this.BRIDGE_SAFE_PREFIXES.includes(prefix)) {
        shouldSkipSlashCommands = false;
      }
    }

    return {
      original: input,
      normalized,
      source,
      shouldSkipSlashCommands,
      isBridgeOrigin,
      isMeta,
      prefixPreserved,
    };
  }

  private detectSource(input: string): InputSource {
    if (this.isSystemGenerated(input)) {
      return 'system';
    }

    if (this.hasBridgeMarker(input)) {
      return 'bridge';
    }

    return 'user';
  }

  private normalizeInput(input: string, options: InputPreprocessorOptions): string {
    let normalized = input.trim();

    if (options.preservePrefixes) {
      return normalized;
    }

    for (const escapePrefix of this.ESCAPE_PREFIXES) {
      const regex = new RegExp(`^${escapePrefix}`);
      if (regex.test(normalized)) {
        normalized = normalized.replace(regex, normalized[0]);
        break;
      }
    }

    return normalized;
  }

  private extractPrefix(input: string): string | null {
    const trimmed = input.trim();

    if (trimmed.startsWith('/')) {
      const spaceIndex = trimmed.indexOf(' ');
      return spaceIndex === -1
        ? trimmed.toLowerCase()
        : trimmed.substring(0, spaceIndex).toLowerCase();
    }

    if (trimmed.startsWith('!') || trimmed.startsWith('?')) {
      return trimmed[0];
    }

    return null;
  }

  private isSystemGenerated(input: string): boolean {
    return this.SYSTEM_GENERATED_PATTERNS.some(pattern => pattern.test(input.trim()));
  }

  private hasBridgeMarker(input: string): boolean {
    const markers = ['[bridge]', '[remote]', '[ccr]', '<bridge>', '<remote>'];
    const lower = input.toLowerCase();
    return markers.some(marker => lower.includes(marker));
  }

  isBridgeSafeDirective(directiveName: string): boolean {
    const normalized = directiveName.startsWith('/') ? directiveName : `/${directiveName}`;
    return this.BRIDGE_SAFE_PREFIXES.includes(normalized.toLowerCase());
  }

  shouldBlockBridgeCommand(commandName: string): boolean {
    if (this.isBridgeSafeDirective(commandName)) {
      return false;
    }
    return true;
  }

  sanitizeBridgeInput(input: string): { sanitized: string; wasModified: boolean } {
    const markers = [
      { pattern: /\[bridge\]/gi, replacement: '' },
      { pattern: /\[remote\]/gi, replacement: '' },
      { pattern: /\[ccr\]/gi, replacement: '' },
      { pattern: /<bridge>/gi, replacement: '' },
      { pattern: /<remote>/gi, replacement: '' },
    ];

    let sanitized = input;
    let wasModified = false;

    for (const { pattern, replacement } of markers) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, replacement);
        wasModified = true;
      }
    }

    return { sanitized: sanitized.trim(), wasModified };
  }
}
