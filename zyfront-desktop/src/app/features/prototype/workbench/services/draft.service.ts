import { Injectable } from '@angular/core';
import { Attachment } from '../types/workbench.types';

@Injectable({ providedIn: 'root' })
export class DraftService {
  private readonly STORAGE_KEY = 'workbench:drafts';
  private drafts: Map<string, { text: string; attachments: Attachment[] }> = new Map();
  
  constructor() {
    this.loadFromStorage();
  }
  
  saveDraft(sessionId: string, text: string, attachments: Attachment[]) {
    this.drafts.set(sessionId, { text, attachments });
    this.persistToStorage();
  }
  
  getDraft(sessionId: string): { text: string; attachments: Attachment[] } {
    return this.drafts.get(sessionId) || { text: '', attachments: [] };
  }
  
  clearDraft(sessionId: string) {
    this.drafts.delete(sessionId);
    this.persistToStorage();
  }
  
  private loadFromStorage() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        this.drafts = new Map(Object.entries(parsed));
      }
    } catch {
      // ignore
    }
  }
  
  private persistToStorage() {
    const data = Object.fromEntries(this.drafts);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  }
}

