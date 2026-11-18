'use client';

import { useEffect, useRef } from 'react';

export default function LogPanel({ logs }: { logs: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-black/40 rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-medium text-gray-400 mb-2">📋 Generation Logs</h3>
      <div ref={scrollRef} className="h-48 overflow-y-auto space-y-1 font-mono text-xs">
        {logs.map((log, idx) => (
          <div key={idx} className="text-gray-300 border-l-2 border-blue-500 pl-2">
            {log}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-gray-600 italic">Waiting for logs...</div>
        )}
      </div>
    </div>
  );
}