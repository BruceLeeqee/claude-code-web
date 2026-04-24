export type LoopStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'repairing'
  | 'blocked'
  | 'paused'
  | 'ready_for_review'
  | 'ready_for_release'
  | 'completed'
  | 'failed';

export type LoopTaskType = 'development' | 'testing' | 'docs' | 'ops' | 'analysis' | 'general';
export type LoopPhase = 'requirements' | 'design' | 'development' | 'verification' | 'repair' | 'summary';

export interface LoopTeamMember {
  id: string;
  name: string;
  role: 'architect' | 'developer' | 'tester' | 'verifier' | 'fixer' | 'coordinator';
}

export interface LoopStepDoc {
  id: string;
  stepId: string;
  type: 'requirements' | 'design' | 'execution' | 'verification' | 'repair' | 'summary' | 'status';
  path: string;
  title: string;
  createdAt: string;
  /** 真实内容落盘：模板填充后的完整 markdown 正文 */
  content?: string;
}

export interface LoopArtifact {
  kind: 'document' | 'screenshot' | 'log' | 'patch' | 'report';
  label: string;
  path: string;
  createdAt: string;
}

export interface LoopVerificationEntry {
  dimension: 'compile' | 'ui' | 'api' | 'data' | 'terminal';
  passed: boolean;
  evidence: string[];
  note?: string;
  updatedAt: string;
}

export interface LoopPlanStep {
  id: string;
  title: string;
  type: 'analysis' | 'design' | 'implementation' | 'test' | 'verification' | 'repair' | 'summary' | 'release_check';
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  dependencies: string[];
  acceptance: string[];
  riskLevel: 'low' | 'medium' | 'high';
  outputs: string[];
}

export interface LoopValidationResult {
  passed: boolean;
  stage: 'lint' | 'typecheck' | 'unit' | 'integration' | 'build' | 'smoke' | 'review';
  errors: string[];
  warnings: string[];
  blockers: string[];
  recommendation: 'continue' | 'repair' | 'pause' | 'stop' | 'release';
}

export interface LoopState {
  loopId: string;
  taskId: string;
  objective: string;
  taskType: LoopTaskType;
  phase: LoopPhase;
  teamName: string;
  teamMembers: LoopTeamMember[];
  status: LoopStatus;
  iteration: number;
  maxIterations: number;
  currentPlan: LoopPlanStep[];
  completedSteps: LoopPlanStep[];
  blockedReasons: string[];
  validationHistory: LoopValidationResult[];
  toolHistory: string[];
  fileChanges: string[];
  memoryRefs: string[];
  sandboxId?: string;
  browserSessionId?: string;
  buildStatus: 'unknown' | 'passed' | 'failed';
  uiStatus: 'unknown' | 'passed' | 'failed';
  apiStatus: 'unknown' | 'passed' | 'failed';
  dataStatus: 'unknown' | 'passed' | 'failed';
  retryCount: number;
  lastError?: string;
  lastEvidence: string[];
  stepDocs: LoopStepDoc[];
  verificationMatrix: LoopVerificationEntry[];
  artifacts: LoopArtifact[];
  requirementsDocPath?: string;
  designDocPath?: string;
  /** 修补引擎连续失败计数持久化（key→count） */
  patchFailureMap: Record<string, number>;
  lastSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoopRequest {
  objective: string;
  teamName?: string;
  taskType?: LoopTaskType;
  scope?: string;
  constraints?: string[];
  successCriteria?: string[];
  maxIterations?: number;
  scheduleEveryMs?: number;
  allowGitCommit?: boolean;
  allowGitPush?: boolean;
  requireUserApprovalForRelease?: boolean;
}
