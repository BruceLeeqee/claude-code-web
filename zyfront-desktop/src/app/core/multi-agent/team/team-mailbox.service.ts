import { Injectable, signal, computed } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { TeamMessage, TeamMessagePriority } from './team.types';
import { MultiAgentEventBusService } from '../multi-agent.event-bus.service';
import { EVENT_TYPES } from '../multi-agent.events';

interface AgentMailbox {
  inbox: TeamMessage[];
  outbox: TeamMessage[];
}

@Injectable({ providedIn: 'root' })
export class TeamMailboxService {
  private readonly mailboxesByTeam = signal<Map<string, Map<string, AgentMailbox>>>(new Map());

  readonly allMessages = computed(() => {
    const result: TeamMessage[] = [];
    this.mailboxesByTeam().forEach(teamMailboxes => {
      teamMailboxes.forEach(mb => {
        result.push(...mb.inbox, ...mb.outbox);
      });
    });
    return result;
  });

  constructor(private readonly eventBus: MultiAgentEventBusService) {}

  private getTeamMailboxes(teamId: string): Map<string, AgentMailbox> {
    return this.mailboxesByTeam().get(teamId) || new Map();
  }

  private getMailbox(teamId: string, agentId: string): AgentMailbox {
    const teamMailboxes = this.getTeamMailboxes(teamId);
    return teamMailboxes.get(agentId) || { inbox: [], outbox: [] };
  }

  private updateMailbox(teamId: string, agentId: string, updater: (mb: AgentMailbox) => AgentMailbox): void {
    this.mailboxesByTeam.update(outer => {
      const newOuter = new Map(outer);
      const teamMailboxes = new Map(newOuter.get(teamId) || new Map());
      const current = teamMailboxes.get(agentId) || { inbox: [], outbox: [] };
      teamMailboxes.set(agentId, updater(current));
      newOuter.set(teamId, teamMailboxes);
      return newOuter;
    });
  }

  sendMessage(teamId: string, from: string, to: string, content: string, priority: TeamMessagePriority = 'normal', metadata?: Record<string, unknown>): TeamMessage {
    const message: TeamMessage = {
      id: uuidv4(),
      from,
      to,
      content,
      type: 'info',
      priority,
      timestamp: Date.now(),
      read: false,
      metadata,
    };

    this.updateMailbox(teamId, from, mb => ({
      ...mb,
      outbox: [...mb.outbox, message],
    }));

    this.updateMailbox(teamId, to, mb => ({
      ...mb,
      inbox: [...mb.inbox, message],
    }));

    this.eventBus.emit({
      type: EVENT_TYPES.TEAM_MAILBOX_MESSAGE_SENT,
      sessionId: teamId,
      source: 'system' as const,
      payload: { teamId, message },
    });

    return message;
  }

  broadcast(teamId: string, from: string, content: string, priority: TeamMessagePriority = 'normal'): TeamMessage[] {
    const teamMailboxes = this.getTeamMailboxes(teamId);
    const messages: TeamMessage[] = [];

    teamMailboxes.forEach((_, agentId) => {
      if (agentId !== from) {
        messages.push(this.sendMessage(teamId, from, agentId, content, priority));
      }
    });

    return messages;
  }

  getInbox(teamId: string, agentId: string): TeamMessage[] {
    return [...this.getMailbox(teamId, agentId).inbox];
  }

  getOutbox(teamId: string, agentId: string): TeamMessage[] {
    return [...this.getMailbox(teamId, agentId).outbox];
  }

  getUnread(teamId: string, agentId: string): TeamMessage[] {
    return this.getInbox(teamId, agentId).filter(m => !m.read);
  }

  getUnreadCount(teamId: string, agentId: string): number {
    return this.getUnread(teamId, agentId).length;
  }

  markRead(teamId: string, agentId: string, messageId: string): void {
    this.updateMailbox(teamId, agentId, mb => ({
      ...mb,
      inbox: mb.inbox.map(m => m.id === messageId ? { ...m, read: true } : m),
    }));
  }

  markAllRead(teamId: string, agentId: string): void {
    this.updateMailbox(teamId, agentId, mb => ({
      ...mb,
      inbox: mb.inbox.map(m => ({ ...m, read: true })),
    }));
  }

  getMessagesBetween(teamId: string, agent1: string, agent2: string): TeamMessage[] {
    const inbox = this.getInbox(teamId, agent1);
    const outbox = this.getOutbox(teamId, agent1);
    return [...inbox, ...outbox]
      .filter(m => (m.from === agent1 && m.to === agent2) || (m.from === agent2 && m.to === agent1))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getMessagesByTeam(teamId: string): TeamMessage[] {
    const teamMailboxes = this.getTeamMailboxes(teamId);
    const result: TeamMessage[] = [];
    teamMailboxes.forEach(mb => {
      result.push(...mb.inbox, ...mb.outbox);
    });
    return result;
  }

  clearInbox(teamId: string, agentId: string): void {
    this.updateMailbox(teamId, agentId, mb => ({
      ...mb,
      inbox: [],
    }));
  }

  clearOutbox(teamId: string, agentId: string): void {
    this.updateMailbox(teamId, agentId, mb => ({
      ...mb,
      outbox: [],
    }));
  }

  clearTeamMailboxes(teamId: string): void {
    this.mailboxesByTeam.update(outer => {
      const newOuter = new Map(outer);
      newOuter.delete(teamId);
      return newOuter;
    });
  }

  clearAll(): void {
    this.mailboxesByTeam.set(new Map());
  }

  registerAgent(teamId: string, agentId: string): void {
    const teamMailboxes = this.getTeamMailboxes(teamId);
    if (!teamMailboxes.has(agentId)) {
      this.updateMailbox(teamId, agentId, mb => mb);
    }
  }

  unregisterAgent(teamId: string, agentId: string): void {
    this.mailboxesByTeam.update(outer => {
      const newOuter = new Map(outer);
      const teamMailboxes = new Map(newOuter.get(teamId) || new Map());
      teamMailboxes.delete(agentId);
      if (teamMailboxes.size === 0) {
        newOuter.delete(teamId);
      } else {
        newOuter.set(teamId, teamMailboxes);
      }
      return newOuter;
    });
  }
}
