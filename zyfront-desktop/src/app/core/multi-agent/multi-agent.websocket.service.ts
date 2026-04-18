import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';

interface WebSocketMessage {
  type: string;
  data: any;
}

@Injectable({ providedIn: 'root' })
export class MultiAgentWebSocketService implements OnDestroy {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<WebSocketMessage>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimeout = 10000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;
  private isConnecting = false;

  messages$: Observable<WebSocketMessage> = this.messageSubject.asObservable();

  connect(url: string = 'ws://localhost:8080'): void {
    if (this.isConnecting || this.isConnected) {
      return;
    }

    this.isConnecting = true;

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        console.log('WebSocket connected to', url);
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          this.messageSubject.next(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.socket.onerror = (error) => {
        console.warn('WebSocket error (will retry):', url);
      };

      this.socket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.isConnected = false;
        this.isConnecting = false;
        this.handleReconnect(url);
      };
    } catch (error) {
      console.warn('Error creating WebSocket connection:', error);
      this.isConnecting = false;
      this.handleReconnect(url);
    }
  }

  send(message: WebSocketMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, message queued:', message.type);
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  private handleReconnect(url: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`WebSocket reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectTimeout}ms`);
      this.reconnectTimer = setTimeout(() => {
        this.connect(url);
      }, this.reconnectTimeout);
    } else {
      console.warn('WebSocket max reconnect attempts reached. Please check if backend server is running.');
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.messageSubject.complete();
  }
}
