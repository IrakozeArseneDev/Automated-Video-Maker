import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { Scene } from '../types/index.js';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { imageSearch } from '@mudbill/duckduckgo-images-api';

const execAsync = promisify(exec);

// ── Configuration (all from .env or defaults) ───────────────
const CACHE_DIR = path.join(process.cwd(), 'downloads', 'cache');
const IMAGES_DIR = path.join(process.cwd(), 'downloads', 'images');
const MIN_IMAGE_WIDTH = parseInt(process.env.MIN_IMAGE_WIDTH || '1280', 10);
const MIN_IMAGE_HEIGHT = parseInt(process.env.MIN_IMAGE_HEIGHT || '720', 10);
const MIN_UPSCALE_WIDTH = parseInt(process.env.MIN_UPSCALE_WIDTH || '200', 10);
const MIN_UPSCALE_HEIGHT = parseInt(process.env.MIN_UPSCALE_HEIGHT || '200', 10);

// ── NO BLACKLIST ───────────────────────────────────────────
const BLACKLIST_DOMAINS: string[] = [];   // all domains allowed

// ── Logging helper ──────────────────────────────────────────
function log(message: string, ...args: any[]) {
  console.log(`[imageService] ${message}`, ...args);
}

// ── Helpers ──────────────────────────────────────────────────
async function ensureDirs() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

function isBlacklistedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return BLACKLIST_DOMAINS.some(domain => host.includes(domain));
  } catch {
    return false;
  }
}

