/**
 * 终端块级渲染服务（M3: 展示渲染改造）
 *
 * 基于 Claude Code 终端展示优化设计文档（§9）：
 * - 由"覆盖式写回 + 插入行"混合策略改为"块级重绘式"
 * - 统一滚动锚点策略（优先级：marker > block id > buffer range > 文本匹配）
 * - 展开布局：先确认可见区域 → 预估展开高度 → 预留行位 → 写入内容
 * - 收起时恢复占位行
 */

import { Injectable, inject } from '@angular/core';
import { Terminal, type IMarker } from 'xterm';
import { ThinkingBlockStateMachineService } from './thinking-block-state-machine.service';
import {
  type ThinkingBlockMeta,
  type BlockRenderCommand,
  type BlockRenderAction,
  type ThinkingExpandedRange,
} from './terminal-display.types';

@Injectable({ providedIn: 'root' })
export class TerminalBlockRendererService {
  private readonly stateMachine = inject(ThinkingBlockStateMachineService);

  // ─── 配置 ──────────────────────────────────────────────────

  /** 安全边距：展开/收起操作前后保留的额外行数 */
  private readonly SCROLL_SAFETY_MARGIN = 2;

  /** 最大允许插入行数（防止异常数据导致大量空行） */
  private readonly MAX_INSERT_ROWS = 200;

  // ─── 块级重绘主路径 ────────────────────────────────────────

  /**
   * 执行块级重绘指令
   *
   * 替代旧的 overlay 主路径，统一由块级渲染器输出折叠态或展开态。
   */
  executeRenderCommand(term: Terminal, command: BlockRenderCommand): boolean {
    const { action } = command;
    switch (action.type) {
      case 'render-collapsed':
        return this.renderCollapsed(term, action.blockId);
      case 'render-expanded':
        return this.renderExpanded(term, action.blockId);
      case 'insert-placeholder':
        return this.insertPlaceholderRows(term, action.blockId, action.rows);
      case 'remove-placeholder':
        return this.removePlaceholderRows(term, action.blockId, action.rows);
      case 'scroll-to-block':
        return this.scrollToBlock(term, action.blockId);
      default:
        return false;
    }
  }

  /**
   * 展开思考块（块级重绘式）
   *
   * 步骤（§9.3 展开布局建议）：
   * 1. 确认可见区域
   * 2. 预估展开高度
   * 3. 为展开内容预留行位
   * 4. 写入内容
   */
  expandBlock(term: Terminal, blockId: number, preferAbsLine?: number): boolean {
    const block = this.stateMachine.getBlock(blockId);
    if (!block) return false;

    // 已展开则跳过
    if (this.stateMachine.isExpanded(blockId)) return false;

    // 定位折叠行
    const fold = this.locateFoldLines(term, blockId, preferAbsLine);
    if (!fold) return false;

    const cols = Math.max(20, term.cols);
    const plain = block.hasNonChinese ? this.sanitizeThinkingForDisplay(block.text) : block.text;
    const expandedRows = Math.max(1, this.countWrappedLines(term, plain, 0, cols));
    const collapsedRows = Math.max(1, block.collapsedRows);
    const insertedRows = Math.min(
      Math.max(0, expandedRows - collapsedRows),
      this.MAX_INSERT_ROWS,
    );

    // 确认可见区域
    const buf = term.buffer.normal;
    const relLast = fold.last - buf.viewportY;
    if (relLast < 0 || relLast >= term.rows) {
      // 折叠行不在可视区内，先滚动
      term.scrollToLine(fold.first);
    }

    // 写入展开内容（在行插入完成后调用）
    const writeExpandedBody = (): void => {
      const buf = term.buffer.normal;
      const relFirst = fold.first - buf.viewportY;
      if (relFirst < 0 || relFirst >= term.rows) return;

      // 先逐一擦除 expandedRows 行，避免旧内容残留
      let eraseSeq = '\x1b7';
      for (let i = 0; i < expandedRows; i++) {
        const row = relFirst + 1 + i;
        if (row > term.rows) break;
        eraseSeq += `\x1b[${row};1H\x1b[2K`;
      }
      eraseSeq += '\x1b8';
      term.write(eraseSeq);

      // 写入展开内容
      const body = plain.replace(/\r\n/g, '\n').replace(/\r/g, '').replaceAll('\n', '\r\n');
      term.write(`\x1b7\x1b[${relFirst + 1};1H${body}\x1b8`);
    };

    // 预留行位（插入空行）
    if (insertedRows > 0) {
      const buf2 = term.buffer.normal;
      const rel = fold.last - buf2.viewportY;
      if (rel < 0 || rel >= term.rows) return false;

      const targetRow = rel + 1;
      let seq = '\x1b7';
      seq += `\x1b[${targetRow};1H`;
      for (let i = 0; i < insertedRows; i++) {
        seq += '\x1b[L';
      }
      seq += '\x1b8';
      term.write(seq, () => writeExpandedBody());
    } else {
      writeExpandedBody();
    }

    // 状态迁移
    this.stateMachine.transition(blockId, 'inline-expanded');

    // 记录展开范围
    this.stateMachine.setExpandedRange(blockId, {
      first: fold.first,
      last: fold.last + insertedRows,
      insertedRows,
    });

    // 更新锚点
    this.stateMachine.updateBufferAnchor(blockId, {
      first: fold.first,
      last: fold.last + insertedRows,
    });

    // 持久化
    this.stateMachine.persistToSession();
    return true;
  }

