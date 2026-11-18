'use client';

import { useEffect, useRef } from 'react';

interface VideoPreviewProps {
  videoUrl: string;
  onComplete: () => void;
}

export default function VideoPreview({ videoUrl, onComplete }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [videoUrl]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = 'generated-video.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-300">Your Video is Ready! 🎉</h3>
      <video
        ref={videoRef}
        controls
        className="w-full rounded-xl shadow-lg"
        src={videoUrl}
      />
      <button
        onClick={handleDownload}
        className="w-full py-2 bg-green-600 hover:bg-green-500 rounded-xl font-medium transition-colors"
      >
        💾 Download Video
      </button>
    </div>
  );
}
