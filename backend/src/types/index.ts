export interface Scene {
  id: number;
  text: string;
  startTime: number;
  endTime: number;
  keywords: string[];
  imagePath?: string;
  audioPath?: string;
  subtitlePath?: string;
  duration?: number;
}

export interface PipelineProgress {
  progress: number;
  stage: string;
  eta: string;
}

export interface VideoConfig {
  mode: 'short' | 'long';
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export interface VoiceConfig {
  voice: 'male' | 'female';
  speed: number; // 0.5 to 2.0
}

export type VideoType = 'discussion' | 'documentary';
