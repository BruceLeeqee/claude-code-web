export type DebugDomain = 'prompt' | 'memory' | 'workbench' | 'loop' | 'task';
export type DebugAction = 'latest' | 'rebuild' | 'pipeline' | 'dream' | 'sync' | 'run' | 'thinking' | 'replay' | 'restore' | 'context' | 'status' | 'stop' | 'resume' | 'step';

export interface DebugTabPayload {
  tabKey: string;
  tabTitle: string;
  domain: DebugDomain;
  action?: DebugAction;
  sessionId: string;
  generatedAt: number;
  viewModel: DebugTabViewModel;
}

export interface DebugBuildOptions {
  sessionId?: string;
  action?: DebugAction;
  args?: string[];
}

export interface DebugRow { label: string; value: string; }
export interface DebugSectionRows { kind: 'rows'; title: string; items: DebugRow[]; }
export interface DebugSectionText { kind: 'text'; title: string; items: string; }
export interface DebugTabViewModel {
  header: DebugRow[];
  sections: Array<DebugSectionRows | DebugSectionText>;
  footer: DebugRow[];
  source: string;
}
