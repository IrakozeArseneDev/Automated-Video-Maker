import { Server as HTTPServer } from 'http';
import { WebSocketServer as WSServer, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { WebSocketManager } from './manager.js';

export class WebSocketServer {
  private wss: WSServer;
  private manager: WebSocketManager;

  constructor(server: HTTPServer) {
    this.wss = new WSServer({ server });
    this.manager = new WebSocketManager();

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientId = this.manager.addClient(ws);
      console.log(`Client ${clientId} connected`);

      ws.on('message', (data: RawData) => {
        try {
          const message = JSON.parse(data.toString());
          this.manager.handleMessage(clientId, message);
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      ws.on('close', () => {
        this.manager.removeClient(clientId);
        console.log(`Client ${clientId} disconnected`);
      });
    });
  }
}