  /**
   * 收起思考块（块级重绘式）
   *
   * 步骤：
   * 1. 在首行写回折叠态（标签+折叠提示）
   * 2. 删除展开时插入的空行，后续内容自然上移恢复原位
   */
  collapseBlock(term: Terminal, blockId: number, preferAbsLine?: number): boolean {
    const block = this.stateMachine.getBlock(blockId);
    if (!block) return false;

    // 未展开则跳过
    if (!this.stateMachine.isExpanded(blockId)) return false;

    const exp = this.stateMachine.getExpandedRange(blockId);
    const insertedRows = Math.max(0, exp?.insertedRows ?? 0);
    const firstLine = exp?.first;

    if (firstLine !== undefined) {
      // 有展开记录：标准收起流程
      term.scrollToLine(firstLine);
      const buf = term.buffer.normal;

      // 写回折叠态
      const expandedRows = insertedRows + block.collapsedRows;
      const relFirst = firstLine - buf.viewportY;
      if (relFirst >= 0 && relFirst < term.rows) {
        // 先擦除展开态占用的所有行，避免旧内容残留
        let eraseSeq = '\x1b7';
        for (let i = 0; i < expandedRows; i++) {
          const row = relFirst + 1 + i;
          if (row > term.rows) break;
          eraseSeq += `\x1b[${row};1H\x1b[2K`;
        }
        eraseSeq += '\x1b8';
        term.write(eraseSeq);

        // 写回折叠态
        term.write(
          `\x1b7\x1b[${relFirst + 1};1H\x1b[90m[已思考 #${blockId}]\x1b[0m${block.foldSuffixAnsi}\x1b8`,
        );
      }

      // 删除插入的空行
      if (insertedRows > 0) {
        const buf2 = term.buffer.normal;
        const relAfter = firstLine - buf2.viewportY;
        if (relAfter >= 0 && relAfter < term.rows) {
          const delRow = relAfter + 1;
          let seq = '\x1b7';
          seq += `\x1b[${delRow};1H`;
          for (let i = 0; i < insertedRows; i++) seq += '\x1b[M';
          seq += '\x1b8';
          term.write(seq);
        }
      }
    } else {
      // 无展开记录：尝试通过 buffer 搜索恢复
      const fold = this.locateFoldLines(term, blockId, preferAbsLine);
      if (!fold) {
        // 无法定位，仅更新状态
        this.stateMachine.transition(blockId, 'collapsed');
        this.stateMachine.persistToSession();
        return false;
      }

      term.scrollToLine(fold.first);
      const rf = fold.first - term.buffer.normal.viewportY;
      if (rf >= 0 && rf < term.rows) {
        term.write(
          `\x1b7\x1b[${rf + 1};1H\x1b[2K  \x1b[90m[已思考 #${blockId}]\x1b[0m${block.foldSuffixAnsi}\x1b8`,
        );
      }
    }

    // 状态迁移
    this.stateMachine.transition(blockId, 'collapsed');
    this.stateMachine.persistToSession();
    return true;
  }

