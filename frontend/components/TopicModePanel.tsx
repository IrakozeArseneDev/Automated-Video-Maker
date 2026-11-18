'use client';

import { useState, useEffect } from 'react';

interface TopicModePanelProps {
  onGenerate: (script: string) => void;
  mode: 'short' | 'long';
}

export default function TopicModePanel({ onGenerate, mode }: TopicModePanelProps) {
  const [topic, setTopic] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [generatedScript, setGeneratedScript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [timer, setTimer] = useState(10);
  const [autoAccept, setAutoAccept] = useState(false);

  // Auto-accept timer logic
  useEffect(() => {
    if (!showConfirmation) return;
    if (timer <= 0) {
      setAutoAccept(true);
      onGenerate(generatedScript);
      setShowConfirmation(false);
      return;
    }
    const interval = setInterval(() => {
      setTimer(prev => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [showConfirmation, timer, generatedScript, onGenerate]);

  const generateScript = async () => {
    if (!topic.trim()) return;
    setIsLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${window.location.hostname}:3002`;
      const res = await fetch(`${apiBase}/api/generate-topic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, durationMinutes, mode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Script generation failed');
      if (data.script) {
        setGeneratedScript(data.script);
        setShowConfirmation(true);
        setTimer(10);
        setAutoAccept(false);
      } else {
        alert('Failed to generate script');
      }
    } catch (err) {
      console.error(err);
      alert('Error generating script');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = () => {
    setShowConfirmation(false);
    onGenerate(generatedScript);
  };

  const handleRegenerate = () => {
    setShowConfirmation(false);
    generateScript(); // regenerate new script
  };

  if (showConfirmation) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Generated Script</h3>
          <span className="text-sm text-gray-400">Auto-accept in {timer}s</span>
        </div>
        <div className="bg-black/40 p-4 rounded-xl max-h-[300px] overflow-y-auto whitespace-pre-wrap text-sm">
          {generatedScript}
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleAccept}
            className="flex-1 py-2 bg-green-600 rounded-xl hover:bg-green-500"
          >
            ✅ Accept & Generate Video
          </button>
          <button
            onClick={handleRegenerate}
            className="flex-1 py-2 bg-yellow-600 rounded-xl hover:bg-yellow-500"
          >
            🔄 Regenerate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Video Topic
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g., How to stay motivated, Benefits of meditation, Arsenal FC season review"
          className="w-full p-3 rounded-xl bg-black border border-gray-700 text-white focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Duration: {durationMinutes} minute{durationMinutes !== 1 ? 's' : ''}
        </label>
        <input
          type="range"
          min={0.5}
          max={60}
          step={0.5}
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>
      <button
        onClick={generateScript}
        disabled={isLoading || !topic.trim()}
        className="w-full py-3 bg-blue-600 rounded-xl font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        {isLoading ? 'Generating script...' : '🎬 Generate Script'}
      </button>
    </div>
  );
}
