import WebSocket from 'ws';
import { runVideoPipeline } from '../services/pipelineService.js';

interface WebSocketClient {
  id: string;
  ws: WebSocket;
}

export class WebSocketManager {
  private clients: Map<string, WebSocketClient> = new Map();

  addClient(ws: WebSocket): string {
    const id = Math.random().toString(36).substring(7);
    this.clients.set(id, { id, ws });
    return id;
  }

  removeClient(id: string) {
    this.clients.delete(id);
  }

  handleMessage(clientId: string, message: any) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Expect script, mode, and videoType (discussion / documentary)
    if (typeof message.script !== 'string' || !message.script.trim() || message.script.length > 100000 || !['short', 'long'].includes(message.mode) || !['discussion', 'documentary'].includes(message.videoType)) {
      this.sendError(client.ws, 'Invalid request: provide a script up to 100,000 characters, a valid mode, and video type.');
      return;
    }
      const voiceId = message.voiceId || 'en_US-ryan-high';
      const speed = typeof message.speed === 'number' && message.speed >= 0.5 && message.speed <= 2 ? message.speed : 1.0;
      const videoType = message.videoType; // 'discussion' or 'documentary'
      runVideoPipeline(
        client.ws,
        message.script,
        message.mode,
        videoType,
        voiceId,
        speed,
        (progress, stage, eta) => this.sendProgress(client.ws, progress, stage, eta),
        (videoPath, duration, totalScenes) => this.sendDone(client.ws, videoPath, duration, totalScenes),
        (errorMsg) => this.sendError(client.ws, errorMsg),
        (logMsg) => this.sendLog(client.ws, logMsg)
      );
  }

  sendProgress(ws: WebSocket, progress: number, stage: string, eta: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'progress', progress, stage, eta }));
    }
  }

  sendDone(ws: WebSocket, videoPath: string, duration: string, totalScenes: number) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'done', video: videoPath, duration, totalScenes }));
    }
  }

  sendError(ws: WebSocket, message: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message }));
    }
  }

  sendLog(ws: WebSocket, message: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'log', message }));
    }
  }
}
