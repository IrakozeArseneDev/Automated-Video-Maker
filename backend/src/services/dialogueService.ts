import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { generateVoice } from './ttsService.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface DialogueLine {
  speaker: string;
  text: string;
  audioPath?: string;
  duration: number;
  index: number;
}

const speakerVoiceMap: Record<string, string> = {
  STEVE: process.env.VOICE_STEVE || 'en_US-ryan-high',
  STORM: process.env.VOICE_STORM || 'en_US-lessac-high',
  STONE: process.env.VOICE_STONE || 'en_US-joe-medium',
  ATLAS: process.env.VOICE_ATLAS || 'en_US-amy-high',
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelay?: number; onRetry?: (e: any, attempt: number) => void } = {}
): Promise<T> {
  const { retries = 3, baseDelay = 2000, onRetry } = options;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === retries) throw err;
      if (err.status === 429) {
        onRetry?.(err, attempt);
        await delay(baseDelay * Math.pow(2, attempt));
      } else if (attempt < retries) {
        onRetry?.(err, attempt);
        await delay(baseDelay);
      } else {
        throw err;
      }
    }
  }
  throw new Error('Unreachable');
}

function log(message: string, sendLog?: (msg: string) => void) {
  console.log(`[dialogueService] ${message}`);
  if (sendLog) sendLog(message);
}

