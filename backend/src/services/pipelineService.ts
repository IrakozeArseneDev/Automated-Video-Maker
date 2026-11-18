import WebSocket from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import { generateVoice } from './ttsService.js';
import { splitIntoScenes, extractKeywordsForScenes, extractPhrases } from './sceneService.js';
import { downloadImagesForScenes } from './imageService.js';
import { generateSubtitlesForScenes } from './subtitleService.js';
import { renderVideo } from './renderService.js';
import {
  parseDialogueScript,
  generateDialogueAudio,
  concatAudioFiles,
  convertToDialogueScript,
  generateImagePromptsForLines,
  generateContextSummary,
  DialogueLine,  
} from './dialogueService.js';
import { Scene, VideoType } from '../types/index.js';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

function formatETA(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateETA(startTime: number, completed: number, total: number): string {
  const elapsed = (Date.now() - startTime) / 1000;
  const avg = elapsed / completed;
  const remaining = avg * (total - completed);
  return formatETA(remaining);
}

async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
  return parseFloat(stdout.trim());
}

export async function runVideoPipeline(
  ws: WebSocket,
  script: string,
  mode: 'short' | 'long',
  videoType: VideoType,
  voiceId: string,
  speed: number,
  sendProgress: (progress: number, stage: string, eta: string) => void,
  sendDone: (videoPath: string, duration: string, totalScenes: number) => void,
  sendError: (message: string) => void,
  sendLog: (message: string) => void
) {
  const startTime = Date.now();
  let scenes: Scene[] = [];
  let totalScenes = 0;
  let audioPath: string = '';
  const videoId = randomUUID();
  let dialogueDir: string | null = null;
  let dialogueLines: DialogueLine[] = []; // <-- declared here, outside the if block

  try {
    sendLog('📝 Processing script...');
    sendProgress(5, 'Processing script', formatETA(0));
    const processedScript = script.trim();
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });

    // ─── Step 1: Generate scenes and audio ──────────────────────────
    // In runVideoPipeline, under videoType === 'discussion'
