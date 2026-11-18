import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { Scene, VideoConfig } from '../types/index.js';
import { randomUUID } from 'crypto';

const TEMP_DIR = path.join(process.cwd(), 'temp');
const OUTPUT_DIR = path.join(process.cwd(), 'output');

async function ensureDirs() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

function getVideoConfig(mode: 'short' | 'long'): VideoConfig {
  return mode === 'short'
    ? { mode: 'short', width: 1080, height: 1920, fps: 30, duration: 0 }
    : { mode: 'long', width: 1920, height: 1080, fps: 30, duration: 0 };
}

/**
 * Build the simple static filter.
 */
function buildStaticFilter(config: VideoConfig, subtitlePath?: string): string {
  let filter = `scale=${config.width}:${config.height}:force_original_aspect_ratio=1,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`;

  if (subtitlePath) {
    const escapedPath = subtitlePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
    const style = "Fontsize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Outline=2,Shadow=1";
    filter += `,subtitles='${escapedPath}':force_style='${style}'`;
  }
  return filter;
}

/**
 * Helper: run ffmpeg and return a promise (captures stderr for debugging)
 */
function runFfmpeg(
  input: string,
  inputOptions: string[],
  outputOptions: string[],
  output: string,
  sendLog?: (msg: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(input)
      .inputOptions(inputOptions)
      .outputOptions(outputOptions)
      .output(output)
      .on('end', () => resolve())
      .on('error', (err, stdout, stderr) => {
        sendLog?.(`❌ ffmpeg error: ${err.message}\nstderr: ${stderr}`);
        reject(err);
      });

    cmd.on('stderr', (line) => {
      if (line.toLowerCase().includes('error')) {
        sendLog?.(`[ffmpeg stderr] ${line}`);
      }
    });

    cmd.run();
  });
}

/**
 * Render a single scene – static only.
 */
async function renderSilentScene(
  scene: Scene,
  config: VideoConfig,
  outputPath: string,
  sendLog?: (msg: string) => void
): Promise<void> {
  const duration = scene.endTime - scene.startTime;
  if (duration <= 0) throw new Error('Invalid scene duration');

  // Build filter with optional subtitles
  const filter = buildStaticFilter(config, scene.subtitlePath);
  sendLog?.(`🎥 Static filter: ${filter}`);

  try {
    await runFfmpeg(
      scene.imagePath!,
      ['-loop 1', '-t', duration.toString()],
      ['-vf', filter, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an'],
      outputPath,
      sendLog
    );
  } catch (err: any) {
    // If subtitles cause a failure, retry without them
    if (scene.subtitlePath) {
      sendLog?.(`⚠️ Scene ${scene.id} failed with subtitles – retrying without them`);
      const noSubFilter = buildStaticFilter(config, undefined);
      await runFfmpeg(
        scene.imagePath!,
        ['-loop 1', '-t', duration.toString()],
        ['-vf', noSubFilter, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an'],
        outputPath,
        sendLog
      );
    } else {
      throw err;
    }
  }
}

// --- concatVideos, addAudioToVideo, renderVideo remain the same ---

async function concatVideos(videoPaths: string[], outputPath: string): Promise<void> {
  if (videoPaths.length === 0) throw new Error('No videos to concatenate');
  if (videoPaths.length === 1) {
    await fs.copyFile(videoPaths[0], outputPath);
    return;
  }
  const concatFile = path.join(TEMP_DIR, `concat_${randomUUID()}.txt`);
  await fs.writeFile(concatFile, videoPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(concatFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
  await fs.unlink(concatFile).catch(() => {});
}

async function addAudioToVideo(silentVideoPath: string, audioPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(silentVideoPath)
      .input(audioPath)
      .outputOptions(['-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

export async function renderVideo(
  scenes: Scene[],
  mode: 'short' | 'long',
  fullAudioPath: string,
  onProgress: (progress: number) => void,
  sendLog?: (msg: string) => void
): Promise<string> {
  await ensureDirs();
  const config = getVideoConfig(mode);
  const sceneVideos: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const duration = scene.endTime - scene.startTime;
    const msg = `🎬 Rendering scene ${i+1}/${scenes.length} (${duration.toFixed(2)}s) – Static`;
    sendLog?.(msg);
    console.log(msg);
    const scenePath = path.join(TEMP_DIR, `scene_${i}.mp4`);
    await renderSilentScene(scene, config, scenePath, sendLog);
    sceneVideos.push(scenePath);
    onProgress((i + 1) / scenes.length);
  }

  const silentFinalPath = path.join(TEMP_DIR, `silent_${Date.now()}.mp4`);
  await concatVideos(sceneVideos, silentFinalPath);

  for (const video of sceneVideos) {
    await fs.unlink(video).catch(() => {});
  }

  const finalPath = path.join(OUTPUT_DIR, `final_${Date.now()}.mp4`);
  await addAudioToVideo(silentFinalPath, fullAudioPath, finalPath);
  await fs.unlink(silentFinalPath).catch(() => {});

  return `/output/${path.basename(finalPath)}`;
}