async function exportAIResponse(
  data: any,
  prefix: string,
  videoId?: string
): Promise<string> {
  const exportDir = path.join(process.cwd(), 'logs', 'ai_exports');
  await fs.mkdir(exportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = videoId || randomUUID().slice(0, 8);
  const filename = `${prefix}_${id}_${timestamp}.json`;
  const filePath = path.join(exportDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[dialogueService] 📁 Exported AI data to ${filePath}`);
  return filePath;
}

// ─── Improved parse – handles inline speaker tags ─────────────────────────
export function parseDialogueScript(script: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  let normalized = script.replace(/(\b(STEVE|STORM|STONE|ATLAS):\s*)/g, '\n$1');
  normalized = normalized.replace(/\n{2,}/g, '\n').trim();
  const parts = normalized.split('\n');
  let globalIndex = 0;
  for (const part of parts) {
    const match = part.match(/^(STEVE|STORM|STONE|ATLAS):\s*(.+)$/i);
    if (match) {
      lines.push({
        speaker: match[1],
        text: match[2].trim(),
        duration: 0,
        index: globalIndex++,
      });
    }
  }
  return lines;
}

// ─── Smart deduplication (AI rephrase) ────────────────────────────────────
async function deduplicateDialogueLines(
  fullDialogue: string,
  sendLog?: (msg: string) => void
): Promise<string> {
  const lines = fullDialogue.split('\n');
  const seen = new Map<string, number[]>();
  const duplicates: number[] = [];

  lines.forEach((line, idx) => {
    const match = line.match(/^[A-Z]+:\s*(.+)$/);
    if (match) {
      const content = match[1].trim().toLowerCase();
      if (seen.has(content)) {
        duplicates.push(idx);
        seen.get(content)!.push(idx);
      } else {
        seen.set(content, [idx]);
      }
    }
  });

  if (duplicates.length === 0) return fullDialogue;

  log(`Found ${duplicates.length} duplicate lines, requesting AI rephrase...`, sendLog);

  for (const idx of duplicates) {
    const line = lines[idx];
    const speaker = line.match(/^([A-Z]+):/)?.[1];
    if (!speaker) continue;

    const context = lines
      .slice(Math.max(0, idx - 2), idx)
      .concat(lines.slice(idx + 1, idx + 3))
      .join('\n');

    const rephrasePrompt = `
You are a football discussion moderator. A duplicate line was detected. The speaker "${speaker}" said something almost identical to an earlier line. Rephrase it to keep the conversation flowing naturally, while staying on the same topic.

CONTEXT (what was said before/after):
${context}

DUPLICATE LINE TO REPLACE:
${line}

RULES:
- Keep the same speaker (${speaker}) and football subject.
- Change the wording completely – no repeated phrases.
- Keep it short (≤15 words).
- Must sound natural for ${speaker}'s personality (${
  speaker === 'STEVE' ? 'presenter' : speaker === 'STORM' ? 'passionate fan' : 'analyst'
}).
- Output ONLY the new line in the format: ${speaker}: [new text]

New line:`;

    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        temperature: 0.9,
        max_tokens: 60,
        messages: [{ role: 'user', content: rephrasePrompt }],
      });
      const newLine = completion.choices[0]?.message?.content?.trim() || '';
      const match = newLine.match(/^[A-Z]+:\s*(.+)$/);
      if (match) {
        lines[idx] = newLine;
        log(`  Rephrased line ${idx} to: ${newLine}`, sendLog);
      } else {
        log(`  Rephrase failed, keeping original.`, sendLog);
      }
    } catch (err) {
      log(`  Rephrase API call failed, keeping original.`, sendLog);
    }
  }

  return lines.join('\n');
}

// ─── Fallback image query (only absolute last resort) ─────────────────────
function getFallbackQueryForSpeaker(speaker: string): string {
  if (speaker === 'STEVE') return 'football players warming up on pitch with stadium lights';
  if (speaker === 'STORM') return 'ecstatic football fans cheering in a packed stadium';
  if (speaker === 'STONE') return 'football manager giving instructions from the sideline';
  return 'wide shot of a football stadium during a match';
}

// ─── Photographic quality enforcement – bans speaker names too ────────────
function enforcePhotographicQuality(prompts: string[], speaker: string): string[] {
  const forbiddenWords = [
    'possession', 'pressure', 'momentum', 'dominance', 'control',
    'excitement', 'intense', 'scene', 'moment', 'football action',
    'match action', 'game action', 'photo', 'image', 'picture',
    'gallery', 'images', 'photos', 'pictures', 'video', 'clip',
    'transfer window chaos', 'impact on', 'collapse images',
    'struggles photo gallery', 'clock', 'ticker', 'graphic overlay',
    'digital display', 'screen showing', 'TV screen', 'monitor',
    'studio', 'desk', 'newsroom', 'presenter desk', 'overlay',
    'tactical board', 'analysis board', 'talking head', 'pundit',
    'STEVE', 'STORM', 'STONE', 'ATLAS'
  ];

  const cleaned = prompts.map(p => {
    let phrase = p.trim();
    for (const word of forbiddenWords) {
      phrase = phrase.replace(new RegExp(`\\b${word}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
    }
    phrase = phrase.replace(/^[^\w]+/, '').replace(/[^\w]+$/, '');
    if (phrase.split(/\s+/).length < 5) {
      phrase = getFallbackQueryForSpeaker(speaker);
    }
    return phrase;
  }).filter(p => p.length > 10);

  if (cleaned.length === 0) {
    return [getFallbackQueryForSpeaker(speaker)];
  }
  return cleaned;
}

