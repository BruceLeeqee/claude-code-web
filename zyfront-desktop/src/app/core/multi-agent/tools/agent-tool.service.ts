import { Injectable, inject, signal } from '@angular/core';
import { AgentFactoryService } from '../services/agent-factory.service';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';
import type { AgentRole } from '../domain/types';

export interface AgentToolInput {
  description: string;
  prompt: string;
  subagent_type?: AgentRole;
  model?: 'sonnet' | 'opus' | 'haiku';
  run_in_background?: boolean;
}

export interface AgentToolOutput {
  status: 'completed' | 'async_launched' | 'teammate_spawned';
  result?: string;
  agentId?: string;
  error?: string;
}

export interface ToolContext {
  sessionId: string;
  parentAgentId?: string;
  teamId?: string;
}

export interface AgentToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

export const AGENT_TOOL_SCHEMA: AgentToolSchema = {
  name: 'Agent',
  description: 'Launch a new agent to handle a subtask. Use when task is complex enough to benefit from parallel execution or requires specialized expertise.',
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: '3-5 word task description for the agent',
      },
      prompt: {
        type: 'string',
        description: 'Full task prompt for the agent to execute',
      },
      subagent_type: {
        type: 'string',
        description: 'Agent type based on task nature',
        enum: ['executor', 'planner', 'researcher', 'reviewer', 'validator', 'coordinator'],
      },
      model: {
        type: 'string',
        description: 'Model to use for this agent',
        enum: ['sonnet', 'opus', 'haiku'],
      },
      run_in_background: {
        type: 'boolean',
        description: 'Whether to run the agent in background (async)',
      },
    },
    required: ['description', 'prompt'],
  },
};

@Injectable({ providedIn: 'root' })
export class AgentToolService {
  private readonly factory = inject(AgentFactoryService);
  private readonly eventBus = inject(MultiAgentEventBusService);

  private readonly activeAgents = signal<Map<string, { input: AgentToolInput; status: string }>>(new Map());
  private readonly toolCallLogs = signal<Array<{ timestamp: number; input: AgentToolInput; output: AgentToolOutput }>>([]);

  readonly agents = this.activeAgents;
  readonly logs = this.toolCallLogs;

  getSchema(): AgentToolSchema {
    return AGENT_TOOL_SCHEMA;
  }

  async call(input: AgentToolInput, context: ToolContext): Promise<AgentToolOutput> {
    this.validateInput(input);

    const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.activeAgents.update(agents => {
      const newMap = new Map(agents);
      newMap.set(agentId, { input, status: 'initializing' });
      return newMap;
    });

    try {
      const result = await this.factory.create({
        sessionContext: {
          sessionId: context.sessionId,
          sessionName: 'Agent Tool Session',
          status: 'active',
          teamId: context.teamId || '',
          teamName: '',
          planVersion: 0,
          agentIds: [],
          memoryScope: 'isolated',
          modelPolicyId: 'default',
          backendPolicy: 'auto',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        modelId: this.mapModelToId(input.model),
        createdBy: 'user',
        intent: {
          intentId: `intent-${Date.now()}`,
          reason: 'task-complexity',
          taskId: '',
          suggestedRole: input.subagent_type || 'executor',
          expectedInputs: [],
          expectedOutputs: [],
          priority: 'medium',
          lifetimePolicy: 'task-bound',
          createdAt: Date.now(),
        },
      });

      const agent = result.descriptor;
      const runtimeState = result.runtimeState;

      this.activeAgents.update(agents => {
        const newMap = new Map(agents);
        const entry = newMap.get(agentId);
        if (entry) {
          newMap.set(agentId, { ...entry, status: 'running' });
        }
        return newMap;
      });

      this.eventBus.emit({
        type: EVENT_TYPES.AGENT_CREATED,
        sessionId: context.sessionId,
        source: 'system',
        payload: {
          descriptor: agent,
          runtimeState: runtimeState,
        },
      });

      if (input.run_in_background) {
        this.executeAsync(agentId, input, context);
        const output: AgentToolOutput = {
          status: 'async_launched',
          agentId,
        };
        this.logToolCall(input, output);
        return output;
      }

      const syncResult = await this.executeSync(agentId, input, context);
      const output: AgentToolOutput = {
        status: 'completed',
        result: syncResult,
        agentId,
      };
      this.logToolCall(input, output);
      return output;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const output: AgentToolOutput = {
        status: 'completed',
        error: errorMessage,
        agentId,
      };
      this.logToolCall(input, output);
      return output;
    } finally {
      this.activeAgents.update(agents => {
        const newMap = new Map(agents);
        newMap.delete(agentId);
        return newMap;
      });
    }
  }

  private validateInput(input: AgentToolInput): void {
    if (!input.description || input.description.trim().length === 0) {
      throw new Error('Agent description is required');
    }
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw new Error('Agent prompt is required');
    }
    if (input.description.length > 100) {
      console.warn('Agent description is too long, truncating to 100 characters');
      input.description = input.description.substring(0, 97) + '...';
    }
  }

  private mapModelToId(model?: 'sonnet' | 'opus' | 'haiku'): string {
    const modelMap: Record<string, string> = {
      sonnet: 'claude-sonnet-3.5',
      opus: 'claude-opus-3',
      haiku: 'claude-haiku-3.5',
    };
    return modelMap[model || 'sonnet'] || 'MiniMax-M2.7';
  }

  private async executeSync(
    agentId: string,
    input: AgentToolInput,
    context: ToolContext,
  ): Promise<string> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(`Agent ${agentId} completed task: ${input.description}`);
      }, 1000);
    });
  }

  private async executeAsync(
    agentId: string,
    input: AgentToolInput,
    context: ToolContext,
  ): Promise<void> {
    setTimeout(async () => {
      try {
        await this.executeSync(agentId, input, context);
        this.eventBus.emit({
          type: EVENT_TYPES.AGENT_STARTED,
          sessionId: context.sessionId,
          source: 'system',
          payload: {
            agentId,
            previousStatus: 'initializing' as any,
            newStatus: 'ready' as any,
          },
        });
      } catch (error) {
        this.eventBus.emit({
          type: EVENT_TYPES.AGENT_FAILED,
          sessionId: context.sessionId,
          source: 'system',
          payload: {
            agentId,
            stage: 'execute',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            retriable: true,
          },
        });
      }
    }, 0);
  }

  private logToolCall(input: AgentToolInput, output: AgentToolOutput): void {
    this.toolCallLogs.update(logs => [
      { timestamp: Date.now(), input, output },
      ...logs,
    ].slice(0, 100));
  }

  getActiveAgentCount(): number {
    return this.activeAgents().size;
  }

  getToolCallStats(): {
    total: number;
    completed: number;
    async: number;
    failed: number;
  } {
    const logs = this.toolCallLogs();
    return {
      total: logs.length,
      completed: logs.filter(l => l.output.status === 'completed' && !l.output.error).length,
      async: logs.filter(l => l.output.status === 'async_launched').length,
      failed: logs.filter(l => l.output.error).length,
    };
  }
}
