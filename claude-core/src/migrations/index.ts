export interface Migration<TState> {
  from: number;
  to: number;
  run(state: TState): TState;
}

export class MigrationRunner<TState> {
  constructor(private readonly migrations: Migration<TState>[]) {}

  run(state: TState, currentVersion: number, targetVersion: number): TState {
    let next = state;
    const plan = this.migrations
      .filter((m) => m.from >= currentVersion && m.to <= targetVersion)
      .sort((a, b) => a.from - b.from);

    for (const migration of plan) {
      next = migration.run(next);
    }

    return next;
  }
}