// ─── Main dialogue conversion ─────────────────────────────────────────────
export async function convertToDialogueScript(
  plainScript: string,
  sendLog?: (msg: string) => void,
  videoId?: string
): Promise<string> {
  const localLog = (msg: string) => log(msg, sendLog);

  localLog('Starting convertToDialogueScript (rules‑only version)');
  const topics = plainScript
    .split(/\n\s*\n/)
    .map(t => t.trim())
    .filter(Boolean);
  localLog(`Found ${topics.length} topics.`);

  let fullDialogue = '';
  let lastSpeaker = 'STONE';
  const rawResponses: any[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const isFirst = i === 0;
    const isLast = i === topics.length - 1;
    localLog(`Processing topic ${i + 1}/${topics.length}`);

    const prompt = `
You are writing a dynamic football discussion for the viral show "Pitchside News Network".

HOSTS & PERSONALITIES:
- STEVE: confident presenter, keeps the conversation moving, asks sharp questions.
- STORM: passionate fan, emotional, dramatic, sometimes outrageous.
- STONE: cool-headed analyst, factual, drops surprising stats.

${isFirst ? `
IMPORTANT – FIRST TOPIC OPENING (MUST FOLLOW EXACTLY):
- The VERY FIRST line of the ENTIRE conversation must be a welcome from STEVE. He must say: "Welcome back to Pitchside News Network. I'm Steve, and today we're talking about [MAIN THEME OF THIS TOPIC]."
- After that welcome line, the VERY NEXT line must be a shocking stat, a controversial opinion, or a dramatic statement that hooks the audience. This second line MUST be completely original and relevant to the topic — DO NOT copy any example from this prompt.
- DO NOT write any other welcome or introductory lines later in the script.
` : `
CONTINUATION RULE:
- Continue the conversation naturally from where it left off.
- DO NOT reintroduce the show or the hosts. Never say "Welcome back to Pitchside News Network" again.
`}

RETENTION RULES (CRITICAL):
- Every line must spark curiosity or an emotional reaction.
- Speakers must disagree or add tension occasionally – no bland agreement.
- Avoid filler like "Let's talk about...", "That's interesting".
- Each speaker should sound distinctly different.

CONTENT RULES (MUST FOLLOW):
- You MUST ONLY discuss the teams, players, and facts explicitly mentioned in THIS topic below.
- DO NOT invent any player names, team names, or any other proper nouns that are not present in the topic.
- DO NOT invent any specific numbers, percentages, transfer fees, goal counts, or statistics. If the topic does not provide a number, use phrases like “reportedly” or avoid mentioning figures entirely.
- Do NOT mention any other teams or matches not present here.
- Do NOT repeat the same phrase or opinion.

${isLast ? `
FINAL TOPIC – CRITICAL RULE AGAINST INVENTING NAMES:
- This is the concluding paragraph. It may NOT contain any specific player or team names. If the topic provides NO names, you MUST NOT invent any. Instead, use ONLY generic terms like "the top players", "these legends", "the teams", "the stars", "the remaining nations", etc.
- Do NOT create any fictional characters or names.
- End the conversation exactly as instructed above (STORM opinion, STONE insight, STEVE sign-off).
` : `
- If the topic mentions specific players or teams, you may use those names. If it does NOT, you MUST NOT invent any.
`}

STRUCTURE:
- Around 4–6 lines total for this topic (flexible based on content richness).
- Each line MUST start with the speaker's name (STEVE:, STORM:, STONE:).
${isLast ? `
FINAL TOPIC ENDING:
- After the natural discussion of this topic, end the conversation with:
  * STORM gives a final punchy opinion (NO brackets, NO parentheses)
  * STONE gives a final insight or surprising stat (NO brackets, NO parentheses)
  * STEVE signs off with: "And that's all for Pitchside News Network. See you next time."
- IMPORTANT: Do NOT output any text inside square brackets or parentheses. Write only the spoken words.` : ''}

TOPIC:
${topic}

Produce ONLY the dialogue, each line beginning with the speaker name. Do not include any other text.
`;

    const maxTokens = isLast ? 600 : 400;

    let rawResponse = '';
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        temperature: 0.75,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      rawResponse = completion.choices[0]?.message?.content?.trim() || '';
      localLog(`  Response received (${rawResponse.length} chars)`);
    } catch (err: any) {
      localLog(`❌ Failed: ${err.message}`);
      throw new Error(`Groq API failed for topic ${i + 1}: ${err.message}`);
    }

    rawResponses.push({ topicIndex: i, raw: rawResponse });

    const lines = rawResponse.split('\n').filter(l => /^(STEVE|STORM|STONE):/.test(l));
    if (lines.length === 0) {
      throw new Error(`No dialogue lines in response for topic ${i + 1}`);
    }

    fullDialogue += rawResponse;
    if (!isLast) fullDialogue += '\n\n';

    const lastLine = [...lines].reverse().find(l => /^(STEVE|STORM|STONE):/.test(l));
    if (lastLine) {
      const match = lastLine.match(/^(STEVE|STORM|STONE):/);
      if (match) lastSpeaker = match[1];
    }
  }

  // Deduplicate
  let finalDialogue = await deduplicateDialogueLines(fullDialogue.trim(), sendLog);

  // Cleanup: remove brackets and parentheses, collapse extra spaces, keep newlines
  finalDialogue = finalDialogue
    .replace(/\[[^\]]+\]/g, '')            // remove square brackets
    .replace(/\([^)]*\)/g, '')             // remove parentheses (stage directions)
    .replace(/[^\S\n]{2,}/g, ' ')          // collapse multiple spaces (preserve newlines)
    .trim();

  // ── SAFETY NET: Strip accidental "Welcome back" from non‑first topics ──
  const topicBlocks = finalDialogue.split(/\n\n+/);
  if (topicBlocks.length > 1) {
    const cleanedBlocks = topicBlocks.map((block, idx) => {
      if (idx === 0) return block;
      return block.replace(/^STEVE:\s*Welcome back to Pitchside News Network[^\n]*\n?/im, '');
    });
    finalDialogue = cleanedBlocks.join('\n\n');
  }

  // Export for inspection
  const exportData = {
    timestamp: new Date().toISOString(),
    videoId: videoId || 'unknown',
    topicCount: topics.length,
    rawResponses,
    finalDialogue,
  };
  await exportAIResponse(exportData, 'dialogue_rules_only', videoId);

  localLog(`✅ Dialogue generated: ${parseDialogueScript(finalDialogue).length} lines.`);
  return finalDialogue;
}