  /**
   * 收起所有已展开的思考块
   */
  collapseAll(term: Terminal): void {
    const expandedIds = this.stateMachine.getExpandedIds();
    for (const id of [...expandedIds]) {
      this.collapseBlock(term, id);
    }
  }

  // ─── 统一锚点定位（§9.2） ──────────────────────────────────

  /**
   * 定位折叠行的 buffer 行号
   *
   * 优先级：
   * 1. block marker（最优先）
   * 2. block id（通过 expandedRange 查找）
   * 3. 最近已知 buffer range
   * 4. 文本前缀匹配
   */
  locateFoldLines(
    term: Terminal,
    blockId: number,
    preferAbsLine?: number,
  ): { first: number; last: number } | null {
    // 优先级1：使用状态机中的 anchor 定位
    const anchorLine = this.stateMachine.locateBlockBufferLine(blockId);
    if (anchorLine !== null && anchorLine >= 0) {
      return { first: anchorLine, last: anchorLine };
    }

    // 优先级2：展开范围
    const exp = this.stateMachine.getExpandedRange(blockId);
    if (exp) {
      return { first: exp.first, last: exp.last };
    }

    // 优先级3：文本前缀匹配
    return this.findFoldLinesByTextScan(term, blockId, preferAbsLine);
  }

  /**
   * 通过文本扫描定位折叠行（兜底策略）
   */
  findFoldLinesByTextScan(
    term: Terminal,
    blockId: number,
    preferAbsLine?: number,
  ): { first: number; last: number } | null {
    const needles = [
      `[Thinking #${blockId}]`,
      `[Thinking#${blockId}]`,
      `[思考中 #${blockId}]`,
      `[思考中#${blockId}]`,
      `[已思考 #${blockId}]`,
      `[已思考#${blockId}]`,
    ];

    const buf = term.buffer.normal;
    const stripAnsi = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '');
    const candidates: Array<{ first: number; last: number }> = [];

    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      if (!line || line.isWrapped) continue;

      let merged = line.translateToString(true);
      let yy = y;
      while (yy + 1 < buf.length && buf.getLine(yy + 1)?.isWrapped) {
        yy++;
        merged += buf.getLine(yy)!.translateToString(true);
      }

      const s = stripAnsi(merged);
      if (needles.some(n => s.includes(n))) {
        candidates.push({ first: y, last: yy });
      }

      // 兼容无编号的 [Thinking] 标签
      const block = this.stateMachine.getBlock(blockId);
      if (block && /\[Thinking\](?!\s*#)/i.test(s) && !s.includes(`[Thinking #${blockId}]`)) {
        const body = s.replace(/^[\s\S]*?\[Thinking\]\s*/i, '').trimStart();
        const p = block.text.trim().slice(0, 48);
        if (p.length >= 6 && body.startsWith(p.slice(0, Math.min(24, p.length)))) {
          candidates.push({ first: y, last: yy });
        }
      }
    }

    if (candidates.length === 0) return null;
    if (preferAbsLine === undefined) return candidates[candidates.length - 1]!;