if (videoType === 'discussion') {
  sendLog('🎙️ Parsing dialogue script...');
  dialogueLines = parseDialogueScript(processedScript);
  if (!dialogueLines.length) {
    sendLog('🔄 No dialogue tags found. Converting plain script to dialogue format using AI...');
    const dialogueScript = await convertToDialogueScript(processedScript, sendLog, videoId);
    dialogueLines = parseDialogueScript(dialogueScript);
    if (!dialogueLines.length) {
      sendLog('⚠️ AI conversion failed to produce dialogue. Falling back to documentary mode.');
      audioPath = await generateVoice(processedScript, voiceId, speed);
      scenes = await splitIntoScenes(processedScript);
      scenes = await extractKeywordsForScenes(scenes);
    } else {
      sendLog(`🎤 Successfully converted to ${dialogueLines.length} dialogue lines.`);
    }
  }

  if (dialogueLines.length) {
    const fullDialogueScript = dialogueLines.map(l => `${l.speaker}: ${l.text}`).join('\n');
    const contextSummary = await generateContextSummary(fullDialogueScript, sendLog);

    // ─── STEP 1: Generate image search terms IMMEDIATELY ──────────────
    sendLog('🔎 Generating image search terms...');
    const imagePromptsList = await generateImagePromptsForLines(dialogueLines, contextSummary, sendLog);
    sendLog('✅ Image search terms generated. They are exported to logs/ai_exports/ for review.');

    // ─── STEP 2: Now generate audio (while you check the terms) ──────
    sendLog(`🎤 Generating audio for ${dialogueLines.length} dialogue lines...`);
    const linesWithAudio = await generateDialogueAudio(dialogueLines, speed, videoId, sendLog);
    const firstAudioPath = linesWithAudio[0].audioPath!;
    dialogueDir = path.dirname(firstAudioPath);
    const combinedAudioPath = path.join(tempDir, `combined_${videoId}.wav`);
    await concatAudioFiles(dialogueDir, combinedAudioPath, sendLog);
    audioPath = combinedAudioPath;

    // ─── Expand to sub‑scenes using the already‑generated prompts ──
    let sceneId = 0;
    const expandedScenes: Scene[] = [];
    for (let idx = 0; idx < linesWithAudio.length; idx++) {
      const line = linesWithAudio[idx];
      const prompts = imagePromptsList[idx] || ['football match action', 'football match action'];
      const twoPrompts = prompts.slice(0, 2);
      while (twoPrompts.length < 2) twoPrompts.push('football match action');
      for (let p = 0; p < 2; p++) {
        expandedScenes.push({
          id: sceneId++,
          text: `${line.speaker}: ${line.text}`,
          startTime: 0,
          endTime: 0,
          keywords: [twoPrompts[p]],
          audioPath: line.audioPath,
          duration: (line.duration || 0) / 2,
        });
      }
    }
    scenes = expandedScenes;
    totalScenes = scenes.length;
    sendLog(`🎬 Expanded ${dialogueLines.length} dialogue lines into ${totalScenes} sub‑scenes (2 images per line).`);
  }
} else {
      // Documentary mode
      sendLog('📄 Documentary mode (single narrator)');
      sendLog(`🎤 Generating TTS audio with voice ${voiceId} at ${speed}x speed...`);
      audioPath = await generateVoice(processedScript, voiceId, speed);
      sendLog(`📝 Splitting script into scenes...`);
      scenes = await splitIntoScenes(processedScript);
      scenes = await extractKeywordsForScenes(scenes);
      totalScenes = scenes.length;
    }

    // ─── Step 2: Ensure we have at least one scene ────────────────
    if (scenes.length === 0) {
      throw new Error('No scenes generated – pipeline cannot continue.');
    }

    // ─── Step 3: Expand documentary scenes into sub‑scenes ───────
    // (If not already expanded, i.e., documentary mode or fallback)
    if (videoType !== 'discussion' || !dialogueLines?.length) {
      const expanded: Scene[] = [];
      for (const scene of scenes) {
        let prompts = scene.keywords || [];
        if (prompts.length === 0) {
          prompts = extractPhrases(scene.text, 3);
          if (prompts.length === 0) prompts = ['football match action'];
        }
        // Limit to 3 and create a sub-scene per prompt
        const threePrompts = prompts.slice(0, 3);
        while (threePrompts.length < 3) threePrompts.push('football stadium action');
        for (let p = 0; p < threePrompts.length; p++) {
          expanded.push({
            ...scene,
            id: expanded.length,
            keywords: [threePrompts[p]],
            duration: ((scene as Scene & { duration?: number }).duration || 0) / 3,
          });
        }
      }
      scenes = expanded;
      totalScenes = scenes.length;
      sendLog(`📸 Expanded documentary into ${totalScenes} sub‑scenes (3 images per original scene).`);
    }

    // ─── Step 4: Assign audio durations ──────────────────────────
    if (!audioPath) {
      throw new Error('Audio generation failed – no audio path set');
    }
    const totalAudioDuration = await getAudioDuration(audioPath);
    sendLog(`✅ Audio duration: ${totalAudioDuration.toFixed(2)} seconds.`);

    sendLog(`⏱️ Distributing ${totalScenes} sub‑scenes proportionally...`);
    const explicitDurations = scenes.map(s => (s as Scene & { duration?: number }).duration || 0);
    const hasExplicitDurations = explicitDurations.every(d => d > 0);
    const totalChars = scenes.reduce((sum, s) => sum + s.text.length, 0);
    let currentTime = 0;
    for (const scene of scenes) {
      const duration = hasExplicitDurations
        ? explicitDurations[scenes.indexOf(scene)]
        : (scene.text.length / totalChars) * totalAudioDuration;
      scene.startTime = currentTime;
      scene.endTime = currentTime + duration;
      currentTime += duration;
    }
    // Scale explicit segment durations to the measured concatenated audio length.
    if (hasExplicitDurations) {
      const scale = totalAudioDuration / currentTime;
      currentTime = 0;
      for (const scene of scenes) {
        const duration = ((scene as Scene & { duration?: number }).duration || 0) * scale;
        scene.startTime = currentTime;
        scene.endTime = currentTime + duration;
        currentTime += duration;
      }
    }

    sendProgress(30, 'Splitting scenes', updateETA(startTime, 3, 6));
    sendLog(`📝 Scenes: ${scenes.length} ready.`);

    // ─── Step 5: Download images ──────────────────────────────────
    sendLog('🖼️ Acquiring images for each sub‑scene...');
    sendProgress(55, 'Downloading images', updateETA(startTime, 4, 6));
    const startImages = Date.now();
    await downloadImagesForScenes(scenes, mode, processedScript);
    sendLog(`✅ Images downloaded in ${((Date.now() - startImages) / 1000).toFixed(1)}s`);

    // ─── Step 6: Generate subtitles ──────────────────────────────
    sendLog('📝 Generating subtitles...');
    sendProgress(65, 'Generating subtitles', updateETA(startTime, 5, 6));
    const startSubtitles = Date.now();
    await generateSubtitlesForScenes(scenes);
    sendLog(`✅ Subtitles generated in ${((Date.now() - startSubtitles) / 1000).toFixed(1)}s`);

    // ─── Step 7: Render video ─────────────────────────────────────
    sendLog('🎬 Rendering video...');
    sendProgress(80, 'Rendering video (0%)', updateETA(startTime, 6, 6));
    const finalVideoPath = await renderVideo(
      scenes,
      mode,
      audioPath,
      (progress: number) => {
        const totalProgress = 80 + (progress * 0.2);
        const eta = updateETA(startTime, 6 + progress, 6);
        sendProgress(Math.floor(totalProgress), `Rendering video (${Math.floor(progress * 100)}%)`, eta);
      },
      sendLog
    );

    sendProgress(100, 'Finalizing', '00:00:00');
    const totalDuration = scenes[scenes.length - 1]?.endTime || 0;
    const durationFormatted = formatETA(totalDuration);
    sendLog(`✅ Video generation complete! Duration: ${durationFormatted}`);
    sendDone(finalVideoPath, durationFormatted, totalScenes);
  } catch (error) {
    console.error('❌ Pipeline error:', error);
    sendError(error instanceof Error ? error.message : 'Unknown error occurred');
  } finally {
    if (dialogueDir) {
      sendLog('🧹 Cleaning up dialogue audio files...');
      await fs.rm(dialogueDir, { recursive: true, force: true });
    }
    const combinedAudioPath = path.join(process.cwd(), 'temp', `combined_${videoId}.wav`);
    await fs.unlink(combinedAudioPath).catch(() => {});
  }
}