// ─── Image prompt generation ───────────────────────────────────────────────
export async function generateImagePromptsForLines(
  lines: DialogueLine[],
  contextSummary: string,
  sendLog?: (msg: string) => void
): Promise<string[][]> {
  const localLog = (msg: string) => log(msg, sendLog);
  localLog(`generateImagePromptsForLines called for ${lines.length} lines.`);
  if (lines.length === 0) return [];

  const BATCH_SIZE = 3;
  const batches: DialogueLine[][] = [];
  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    batches.push(lines.slice(i, i + BATCH_SIZE));
  }
  localLog(`Split into ${batches.length} batches.`);

  const allPrompts: string[][] = [];
  const rawExportData: any[] = [];
  let globalIndex = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    localLog(`Processing batch ${batchIdx + 1}/${batches.length} (lines ${globalIndex + 1}-${globalIndex + batch.length})`);

    const perLineInstructions = batch
      .map((l, idx) => {
        const lineNum = globalIndex + idx + 1;
        const speakerHint =
          l.speaker === 'STORM' ? ' (passionate fan – images: crowd celebrations, dramatic player reactions, fan energy)' :
          l.speaker === 'STONE' ? ' (analyst – images: player close-ups, manager gestures on pitch, real match action)' :
          ' (presenter – images: stadium atmosphere, key match moments, player arrivals)';
        return `Line ${lineNum} (${l.speaker}${speakerHint}): "${l.text}"`;
      })
      .join('\n');

    const prompt = `
You are a sports photo editor selecting images for a football show.

For each of the ${batch.length} lines below, provide EXACTLY 2 search queries (6–16 words) that would find real photographs matching the speaker's words and personality.

CRITICAL RULES:
- EVERY query must describe a REAL PHOTOGRAPHABLE moment – no diagrams, tactics boards, formations, lineups, or abstract concepts.
- EVERY query must contain at least ONE proper noun: a real player name, team name, stadium, or competition. Use names from the line's context.
- MATCH THE SPEAKER'S PERSONALITY (see hints above).
- TEAM ALIGNMENT: The team/player mentioned in the query must match the teams/players discussed in the line. Do NOT put Tite (Brazil) with Germany, etc.
- OPPONENT RULE: ONLY use the teams/players that are explicitly mentioned IN THE LINE TEXT or IN THE CONTEXT SUMMARY. Never invent an opponent. If the line talks about a team's defense without naming an opponent, use "World Cup 2026" instead of a specific team.
- NEVER use the speaker names "STEVE", "STORM", "STONE", "ATLAS" anywhere in the queries.
- FORBIDDEN words/phrases (do NOT use): "football stadium action", "match action", "game action", "scene", "image", "photo", "intense moment", "players lining up", "tactical", "formation", "lineup", "strategy", "diagram", "tactics board", "analysis board", "talking head", "studio", "desk", "newsroom".
- If the line mentions a specific event or result, include the opponent and year (e.g., "Germany dejected after loss to South Korea 2018").
- The two queries for each line must be DIFFERENT from each other.
- Return ONLY a JSON array of arrays. Outer array length = ${batch.length}, each inner array has exactly 2 strings.
- No markdown, no extra text.

GOOD EXAMPLES:
  ["Vinícius Júnior dribbling past defender Brazil 2026", "Brazil team celebration after goal against Japan"]
  ["Germany players dejected after loss South Korea 2018", "South Korea fans celebrating World Cup victory"]

BAD EXAMPLES (DO NOT USE):
  ["football stadium action", "players lining up before match"]
  ["Tactical formation of Germany's defense", "Germany's 4-3-3 lineup"]
  ["Tite on touchline gesturing to Germany players"]
  ["Storm celebrating Brazil's World Cup victory", "Stone analyzing the match"]

Context summary: ${contextSummary}

Lines:
${perLineInstructions}

JSON array:`;

    let batchPrompts: string[][] = [];
    let success = false;
    let retries = 2;
    let rawApiResponse = '';

    while (!success && retries >= 0) {
      try {
        const completion = await withRetry(
          () =>
            groq.chat.completions.create({
              messages: [{ role: 'user', content: prompt }],
              model: 'llama-3.1-8b-instant',
              temperature: 0.2,
              max_tokens: 600,
            }),
          { retries: 2 }
        );

        rawApiResponse = completion.choices[0]?.message?.content || '';
        let raw = rawApiResponse.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        localLog(`Batch ${batchIdx + 1} response (${raw.length} chars). Preview: ${raw.substring(0, 150)}...`);

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          throw new Error(`Invalid JSON: ${e}`);
        }

        // Accept if the response has at least as many arrays as we need
        if (Array.isArray(parsed) && parsed.length >= batch.length) {
          parsed = parsed.slice(0, batch.length); // keep only the needed number
          const cleaned: string[][] = [];
          let valid = true;
          for (let i = 0; i < batch.length; i++) {
            const line = batch[i];
            const rawQueries = parsed[i];
            if (!Array.isArray(rawQueries)) { valid = false; break; }
            const queryCandidates = rawQueries
              .filter((q: any) => typeof q === 'string' && q.trim().length > 0)
              .slice(0, 2);
            let safeQueries = enforcePhotographicQuality(queryCandidates, line.speaker);
            safeQueries = await ensureSpecificAndNotBroken(safeQueries, line.text, line.speaker, sendLog);

            const uniqueQueries = [...new Set(safeQueries)];
            while (uniqueQueries.length < 2) {
              const fallback = await generateFallbackQueryFromLine(line.text, line.speaker, sendLog);
              uniqueQueries.push(fallback);
            }
            if (uniqueQueries[0] === uniqueQueries[1]) {
              const alt = await generateAlternativeQuery(uniqueQueries[0], line.text, line.speaker, sendLog);
              if (alt) uniqueQueries[1] = alt;
            }
            cleaned.push(uniqueQueries.slice(0, 2));
          }
          if (valid) {
            batchPrompts = cleaned;
            success = true;
            localLog(`Batch ${batchIdx + 1} parsed & cleaned successfully.`);
          } else {
            throw new Error(`Invalid format: expected array of arrays`);
          }
        } else {
          throw new Error(`Expected ${batch.length} arrays, got ${parsed?.length || 0}`);
        }
      } catch (err: any) {
        if (retries > 0) {
          localLog(`⚠️ Retry for batch ${batchIdx + 1}: ${err.message}`);
          retries--;
          await delay(1500);
        } else {
          localLog(`❌ Failed after retries for batch ${batchIdx + 1}.`);
          const fallbackBatch: string[][] = [];
          for (const line of batch) {
            fallbackBatch.push([
              await generateFallbackQueryFromLine(line.text, line.speaker, sendLog),
              await generateFallbackQueryFromLine(line.text, line.speaker, sendLog)
            ]);
          }
          allPrompts.push(...fallbackBatch);
          globalIndex += batch.length;
          rawExportData.push({ batchIdx, rawApiResponse, error: err.message, usedFallback: true });
          continue;
        }
      }
    }

    if (success) {
      allPrompts.push(...batchPrompts);
      rawExportData.push({ batchIdx, rawApiResponse, cleanedPrompts: batchPrompts });
    }
    globalIndex += batch.length;
    if (batchIdx < batches.length - 1) await delay(1500);
  }

  // Final validation
  for (let i = 0; i < allPrompts.length; i++) {
    if (allPrompts[i].length !== 2) {
      allPrompts[i] = [
        await generateFallbackQueryFromLine(lines[i]?.text || '', lines[i]?.speaker || 'STEVE', sendLog),
        await generateFallbackQueryFromLine(lines[i]?.text || '', lines[i]?.speaker || 'STEVE', sendLog)
      ];
    }
  }

  const exportData = {
    timestamp: new Date().toISOString(),
    lineCount: lines.length,
    contextSummary,
    lines: lines.map(l => ({ speaker: l.speaker, text: l.text })),
    batches: rawExportData,
    finalPrompts: allPrompts,
  };
  await exportAIResponse(exportData, 'image_prompts', undefined);
  localLog(`📁 Exported image prompt data to logs/ai_exports/`);

  localLog(`✅ Generated ${allPrompts.length} prompt arrays (each with 2 queries).`);
  return allPrompts;
}

