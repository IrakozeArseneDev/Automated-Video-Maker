import { Scene } from '../types/index.js';
import fs from 'fs/promises';
import path from 'path';

// ── Logging helper ──────────────────────────────────────────
function log(message: string, ...args: any[]) {
  console.log(`[subtitleService] ${message}`, ...args);
}

export async function generateSubtitlesForScenes(scenes: Scene[]): Promise<void> {
  log(`🚀 generateSubtitlesForScenes: ${scenes.length} scenes to process.`);
  const subtitlesDir = path.join(process.cwd(), 'temp', 'subtitles');
  log(`  Creating subtitle directory: ${subtitlesDir}`);
  await fs.mkdir(subtitlesDir, { recursive: true });
  log(`  Directory ready.`);

  let generatedCount = 0;
  let skippedCount = 0;

  for (const scene of scenes) {
    const duration = scene.endTime - scene.startTime;
    log(`\n  Scene ${scene.id}: duration=${duration.toFixed(3)}s, text length=${scene.text.length}`);
    
    if (duration < 0.3) {
      log(`    ⏩ Skipping subtitles for scene ${scene.id} (duration ${duration.toFixed(2)}s < 0.3s)`);
      scene.subtitlePath = undefined;
      skippedCount++;
      continue;
    }

    const srtContent = generateSRTForScene(scene);
    log(`    Generated SRT content length: ${srtContent.length} chars`);

    const blocks = srtContent.trim().split(/\n\s*\n/).filter(b => b.trim().length > 0);
    log(`    Found ${blocks.length} subtitle blocks.`);
    if (blocks.length === 0) {
      log(`    ⚠️ Invalid SRT for scene ${scene.id}, skipping subtitles.`);
      scene.subtitlePath = undefined;
      skippedCount++;
      continue;
    }

    const srtPath = path.join(subtitlesDir, `scene_${scene.id}.srt`);
    await fs.writeFile(srtPath, srtContent, 'utf-8');
    scene.subtitlePath = srtPath;
    generatedCount++;
    log(`    ✅ Generated SRT at ${srtPath} (${srtContent.length} chars, ${blocks.length} blocks)`);
  }

  log(`\n✅ generateSubtitlesForScenes completed: ${generatedCount} generated, ${skippedCount} skipped.`);
}

function generateSRTForScene(scene: Scene): string {
  const words = scene.text.split(/\s+/);
  const duration = scene.endTime - scene.startTime;
  log(`  generateSRTForScene: ${words.length} words, duration=${duration.toFixed(3)}s`);
  
  if (duration <= 0) {
    log(`    ⚠️ Zero or negative duration, returning empty.`);
    return '';
  }

  // If duration is very short, just put the whole text in one subtitle
  if (duration < 1.0) {
    const start = formatTime(scene.startTime);
    const end = formatTime(scene.endTime);
    const srt = `1\n${start} --> ${end}\n${scene.text}\n`;
    log(`    Short scene (<1s), single subtitle: ${srt.substring(0, 50)}...`);
    return srt;
  }

  // Otherwise, split into chunks based on words per second
  const wordsPerSecond = words.length / duration;
  log(`    Words per second: ${wordsPerSecond.toFixed(2)}`);
  let currentTime = scene.startTime;
  const subtitles: string[] = [];
  let subtitleIndex = 1;
  const maxWordsPerSubtitle = 8;
  const minDuration = 0.5;

  let chunksAdded = 0;
  for (let i = 0; i < words.length; i += maxWordsPerSubtitle) {
    const chunk = words.slice(i, i + maxWordsPerSubtitle).join(' ');
    let chunkDuration = chunk.split(/\s+/).length / wordsPerSecond;
    if (chunkDuration < minDuration) chunkDuration = minDuration;
    const endTime = Math.min(currentTime + chunkDuration, scene.endTime);
    if (endTime - currentTime < 0.1) {
      log(`      Skipping tiny chunk at ${currentTime.toFixed(3)}s (remaining ${(endTime-currentTime).toFixed(3)}s)`);
      break;
    }
    subtitles.push(`${subtitleIndex}`);
    subtitles.push(`${formatTime(currentTime)} --> ${formatTime(endTime)}`);
    subtitles.push(chunk);
    subtitles.push('');
    log(`      Chunk ${subtitleIndex}: "${chunk.substring(0, 30)}..." [${formatTime(currentTime)} -> ${formatTime(endTime)}]`);
    currentTime = endTime;
    subtitleIndex++;
    chunksAdded++;
  }
  const result = subtitles.join('\n').trim();
  log(`    Generated ${chunksAdded} subtitle chunks.`);
  return result;
}

function formatTime(seconds: number): string {
  const totalSeconds = Math.max(0, seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const millis = Math.floor((totalSeconds % 1) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${padMillis(millis)}`;
}

function pad(num: number): string {
  return num.toString().padStart(2, '0');
}

function padMillis(num: number): string {
  return num.toString().padStart(3, '0');
}