async function getImageDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`
  );
  const [width, height] = stdout.split(',').map(Number);
  log(`  Dimensions: ${width}x${height}`);
  return { width, height };
}

// ── Download with retry ──────────────────────────────────────
async function downloadImage(url: string, outputPath: string): Promise<string> {
  if (isBlacklistedDomain(url)) {
    throw new Error(`Domain blacklisted: ${url}`);
  }

  const maxRetries = 2;
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`  Download attempt ${attempt}/${maxRetries} for ${url.substring(0, 80)}...`);
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: new URL(url).origin,
          Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
        timeout: 15000,
      });
      await fs.writeFile(outputPath, response.data);
      log(`  ✅ Downloaded ${outputPath} (${response.data.length} bytes)`);
      return outputPath;
    } catch (err: any) {
      lastError = err;
      log(`  ❌ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxRetries) {
        log(`  Retrying in 1s...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  throw lastError;
}

// ── Search backends ─────────────────────────────────────────
async function searchWithDuckDuckGo(query: string): Promise<string[]> {
  log(`  🔍 DuckDuckGo for "${query}"`);
  try {
    const results = await imageSearch({
      query,
      retries: 2,
      iterations: 2,
    });
    if (!results || results.length === 0) {
      log(`  No DuckDuckGo results.`);
      return [];
    }
    const urls = results.map(r => r.image).filter(Boolean) as string[];
    log(`  Found ${urls.length} URLs from DuckDuckGo`);
    return urls;
  } catch (error: any) {
    log(`  ❌ DuckDuckGo error: ${error.message}`);
    return [];
  }
}

async function searchPexels(query: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    log(`  ⚠️ Pexels API key not set, skipping.`);
    return null;
  }
  log(`  🔍 Pexels for "${query}"`);
  try {
    const response = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 3, orientation: 'landscape' },
      headers: { Authorization: apiKey },
      timeout: 10000,
    });
    const photo = response.data.photos?.[0];
    if (photo) {
      log(`  Found Pexels photo: ${photo.src?.large}`);
      return photo.src?.large || null;
    } else {
      log(`  No Pexels results.`);
      return null;
    }
  } catch (error: any) {
    log(`  ❌ Pexels API error: ${error.message}`);
    return null;
  }
}

// ── Upscale image to target size (padding with black bars) ──
async function upscaleImage(
  inputPath: string,
  outputPath: string,
  targetWidth: number = MIN_IMAGE_WIDTH,
  targetHeight: number = MIN_IMAGE_HEIGHT
): Promise<void> {
  log(`  🔧 Upscaling ${inputPath} to ${targetWidth}x${targetHeight}...`);
  const filter = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`;
  try {
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "${filter}" -q:v 2 "${outputPath}"`
    );
    log(`  ✅ Upscaled image saved: ${outputPath}`);
  } catch (err: any) {
    log(`  ❌ Upscale failed: ${err.message}`);
    throw err;
  }
}

// ── Quality‑aware download – NEVER discards, always returns an image ──
async function downloadValidImage(
  query: string,
  minWidth: number = MIN_IMAGE_WIDTH,
  minHeight: number = MIN_IMAGE_HEIGHT
): Promise<string | null> {
  log(`📥 downloadValidImage: query="${query}" (target ${minWidth}x${minHeight})`);

  const searchFunctions = [
    () => searchWithDuckDuckGo(query),          // primary: real news/editorial images
    () => searchPexels(query).then(url => url ? [url] : []),
  ];

  for (let idx = 0; idx < searchFunctions.length; idx++) {
    const searchFn = searchFunctions[idx];
    const sourceName = idx === 0 ? 'DuckDuckGo' : 'Pexels';
    log(`  Trying source ${idx+1}/${searchFunctions.length}: ${sourceName}`);
    const urls = await searchFn();
    if (!urls || urls.length === 0) {
      log(`  No URLs from ${sourceName}`);
      continue;
    }
    log(`  ${urls.length} URLs from ${sourceName}`);
    for (const url of urls) {
      if (!url) continue;
      if (isBlacklistedDomain(url)) {
        log(`  ⛔ Skipping blacklisted URL: ${url}`);
        continue;
      }
      try {
        const tempPath = path.join(CACHE_DIR, `temp_${randomUUID()}.jpg`);
        log(`  Attempting download from ${url.substring(0, 80)}...`);
        await downloadImage(url, tempPath);
        const { width, height } = await getImageDimensions(tempPath);

        // Always accept the image – we'll either use it as‑is or upscale it.
        const cacheKey = query
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .slice(0, 100);
        const cachedPath = path.join(CACHE_DIR, `${cacheKey}.jpg`);

        if (width >= minWidth && height >= minHeight) {
          // Already meets target – use directly
          await fs.rename(tempPath, cachedPath);
          log(`  ✅ Image meets target (${width}x${height}). Cached: ${cachedPath}`);
          return cachedPath;
        }

        // If below target but above the minimal upscale threshold, upscale it
        if (width >= MIN_UPSCALE_WIDTH && height >= MIN_UPSCALE_HEIGHT) {
          log(`  ⚠️ Image below target but upscalable (${width}x${height}). Upscaling...`);
          const upscaledTemp = path.join(CACHE_DIR, `upscaled_${randomUUID()}.jpg`);
          await upscaleImage(tempPath, upscaledTemp, minWidth, minHeight);
          await fs.unlink(tempPath).catch(() => {});
          await fs.rename(upscaledTemp, cachedPath);
          log(`  ✅ Upscaled image cached: ${cachedPath}`);
          return cachedPath;
        }

        // Very small image – use as‑is, let the renderer pad it
        log(`  ⚠️ Image very small (${width}x${height}), using without upscaling.`);
        await fs.rename(tempPath, cachedPath);
        log(`  ✅ Small image cached: ${cachedPath}`);
        return cachedPath;
      } catch (err: any) {
        log(`  ❌ Failed to get image from ${url}: ${err.message}`);
      }
    }
  }

  log(`  ❌ No valid image found for query: "${query}"`);
  return null;
}

// ── Fallback query generators ──────────────────────────────
function generateFallbackFromText(text: string): string {
  log(`  Generating fallback query from text: "${text.substring(0, 50)}..."`);
  const cleanText = text.replace(/^(STEVE|STORM|STONE|ATLAS):\s*/i, '').trim();

  const properNames = cleanText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
  if (properNames && properNames.length > 0) {
    const ignored = new Set([
      'I','A','An','The','And','But','Or','For','On','In','At',
      'To','With','From','This','That','It','Is','Was','Are','Were',
      'Will','Would','Could','Should','Have','Has','Had','Do','Does',
      'Did','Not','No','Yes','Just','Like','Now','Then','There','Here',
      'What','Which','Who','Whom','Whose','When','Where','Why','How'
    ]);
    const name = properNames.find(n => !ignored.has(n));
    if (name) {
      const query = `${name} football action`;
      log(`  Using proper name: "${query}"`);
      return query;
    }
  }

  const stopWords = new Set([
    'the','and','for','that','this','with','from','have','are','was',
    'were','but','not','into','also','like','just','will','would',
    'could','should','about','over','than','them','then','what','think',
    'there','here','been','being','more','some','these','those','they',
    'their','very','much','well','back','welcome','discussing','several',
    'transfer','targets','linked','name','caught','attention','make',
    'young','star'
  ]);
  const words = cleanText
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
    .slice(0, 3);
  let query = words.length > 0 ? `${words.join(' ')} football` : 'football match action';
  log(`  Using keyword-based fallback: "${query}"`);
  return query;
}

function getFallbackQueryForSpeaker(speaker: string): string {
  const queries: Record<string, string> = {
    STEVE: 'players lining up before a football match at a major stadium',
    STORM: 'passionate football fans celebrating in a stadium crowd',
    STONE: 'football manager giving instructions from the sideline',
  };
  const query = queries[speaker] || 'football stadium wide shot with fans and pitch';
  log(`  Speaker fallback (${speaker}): "${query}"`);
  return query;
}

// ── Main exported function ──────────────────────────────────
export async function downloadImagesForScenes(
  scenes: Scene[],
  mode: 'short' | 'long',
  fullScript: string
): Promise<void> {
  log(`\n🚀 Starting downloadImagesForScenes: ${scenes.length} scenes, mode=${mode}`);
  await ensureDirs();

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    log(`\n📸 Scene ${scene.id}/${scenes.length-1}: "${scene.text.substring(0, 60)}..."`);

    // Get keyword
    let keyword = scene.keywords?.[0] || '';
    if (!keyword || keyword.trim().length < 3) {
      keyword = generateFallbackFromText(scene.text);
      log(`  Generated fallback keyword: "${keyword}"`);
    } else {
      log(`  Using provided keyword: "${keyword}"`);
    }

    let imagePath: string | null = null;

    // 1. Try primary keyword
    log(`  🔎 Trying primary keyword: "${keyword}"`);
    imagePath = await downloadValidImage(keyword);
    if (imagePath) {
      log(`  ✅ Primary keyword succeeded`);
    } else {
      log(`  ❌ Primary keyword failed`);
    }

    // 2. Try speaker‑specific fallback
    if (!imagePath) {
      const speakerMatch = scene.text.match(/^(STEVE|STORM|STONE|ATLAS):/);
      const speaker = speakerMatch ? speakerMatch[1] : 'STEVE';
      const fallbackQuery = getFallbackQueryForSpeaker(speaker);
      log(`  🔎 Trying speaker fallback: "${fallbackQuery}"`);
      imagePath = await downloadValidImage(fallbackQuery);
      if (imagePath) {
        log(`  ✅ Speaker fallback succeeded`);
      } else {
        log(`  ❌ Speaker fallback failed`);
      }
    }

    // 3. Ultimate fallback: reuse previous image or placeholder
    if (!imagePath) {
      log(`  ⚠️ No image found, attempting ultimate fallback...`);
      let previousImagePath: string | null = null;
      if (i > 0 && scenes[i - 1].imagePath) {
        const prevPath = scenes[i - 1].imagePath;
        if (typeof prevPath === 'string') {
          previousImagePath = prevPath;
          log(`  🔄 Reusing image from scene ${scenes[i - 1].id}: ${prevPath}`);
        }
      }
      if (previousImagePath) {
        imagePath = previousImagePath;
        log(`  ✅ Reused previous image`);
      } else {
        const fallbackPath = path.join(CACHE_DIR, 'fallback.jpg');
        try {
          await fs.access(fallbackPath);
          log(`  Using existing fallback image: ${fallbackPath}`);
        } catch {
          log(`  Creating minimal fallback JPEG...`);
          const minimalJPEG = Buffer.from(
            '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8Af/Z',
            'base64'
          );
          await fs.writeFile(fallbackPath, minimalJPEG);
          log(`  Created fallback: ${fallbackPath}`);
        }
        imagePath = fallbackPath;
        log(`  ⬛ Using placeholder image`);
      }
    }

    // Copy to final output directory
    if (imagePath) {
      const finalPath = path.join(IMAGES_DIR, `scene_${scene.id}_${randomUUID()}.jpg`);
      await fs.copyFile(imagePath, finalPath);
      scene.imagePath = finalPath;
      log(`  💾 Assigned final image: ${finalPath}`);
    } else {
      log(`  ❌ CRITICAL: No image path available for scene ${scene.id}`);
    }
  }

  log(`\n✅ downloadImagesForScenes completed. Total scenes: ${scenes.length}\n`);
}