// ─── Helper: detect generic/broken queries ─────────────────────────────────
async function ensureSpecificAndNotBroken(
  queries: string[],
  lineText: string,
  speaker: string,
  sendLog?: (msg: string) => void
): Promise<string[]> {
  const genericPatterns = [
    /football stadium action/i,
    /players lining up/i,
    /football match/i,
    /stadium shot/i,
    /soccer game/i,
    /tactical/i,
    /formation/i,
    /lineup/i,
    /strategy/i,
    /diagram/i,
    /possession/i,
  ];
  const doublePrepositionPattern = /\b(under|over|in|on|at|with|by|from|to|for|of)\s+(under|over|in|on|at|with|by|from|to|for|of)\b/i;
  const result: string[] = [];
  for (const q of queries) {
    if (
      genericPatterns.some(p => p.test(q)) ||
      doublePrepositionPattern.test(q) ||
      q.split(/\s+/).length < 5
    ) {
      const specific = await generateFallbackQueryFromLine(lineText, speaker, sendLog);
      result.push(specific);
    } else {
      result.push(q);
    }
  }
  return result;
}

// ─── Fallback that creates a specific query from the line text ─────────────
async function generateFallbackQueryFromLine(
  lineText: string,
  speaker: string,
  sendLog?: (msg: string) => void
): Promise<string> {
  // Special case for sign-off lines – return a neutral stadium shot
  if (/(that's all for|See you next time)/i.test(lineText)) {
    return 'football stadium aerial view World Cup 2026';
  }

  const properNouns = lineText.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/g) || [];
  const footballEntities = properNouns.filter(n =>
    /Brazil|Germany|Japan|Paraguay|Netherlands|Morocco|Argentina|France|England|Spain|Italy|Portugal|Croatia|Belgium|Uruguay|Colombia|Mexico|USA|Senegal|Ghana|Cameroon|Serbia|Switzerland|World Cup|Champions League|Premier League|La Liga|Serie A|Bundesliga|Ligue 1|MLS/i.test(n) ||
    /Vinícius|Musiala|Wirtz|Jesus|Martinez|Cunha|Neymar|Messi|Ronaldo|Mbappe|Haaland|Kane|Saka|Pedri|Gavi|Bellingham|Tite|Klinsmann|Flick|Scaloni|Southgate|Alisson|Tomiyasu|Itakura|Kamada|Sanabria/i.test(n)
  );
  if (footballEntities.length >= 1) {
    const entity = footballEntities[0];
    const year = '2026';
    const speakerAction = speaker === 'STORM' ? 'fans celebration' :
                          speaker === 'STONE' ? 'player reaction close-up' :
                          'stadium atmosphere';
    return `${entity} ${speakerAction} during World Cup ${year}`;
  }
  try {
    const prompt = `Generate a very short (6-10 words) specific football photo search query based on this dialogue line. Use real player/team names, no abstract words. Line: "${lineText.substring(0, 150)}". Return only the query.`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 30,
      messages: [{ role: 'user', content: prompt }],
    });
    const query = completion.choices[0]?.message?.content?.trim() || '';
    return query && query.length > 5 ? query : getFallbackQueryForSpeaker(speaker);
  } catch {
    return getFallbackQueryForSpeaker(speaker);
  }
}

