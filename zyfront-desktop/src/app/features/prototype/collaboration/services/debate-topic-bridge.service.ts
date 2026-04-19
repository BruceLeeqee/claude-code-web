import { Injectable, signal } from '@angular/core';
import { DebateTopic } from './debate.service';

@Injectable({ providedIn: 'root' })
export class DebateTopicBridgeService {
  readonly currentTopic = signal<DebateTopic | null>(null);
  readonly affirmativeAgents = signal<string[]>([]);
  readonly negativeAgents = signal<string[]>([]);
  readonly judges = signal<string[]>([]);

  setDebateTopic(topic: DebateTopic): void {
    this.currentTopic.set(topic);
  }

  setTeamAssignments(affirmative: string[], negative: string[], judgesList: string[]): void {
    this.affirmativeAgents.set(affirmative);
    this.negativeAgents.set(negative);
    this.judges.set(judgesList);
  }

  clear(): void {
    this.currentTopic.set(null);
    this.affirmativeAgents.set([]);
    this.negativeAgents.set([]);
    this.judges.set([]);
  }
}
