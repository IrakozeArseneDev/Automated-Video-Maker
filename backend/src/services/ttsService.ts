import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

const PIPER_BIN = process.env.PIPER_BIN || '/usr/local/bin/piper';
const PIPER_LIB_PATH = process.env.PIPER_LIB_PATH || '';
const MODELS_DIR = path.join(process.cwd(), 'models');

// ── Logging helper ──────────────────────────────────────────
function log(message: string, ...args: any[]) {
  console.log(`[ttsService] ${message}`, ...args);
}

export async function generateVoice(text: string, voiceId: string, speed: number = 1.0): Promise<string> {
  log(`🚀 generateVoice called: voiceId=${voiceId}, speed=${speed}, text length=${text.length}`);
  log(`  Text preview: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

  const tempDir = path.join(process.cwd(), 'temp');
  log(`  Ensuring temp directory: ${tempDir}`);
  await fs.mkdir(tempDir, { recursive: true });

  const outputPath = path.join(tempDir, `audio_${randomUUID()}.wav`);
  const modelPath = path.join(MODELS_DIR, `${voiceId}.onnx`);
  log(`  Output path: ${outputPath}`);
  log(`  Model path: ${modelPath}`);

  // Validate model exists
  try {
    await fs.access(modelPath);
    log(`  ✅ Voice model found.`);
  } catch (err: any) {
    log(`  ❌ Voice model not found: ${modelPath}`);
    throw new Error(`Voice model not found: ${voiceId}`);
  }

  let textFile: string | null = null;
  try {
    textFile = path.join(tempDir, `text_${randomUUID()}.txt`);
    log(`  Creating text file: ${textFile}`);
    await fs.writeFile(textFile, text);
    log(`  Text file written (${text.length} bytes).`);

    let cmd = '';
    if (PIPER_LIB_PATH) {
      cmd = `LD_LIBRARY_PATH="${PIPER_LIB_PATH}:$LD_LIBRARY_PATH" `;
      log(`  Setting LD_LIBRARY_PATH: ${PIPER_LIB_PATH}`);
    }
    cmd += `"${PIPER_BIN}" --model "${modelPath}" --output_file "${outputPath}" < "${textFile}"`;
    log(`  Executing: ${cmd}`);
    await execAsync(cmd, { shell: '/bin/bash', env: { ...process.env, LD_LIBRARY_PATH: PIPER_LIB_PATH } });
    log(`  ✅ Piper TTS completed.`);

    // Clean up text file
    await fs.unlink(textFile);
    textFile = null;
    log(`  🧹 Removed temp text file.`);

    // Apply speed change if needed
    if (speed !== 1.0) {
      log(`  ⏩ Applying speed change: ${speed}x`);
      const adjustedPath = path.join(tempDir, `audio_${randomUUID()}.wav`);
      const ffmpegCmd = `ffmpeg -i "${outputPath}" -filter:a "atempo=${speed}" "${adjustedPath}"`;
      log(`  Executing: ${ffmpegCmd}`);
      await execAsync(ffmpegCmd);
      log(`  ✅ Speed adjustment complete.`);
      await fs.unlink(outputPath);
      await fs.rename(adjustedPath, outputPath);
      log(`  🧹 Replaced original with speed-adjusted audio.`);
    } else {
      log(`  No speed change needed (speed=1.0).`);
    }

    // Verify output file exists
    await fs.access(outputPath);
    const stats = await fs.stat(outputPath);
    log(`  ✅ Final audio file: ${outputPath} (${stats.size} bytes)`);
    return outputPath;
  } catch (error: any) {
    log(`  ❌ TTS generation failed: ${error.message}`);
    console.error('TTS generation failed:', error);
    // Clean up text file if still present
    if (textFile) {
      await fs.unlink(textFile).catch(() => {});
      log(`  🧹 Cleaned up text file after error.`);
    }
    throw error;
  }
}

export async function generateVoiceSample(text: string, voiceId: string, speed: number): Promise<string> {
  log(`🎤 generateVoiceSample called (wrapper).`);
  return generateVoice(text, voiceId, speed);
}
