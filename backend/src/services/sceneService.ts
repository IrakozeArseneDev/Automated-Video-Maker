import { Scene } from '../types/index.js';
import { planFullScript } from './aiScenePlanner.js';

// ── Logging helper ──────────────────────────────────────────
function log(message: string, ...args: any[]) {
  console.log(`[sceneService] ${message}`, ...args);
}

const stopwords = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
  'doing', 'but', 'so', 'if', 'then', 'else', 'when', 'where', 'which', 'while',
  'who', 'whom', 'such', 'some', 'any', 'no', 'yes', 'very', 'just', 'not',
  'from', 'up', 'down', 'into', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'can', 'will', 'just', 'but', 'do', 'make', 'people', 'like',
  'every', 'still', 'even', 'would', 'could', 'should', 'their', 'they', 'them',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'being',
  'through', 'during', 'before', 'after', 'above', 'below', 'between'
]);

function tokenize(text: string): string[] {
  // Not used directly, but kept for completeness
  const tokens = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
  log(`  tokenize: ${tokens.length} tokens from "${text.substring(0, 30)}..."`);
  return tokens;
}

export function extractPhrases(sceneText: string, maxPhrases: number = 3): string[] {
  log(`extractPhrases called with text length ${sceneText.length}, maxPhrases=${maxPhrases}`);
  log(`  Text: "${sceneText.substring(0, 80)}${sceneText.length > 80 ? '...' : ''}"`);
  
  // Remove speaker prefix (e.g., "STEVE: ", "STORM: ", etc.)
  const cleanText = sceneText.replace(/^(STEVE|STORM|STONE|ATLAS):\s*/i, '');
  const words = cleanText.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
  
  log(`  Cleaned text, ${words.length} meaningful words found.`);
  if (words.length === 0) {
    log(`  ⚠️ No words left after filtering, returning empty array.`);
    return [];
  }
  
  const bigrams: string[] = [], trigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopwords.has(words[i]) && !stopwords.has(words[i+1])) {
      bigrams.push(`${words[i]} ${words[i+1]}`);
    }
    if (i < words.length - 2 && !stopwords.has(words[i+2])) {
      trigrams.push(`${words[i]} ${words[i+1]} ${words[i+2]}`);
    }
  }
  log(`  Generated ${bigrams.length} bigrams and ${trigrams.length} trigrams.`);
  
  let phrases = [...trigrams, ...bigrams];
  if (phrases.length === 0) {
    phrases = words.slice(0, maxPhrases);
    log(`  No phrases, using first ${maxPhrases} words as fallback.`);
  }
  const unique = phrases.filter((p, idx, self) => self.indexOf(p) === idx);
  const result = unique.slice(0, maxPhrases);
  log(`  Extracted phrases: ${result.join(', ')}`);
  return result;
}

async function splitUsingAI(script: string): Promise<Scene[]> {
  log(`splitUsingAI: starting with script length ${script.length}`);
  log(`  Script preview: "${script.substring(0, 150)}..."`);
  console.log('🤖 Using AI to plan scenes and image prompts...');
  try {
    const { title, scenes: plannedScenes } = await planFullScript(script);
    log(`  AI returned title: "${title}", ${plannedScenes.length} scenes`);
    console.log(`📌 AI title: "${title}"`);
    const scenes = plannedScenes.map((ps, idx) => ({
      id: idx,
      text: ps.text,
      startTime: 0,
      endTime: 0,
      keywords: ps.imagePrompts,
    }));
    log(`  Mapped ${scenes.length} AI scenes.`);
    return scenes;
  } catch (err: any) {
    log(`  ❌ AI planning failed: ${err.message}`);
    throw err; // will be caught in splitIntoScenes
  }
}

function splitByPunctuation(script: string): Scene[] {
  log(`splitByPunctuation: splitting script (${script.length} chars) by punctuation.`);
  const sentences = script.split(/(?<=[.!?])\s+(?=[A-Z"“])/);
  log(`  Found ${sentences.length} sentences.`);
  const scenesPerGroup = parseInt(process.env.SCENES_PER_GROUP || '1', 10);
  log(`  Grouping ${scenesPerGroup} sentence(s) per scene (SCENES_PER_GROUP=${process.env.SCENES_PER_GROUP || 'default 1'})`);
  const scenes: Scene[] = [];
  for (let i = 0; i < sentences.length; i += scenesPerGroup) {
    const sceneText = sentences.slice(i, i + scenesPerGroup).join(' ');
    if (sceneText.trim()) {
      scenes.push({ id: scenes.length, text: sceneText, startTime: 0, endTime: 0, keywords: [] });
    }
  }
  log(`  Generated ${scenes.length} scenes.`);
  return scenes;
}

export async function splitIntoScenes(script: string): Promise<Scene[]> {
  log(`splitIntoScenes: script length ${script.length}`);
  const useAI = process.env.USE_AI_SCENE_PLANNING === 'true';
  log(`  USE_AI_SCENE_PLANNING = ${process.env.USE_AI_SCENE_PLANNING || 'false'}`);
  if (useAI) {
    log(`  Attempting AI-based scene splitting...`);
    try {
      const scenes = await splitUsingAI(script);
      log(`  AI split succeeded with ${scenes.length} scenes.`);
      return scenes;
    } catch (err) {
      console.error('AI scene planning failed, falling back to rule‑based split:', err);
      log(`  AI failed, falling back to rule‑based split.`);
    }
  } else {
    log(`  Using rule‑based punctuation split.`);
  }
  const scenes = splitByPunctuation(script);
  log(`  Returning ${scenes.length} scenes from rule‑based split.`);
  return scenes;
}

export async function extractKeywordsForScenes(scenes: Scene[]): Promise<Scene[]> {
  log(`extractKeywordsForScenes: processing ${scenes.length} scenes.`);
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    log(`  Scene ${i} (id=${scene.id}): text length ${scene.text.length}`);
    if (!scene.keywords || scene.keywords.length === 0) {
      log(`    No keywords, extracting from text...`);
      let phrases = extractPhrases(scene.text, 3);
      if (phrases.length === 0) {
        log(`    No phrases found, using default keywords.`);
        phrases = ['motivation', 'success', 'life'];
      }
      scene.keywords = phrases.map(p => p.replace(/\s+/g, ' ').trim());
      log(`    Assigned keywords: ${scene.keywords.join(', ')}`);
    } else {
      log(`    Already has ${scene.keywords.length} keywords: ${scene.keywords.join(', ')}`);
    }
  }
  log(`extractKeywordsForScenes completed.`);
  return scenes;
}