'use client';

import { useState, useCallback } from 'react';
import ScriptBox from '@/components/ScriptBox';
import ModeSelector from '@/components/ModeSelector';
import GenerateButton from '@/components/GenerateButton';
import ProgressPanel from '@/components/ProgressPanel';
import VideoPreview from '@/components/VideoPreview';
import TopicModePanel from '@/components/TopicModePanel';
import VideoTypeSelector from '@/components/VideoTypeSelector';
import LogPanel from '@/components/LogPanel';
import { useVideoProgress } from '@/lib/websocket';

export default function Home() {
  const [script, setScript] = useState('');
  const [mode, setMode] = useState<'short' | 'long'>('short');
  const [videoType, setVideoType] = useState<'discussion' | 'documentary'>('discussion');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'script' | 'topic'>('script');
  const { progress, stage, eta, video, isConnected, sendGenerate, logs } = useVideoProgress();

  const handleGenerate = (generatedScript?: string) => {
    const finalScript = generatedScript || script;
    if (!finalScript.trim()) return;
    setIsGenerating(true);
    sendGenerate(finalScript, mode, videoType);
  };

  const handleComplete = useCallback(() => setIsGenerating(false), []);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent mb-8">
          Automated Video Maker
        </h1>

        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setActiveTab('script')}
            className={`px-6 py-2 rounded-xl ${activeTab === 'script' ? 'bg-blue-600' : 'bg-gray-800'}`}
          >
            ✍️ Script Mode
          </button>
          <button
            onClick={() => setActiveTab('topic')}
            className={`px-6 py-2 rounded-xl ${activeTab === 'topic' ? 'bg-blue-600' : 'bg-gray-800'}`}
          >
            🎯 Topic Mode
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Panel */}
          <div className="space-y-6">
            {activeTab === 'script' ? (
              <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-gray-800">
                <ScriptBox value={script} onChange={setScript} />
              </div>
            ) : (
              <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-gray-800">
                <TopicModePanel onGenerate={handleGenerate} mode={mode} />
              </div>
            )}

            <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-gray-800">
              <VideoTypeSelector value={videoType} onChange={setVideoType} />
              <ModeSelector value={mode} onChange={setMode} />
              <div className="mt-6">
                {activeTab === 'script' ? (
                  <GenerateButton 
                    onClick={() => handleGenerate()} 
                    isLoading={isGenerating}
                    disabled={!script.trim() || !isConnected}
                  />
                ) : null}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-6">
            <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-gray-800">
              <ProgressPanel progress={progress} stage={stage} eta={eta} isGenerating={isGenerating} />
            </div>
            <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-gray-800">
              <LogPanel logs={logs} />
            </div>
            {video && (
              <div className="bg-[#1a1a1a] rounded-2xl p-6 border border-gray-800">
                <VideoPreview videoUrl={video} onComplete={handleComplete} />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
