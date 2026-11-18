'use client';

import { motion } from 'framer-motion';

interface ProgressPanelProps {
  progress: number;
  stage: string;
  eta: string;
  isGenerating: boolean;
}

export default function ProgressPanel({ progress, stage, eta, isGenerating }: ProgressPanelProps) {
  if (!isGenerating && progress === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">🎬</div>
        <h3 className="text-xl font-medium text-gray-300">Ready to Generate</h3>
        <p className="text-gray-500 mt-2">Enter a script and click Generate</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex justify-between text-sm text-gray-400 mb-2">
          <span>Progress</span>
          <span>{Math.floor(progress)}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
          <motion.div
            className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-3 text-gray-300">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          <span className="font-medium">{stage || 'Initializing...'}</span>
        </div>
        
        {eta && eta !== '00:00:00' && (
          <div className="text-sm text-gray-500">
            ⏱️ Estimated time remaining: {eta}
          </div>
        )}
      </div>

      {progress < 100 && (
        <div className="pt-4 border-t border-gray-800">
          <div className="text-xs text-gray-600">
            Processing scenes... This may take a few minutes
          </div>
        </div>
      )}
    </div>
  );
}