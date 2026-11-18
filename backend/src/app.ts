import express from 'express';
import * as http from 'http';
import { WebSocketServer } from './websocket/server.js';
import generateRouter from './routes/generate.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use('/output', express.static(path.join(__dirname, '../output')));
app.use('/api', generateRouter);

new WebSocketServer(server);

const PORT = Number(process.env.PORT || 3002);
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server on ws://localhost:${PORT}`);
});