    let best = candidates[0]!;
    let bestDist = Math.abs(best.first - preferAbsLine);
    for (const c of candidates.slice(1)) {
      const d = Math.abs(c.first - preferAbsLine);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  // ─── 块级重绘子操作 ────────────────────────────────────────

  renderCollapsed(term: Terminal, blockId: number): boolean {
    const block = this.stateMachine.getBlock(blockId);
    if (!block) return false;

    const line = this.stateMachine.locateBlockBufferLine(blockId);
    if (line === null) return false;

    const buf = term.buffer.normal;
    const rel = line - buf.viewportY;
    if (rel < 0 || rel >= term.rows) return false;

    term.write(
      `\x1b7\x1b[${rel + 1};1H\x1b[2K  \x1b[90m[已思考 #${blockId}]\x1b[0m${block.foldSuffixAnsi}\x1b8`,
    );
    return true;
  }

  private renderExpanded(term: Terminal, blockId: number): boolean {
    return this.expandBlock(term, blockId);
  }

  private insertPlaceholderRows(term: Terminal, blockId: number, rows: number): boolean {
    const capped = Math.min(rows, this.MAX_INSERT_ROWS);
    if (capped <= 0) return false;

    const line = this.stateMachine.locateBlockBufferLine(blockId);
    if (line === null) return false;

    const buf = term.buffer.normal;
    const rel = line - buf.viewportY;
    if (rel < 0 || rel >= term.rows) return false;

    let seq = '\x1b7';
    seq += `\x1b[${rel + 1};1H`;
    for (let i = 0; i < capped; i++) seq += '\x1b[L]';
    seq += '\x1b8';
    term.write(seq);
    return true;
  }

  private removePlaceholderRows(term: Terminal, blockId: number, rows: number): boolean {
    const capped = Math.min(rows, this.MAX_INSERT_ROWS);
    if (capped <= 0) return false;

    const line = this.stateMachine.locateBlockBufferLine(blockId);
    if (line === null) return false;

    const buf = term.buffer.normal;
    const rel = line - buf.viewportY;
    if (rel < 0 || rel >= term.rows) return false;

    const delRow = rel + 1;
    let seq = '\x1b7';
    seq += `\x1b[${delRow};1H`;
    for (let i = 0; i < capped; i++) seq += '\x1b[M]';
    seq += '\x1b8';
    term.write(seq);
    return true;
  }

  private scrollToBlock(term: Terminal, blockId: number): boolean {
    const line = this.stateMachine.locateBlockBufferLine(blockId);
    if (line === null) return false;
    term.scrollToLine(Math.max(0, line - this.SCROLL_SAFETY_MARGIN));
    return true;
  }

  // ─── Marker 注册 ───────────────────────────────────────────

  /**
   * 在折叠块首行创建/复用 marker
   *
   * 锚定到 buffer 绝对行，避免依赖光标跳转写入导致的异步错位。
   */
  rebuildMarkerOnFoldLine(term: Terminal, blockId: number, preferAbsLine?: number): IMarker | undefined {
    const fold = this.locateFoldLines(term, blockId, preferAbsLine);
    if (!fold) return undefined;

    const existing = this.stateMachine.getMarker(blockId);
    if (existing && !existing.isDisposed && existing.line >= 0 && Math.abs(existing.line - fold.first) <= 2) {
      return existing;
    }

    const buf = term.buffer.normal;
    const cursorAbs = buf.baseY + buf.cursorY;
    const offset = fold.first - cursorAbs;
    const mk = term.registerMarker(offset);
    if (mk) {
      this.stateMachine.upsertMarker(blockId, mk);
    }
    return mk ?? undefined;
  }

  // ─── 工具方法 ──────────────────────────────────────────────

  /** 计算文本在指定列宽下的折行行数 */
  countWrappedLines(term: Terminal, text: string, startCol: number, cols: number): number {
    if (!text) return 1;
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n');
    let totalRows = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const displayWidth = this.stringDisplayWidth(line);
      const effectiveCols = i === 0 ? Math.max(1, cols - startCol) : cols;
      const wrappedRows = Math.max(1, Math.ceil(displayWidth / effectiveCols));
      totalRows += wrappedRows;
    }
    return Math.max(1, totalRows);
  }

  /** 计算字符串显示宽度（CJK 字符占 2 列） */
  stringDisplayWidth(text: string): number {
    let w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x4e00 && cp <= 0x9fff) w += 2; // CJK
      else if (cp >= 0x3000 && cp <= 0x303f) w += 2; // CJK 标点
      else if (cp >= 0xff01 && cp <= 0xff60) w += 2; // 全角
      else w += 1;
    }
    return w;
  }

  /** 清理思考文本中的敏感/格式信息（用于展示） */
  sanitizeThinkingForDisplay(text: string): string {
    return text
      .replace(/<[^>]+>/g, '')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trim();
  }
}
