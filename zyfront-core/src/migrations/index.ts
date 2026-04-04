/**
 * 通用状态迁移：from/to 版本号与单步转换函数。
 */
/** 单步迁移定义 */
export interface Migration<TState> {
  from: number;
  to: number;
  run(state: TState): TState;
}

/** 按版本链依次执行迁移直至 targetVersion */
export class MigrationRunner<TState extends { version: number }> {
  constructor(private readonly migrations: Migration<TState>[]) {}

  run(state: TState, targetVersion: number): TState {
    let next = state;

    while (next.version < targetVersion) {
      const step = this.migrations.find((m) => m.from === next.version);
      if (!step) {
        throw new Error(`No migration found from v${next.version}`);
      }

      next = step.run(next);

      if (next.version !== step.to) {
        throw new Error(`Migration output version mismatch: expected ${step.to}, got ${next.version}`);
      }
    }

    return next;
  }
}
