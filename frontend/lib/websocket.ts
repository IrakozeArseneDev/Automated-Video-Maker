import { useState, useRef, useEffect, useCallback } from 'react';

type ProgressData = { type: 'progress'; progress: number; stage: string; eta: string };
type DoneData = { type: 'done'; video: string; duration: string; totalScenes: number };
type ErrorData = { type: 'error'; message: string };
type LogData = { type: 'log'; message: string };
type WebSocketMessage = ProgressData | DoneData | ErrorData | LogData;

export function useVideoProgress() {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [eta, setEta] = useState('');
  const [video, setVideo] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${window.location.hostname}:3002`;
    const apiUrl = new URL(apiBase);
    const ws = new WebSocket(`${apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${apiUrl.host}/`);
    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setLogs([]);
    };
    ws.onmessage = (event) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data);
        switch (data.type) {
          case 'progress':
            setProgress(data.progress);
            setStage(data.stage);
            setEta(data.eta);
            break;
          case 'done':
            setVideo(`${apiBase}${data.video}`);
            setProgress(100);
            setStage('Completed!');
            setEta('00:00:00');
            break;
          case 'error':
            setStage(`Error: ${data.message}`);
            setProgress(0);
            console.error('Generation error:', data.message);
            setLogs(prev => [...prev, `❌ Error: ${data.message}`]);
            break;
          case 'log':
            console.log('[Backend log]', data.message);
            setLogs(prev => [...prev, data.message]);
            break;
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStage('Connection error - check if backend is running');
      setIsConnected(false);
    };
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };
    wsRef.current = ws;
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const sendGenerate = useCallback((script: string, mode: 'short' | 'long', videoType: 'discussion' | 'documentary') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setVideo('');
      setProgress(0);
      setLogs([]);
      // Fixed voiceId and speed (back‑end uses per‑speaker mapping)
      wsRef.current.send(JSON.stringify({
        script,
        mode,
        videoType,
        voiceId: 'en_US-ryan-high',   // ignored in discussion mode, used as fallback for documentary
        speed: 1.0
      }));
    } else {
      console.error('WebSocket not connected');
      setStage('WebSocket not connected. Please refresh the page.');
    }
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { progress, stage, eta, video, isConnected, sendGenerate, logs, clearLogs };
}