// ─── Generate an alternative query when duplicates appear ─────────────────
async function generateAlternativeQuery(
  existingQuery: string,
  lineText: string,
  speaker: string,
  sendLog?: (msg: string) => void
): Promise<string | null> {
  try {
    const prompt = `The current image search query is "${existingQuery}". Generate a different but equally specific football photo query (6-12 words) based on the line: "${lineText.substring(0, 150)}". Ensure it contains a proper noun and is photographable. Return only the query.`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_tokens: 30,
      messages: [{ role: 'user', content: prompt }],
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

// ─── Generate per‑speaker audio files ──────────────────────────────────────
export async function generateDialogueAudio(
  lines: DialogueLine[],
  speed: number,
  videoId: string,
  sendLog?: (msg: string) => void
): Promise<DialogueLine[]> {
  log(`Starting generateDialogueAudio for ${lines.length} lines, speed=${speed}, videoId=${videoId}`, sendLog);
  const dialogueDir = path.join(process.cwd(), 'temp', 'dialogue', videoId);
  await fs.mkdir(dialogueDir, { recursive: true });
  log(`Dialogue directory created: ${dialogueDir}`, sendLog);

  const CONCURRENCY = 3;
  const results: DialogueLine[] = new Array(lines.length);
  const queue = lines.map((line, idx) => ({ line, idx }));

  async function worker() {
    while (queue.length > 0) {
      const { line, idx } = queue.shift()!;
      const voiceId = speakerVoiceMap[line.speaker];
      if (!voiceId) {
        log(`❌ No voice mapping for speaker ${line.speaker}`, sendLog);
        throw new Error(`No voice for ${line.speaker}`);
      }
      const fileName = `${line.speaker}_${String(line.index + 1).padStart(3, '0')}.wav`;
      const audioPath = path.join(dialogueDir, fileName);
      try {
        log(`🎤 Generating ${fileName} for line ${idx+1} (speaker ${line.speaker})`, sendLog);
        const generatedPath = await generateVoice(line.text, voiceId, speed);
        log(`  TTS generated: ${generatedPath}`, sendLog);
        await fs.rename(generatedPath, audioPath);
        log(`  Renamed to ${audioPath}`, sendLog);

        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
        );
        const duration = parseFloat(stdout.trim());
        log(`  Duration: ${duration.toFixed(2)}s`, sendLog);
        results[idx] = { ...line, audioPath, duration };
      } catch (err: any) {
        log(`❌ Failed on ${fileName}: ${err.message}`, sendLog);
        log(`  Using silence fallback for line ${idx+1}`, sendLog);
        const silencePath = path.join(dialogueDir, `silence_${idx}.wav`);
        await (await import('child_process')).exec(
          `ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t 1 -q:a 9 -acodec pcm_s16le "${silencePath}"`
        );
        results[idx] = { ...line, audioPath: silencePath, duration: 1.0 };
      }
    }
  }

  log(`Starting ${CONCURRENCY} workers for parallel audio generation`, sendLog);
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  log(`Audio generation completed for all ${lines.length} lines.`, sendLog);
  return results;
}

// ─── Context summary (now covers all matches) ─────────────────────────────
export async function generateContextSummary(
  fullDialogueScript: string,
  sendLog?: (msg: string) => void
): Promise<string> {
  log(`generateContextSummary called (script length: ${fullDialogueScript.length})`, sendLog);
  const truncatedScript = fullDialogueScript.slice(0, 2000);
  const prompt = `Extract the key football topics from this dialogue.
Output ONLY a single sentence (max 200 characters) that mentions ALL the main teams, matches, or events discussed.
Do NOT include any introductory text like "Here is a sentence...".
If no specific topic, use "recent football news and matches".
Dialogue:
${truncatedScript}
Summary:`;
  try {
    log(`Calling Groq for context summary...`, sendLog);
    const completion = await withRetry(() =>
      groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
        temperature: 0.3,
        max_tokens: 100,
      })
    );
    const summary = completion.choices[0]?.message?.content?.trim() || '';
    if (summary && summary.length > 10) {
      const cleanSummary = summary.replace(/^(Here is|Here's|This is) .*?:?\s*/i, '').trim();
      log(`📝 Context summary generated: "${cleanSummary}"`, sendLog);
      return cleanSummary;
    } else {
      log(`⚠️ Summary too short or empty.`, sendLog);
    }
  } catch (err: any) {
    log(`❌ Failed to generate summary: ${err.message}`, sendLog);
  }
  const fallback = fullDialogueScript.slice(0, 200).replace(/\n/g, ' ');
  log(`📌 Using fallback context: "${fallback}"`, sendLog);
  return `Pitchside News Network discussion about ${fallback}`;
}

// ─── Audio concatenation ──────────────────────────────────────────────────
export async function concatAudioFiles(
  dialogueDir: string,
  outputPath: string,
  sendLog?: (msg: string) => void
): Promise<void> {
  log(`concatAudioFiles: directory=${dialogueDir}, output=${outputPath}`, sendLog);
  const files = await fs.readdir(dialogueDir);
  const wavFiles = files.filter(f => /^[A-Z]+_\d+\.wav$/i.test(f));
  log(`Found ${wavFiles.length} WAV files.`, sendLog);

  wavFiles.sort((a, b) => {
    const numA = parseInt(a.match(/_(\d+)\.wav$/)?.[1] || '0');
    const numB = parseInt(b.match(/_(\d+)\.wav$/)?.[1] || '0');
    return numA - numB;
  });

  if (wavFiles.length === 0) throw new Error('No audio files to concatenate');
  if (wavFiles.length === 1) {
    log(`Only one file, copying directly.`, sendLog);
    await fs.copyFile(path.join(dialogueDir, wavFiles[0]), outputPath);
    return;
  }

  const inputs = wavFiles
    .map(f => `-i "${path.join(dialogueDir, f).replace(/\\/g, '/')}"`)
    .join(' ');
  const filterComplex = wavFiles
    .map((_, i) => `[${i}:a]`)
    .join('') +
    `concat=n=${wavFiles.length}:v=0:a=1[loud];[loud]loudnorm=I=-16:LRA=11:TP=-1.5[out]`;

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const cmd = `ffmpeg ${inputs} -filter_complex "${filterComplex}" -map "[out]" -c:a pcm_s16le "${outputPath}" -y`;
  log(`Executing: ${cmd}`, sendLog);
  await execAsync(cmd);
  log(`✅ Concatenation and normalization complete.`, sendLog);
}
