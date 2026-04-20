import { Injectable, inject, signal } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { SessionRegistryService } from '../services/session-registry.service';
import { AgentFactoryService } from '../services/agent-factory.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { AgentRole, TeamContext } from '../domain/types';

export interface TeamCreateInput {
  team_name: string;
  description?: string;
  agent_type?: AgentRole;
  roles?: Array<{
    type: AgentRole;
    task: string;
    model?: string;
  }>;
}

export interface TeamCreateOutput {
  team_name: string;
  team_file_path: string;
  lead_agent_id: string;
  agent_ids: string[];
}

export interface TeamFile {
  teamId: string;
  teamName: string;
  description: string;
  leadAgentId: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
  status: 'forming' | 'active' | 'paused' | 'completed';
  filePath: string;
}

export interface TeamCreateToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required: string[];
  };
}

export const TEAM_CREATE_TOOL_SCHEMA: TeamCreateToolSchema = {
  name: 'TeamCreate',
  description: 'Create a new team of agents to handle complex tasks. Use when task requires multiple specialized agents working together.',
  input_schema: {
    type: 'object',
    properties: {
      team_name: {
        type: 'string',
        description: 'Name for the team (will be made unique if duplicate)',
      },
      description: {
        type: 'string',
        description: 'Description of the team purpose and goals',
      },
      agent_type: {
        type: 'string',
        description: 'Default agent type for team members',
      },
    },
    required: ['team_name'],
  },
};

@Injectable({ providedIn: 'root' })
export class TeamCreateToolService {
  private readonly sessionRegistry = inject(SessionRegistryService);
  private readonly factory = inject(AgentFactoryService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly currentTeam = signal<TeamFile | null>(null);
  private readonly teamHistory = signal<TeamFile[]>([]);

  readonly team = this.currentTeam;
  readonly history = this.teamHistory;

  getSchema(): TeamCreateToolSchema {
    return TEAM_CREATE_TOOL_SCHEMA;
  }

  async createTeam(input: TeamCreateInput): Promise<TeamCreateOutput> {
    const existingTeam = this.currentTeam();
    if (existingTeam && existingTeam.status === 'active') {
      throw new Error('已存在活动团队，请先解散当前团队');
    }

    const teamName = this.generateUniqueName(input.team_name);
    const teamId = `team-${uuidv4()}`;
    const leadAgentId = `lead-${uuidv4()}`;

    const roles = input.roles || this.inferRoles(input.description || '');
    const agentIds: string[] = [];

    for (const role of roles) {
      const result = await this.factory.create({
        sessionContext: {
          sessionId: teamId,
          sessionName: teamName,
          status: 'active',
          teamId: teamId,
          teamName: teamName,
          planVersion: 0,
          agentIds: [],
          memoryScope: 'shared-with-team',
          modelPolicyId: 'default',
          backendPolicy: 'auto',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        modelId: role.model || 'MiniMax-M2.7',
        createdBy: 'planner',
        intent: {
          intentId: `intent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          reason: 'task-complexity',
          taskId: '',
          suggestedRole: role.type,
          expectedInputs: [],
          expectedOutputs: [],
          priority: 'medium',
          lifetimePolicy: 'task-bound',
          createdAt: Date.now(),
        },
      });
      agentIds.push(result.descriptor.agentId);
    }

    const teamFile: TeamFile = {
      teamId,
      teamName,
      description: input.description || '',
      leadAgentId,
      agentIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'forming',
      filePath: `.zyfront/teams/${teamName}.json`,
    };

    this.currentTeam.set(teamFile);
    this.teamHistory.update(history => [...history, teamFile]);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_UPDATED,
      sessionId: 'team-create',
      source: 'user',
      payload: {
        team: {
          teamId,
          teamName,
          status: 'forming',
          leaderAgentId: leadAgentId,
          agentIds,
          sessionIds: [],
          createdAt: teamFile.createdAt,
          updatedAt: teamFile.updatedAt,
        } as TeamContext,
        addedAgents: agentIds,
        removedAgents: [],
        version: 1,
      },
    });

    return {
      team_name: teamName,
      team_file_path: teamFile.filePath,
      lead_agent_id: leadAgentId,
      agent_ids: agentIds,
    };
  }

  async disbandTeam(): Promise<void> {
    const team = this.currentTeam();
    if (!team) {
      return;
    }

    team.status = 'completed';
    team.updatedAt = Date.now();

    this.currentTeam.set(null);

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_UPDATED,
      sessionId: 'team-create',
      source: 'user',
      payload: {
        team: {
          teamId: team.teamId,
          teamName: team.teamName,
          status: 'completed',
          leaderAgentId: team.leadAgentId,
          agentIds: [],
          sessionIds: [],
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
        } as TeamContext,
        addedAgents: [],
        removedAgents: team.agentIds,
        version: 2,
      },
    });
  }

  private generateUniqueName(baseName: string): string {
    const sanitized = baseName.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 50);
    const timestamp = Date.now().toString(36);
    return `${sanitized}-${timestamp}`;
  }

  private inferRoles(description: string): Array<{ type: AgentRole; task: string; model?: string }> {
    const roles: Array<{ type: AgentRole; task: string; model?: string }> = [];

    if (/分析|调研|研究|analyze|research/i.test(description)) {
      roles.push({
        type: 'researcher',
        task: '需求分析与调研',
        model: 'haiku',
      });
    }

    if (/设计|架构|方案|design|architecture/i.test(description)) {
      roles.push({
        type: 'planner',
        task: '方案设计',
        model: 'sonnet',
      });
    }

    roles.push({
      type: 'executor',
      task: '核心实现',
      model: 'sonnet',
    });

    if (/测试|验证|test|verify/i.test(description)) {
      roles.push({
        type: 'validator',
        task: '测试验证',
        model: 'haiku',
      });
    }

    if (/评审|审查|review|audit/i.test(description)) {
      roles.push({
        type: 'reviewer',
        task: '代码评审',
        model: 'sonnet',
      });
    }

    return roles;
  }

  getCurrentTeam(): TeamFile | null {
    return this.currentTeam();
  }

  isTeamActive(): boolean {
    const team = this.currentTeam();
    return team !== null && team.status === 'active';
  }

  getTeamStats(): {
    totalTeams: number;
    activeTeams: number;
    totalAgents: number;
  } {
    const history = this.teamHistory();
    const current = this.currentTeam();

    return {
      totalTeams: history.length,
      activeTeams: current ? 1 : 0,
      totalAgents: history.reduce((sum, t) => sum + t.agentIds.length, 0) + (current?.agentIds.length || 0),
    };
  }
}
