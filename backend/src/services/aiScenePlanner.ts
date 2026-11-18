import Groq from 'groq-sdk';
import fs from 'fs/promises';
import path from 'path';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface PlannedScene {
  text: string;
  imagePrompts: string[];
}

// ── Logging helper ──────────────────────────────────────────
function log(message: string, ...args: any[]) {
  console.log(`[aiScenePlanner] ${message}`, ...args);
}

function splitScriptIntoChunks(script: string, maxChunkSize = 2000): string[] {
  log(`splitScriptIntoChunks: script length ${script.length}, maxChunkSize ${maxChunkSize}`);
  const chunks: string[] = [];
  let remaining = script;
  let chunkCount = 0;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxChunkSize);
    const lastPeriod = chunk.lastIndexOf('. ');
    if (lastPeriod > maxChunkSize * 0.8 && remaining.length > maxChunkSize) {
      chunk = remaining.slice(0, lastPeriod + 2);
    }
    chunks.push(chunk);
    chunkCount++;
    log(`  Chunk ${chunkCount}: ${chunk.length} chars, preview: "${chunk.substring(0, 50)}..."`);
    remaining = remaining.slice(chunk.length);
  }
  log(`  Total chunks: ${chunks.length}`);
  return chunks;
}

export async function planFullScript(
  script: string
): Promise<{ title: string; scenes: PlannedScene[] }> {
  log(`🚀 planFullScript called: script length ${script.length}`);
  log(`  Script preview: "${script.substring(0, 200)}..."`);

  const chunks = splitScriptIntoChunks(script);
  console.log(`📄 Script split into ${chunks.length} chunk(s) for AI processing.`);

  let allScenes: PlannedScene[] = [];
  let globalTitle = '';
  const allRawResponses: string[] = [];

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    log(`\n📦 Processing chunk ${chunkIdx + 1}/${chunks.length} (${chunk.length} chars)`);
    log(`  Chunk preview: "${chunk.substring(0, 100)}..."`);

    const prompt = `
You are a professional sports photo editor for PITCHSIDE NEWS NETWORK.

Your ONLY task is to convert a football script into REAL, SPECIFIC image search queries that a human would type into Google Images.

━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES – MUST FOLLOW

1. **EVERY query MUST contain at least one of these specific entities** (if mentioned in the script):
   - A real player's FULL name (e.g., "Vinícius Júnior", "Harry Kane")
   - A real team's FULL name (e.g., "Manchester City", "Paris Saint-Germain")
   - A specific competition or venue (e.g., "UEFA Champions League", "Wembley Stadium")

2. **If the script mentions a player, ALWAYS include that player's name in at least one query.**

3. **NEVER use generic, abstract, or vague terms** such as:
   - football action, match action, game action
   - exciting moment, intense scene
   - possession, pressure, momentum
   - stadium, fans, crowd (unless combined with a specific team/player)

4. **Each query MUST describe a VISUAL moment** that can be photographed – e.g., "Vinícius Júnior celebrating goal", "Harry Kane lifting trophy", "Manchester City team huddle".

5. **Queries should be 6–16 words** and read like a real search phrase.

6. **Output EXACTLY 2–3 queries per scene.** No more, no less.

━━━━━━━━━━━━━━━━━━━━━━
GOOD EXAMPLES (specific, searchable):

✔ "Erling Haaland scoring header Manchester City Premier League"
✔ "Lamine Yamal dribbling past defender Barcelona La Liga"
✔ "Harry Kane lifting Bundesliga trophy Bayern Munich"
✔ "Brazil national team lineup World Cup 2026"
✔ "Anfield crowd cheering Liverpool Champions League"

BAD EXAMPLES (generic, useless):

❌ "football match action"
❌ "stadium crowd"
❌ "exciting moment"
❌ "players in action"
❌ "fans celebrating"

━━━━━━━━━━━━━━━━━━━━━━
TITLE RULE: Generate a short, descriptive title (max 5 words) that reflects the main topic of the script. Do not force a club name.

━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT – STRICT JSON ONLY:

{
  "title": "your title here",
  "scenes": [
    {
      "text": "short description from script",
      "imagePrompts": ["query1", "query2", "query3"]
    }
  ]
}

Now process the following script chunk (part ${chunkIdx + 1} of ${chunks.length}):

Script chunk:
"""
${chunk}
"""

ONLY output valid JSON. Do NOT include any extra text or commentary.
`;

    log(`  🤖 Calling Groq API for chunk ${chunkIdx+1} (model: llama-3.1-8b-instant, max_tokens: 2000)`);
    let result: any = null;
    let rawContent = '';
    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });
      rawContent = completion.choices[0]?.message?.content || '{"title":"","scenes":[]}';
      allRawResponses.push(rawContent);
      log(`  ✅ API response received (${rawContent.length} chars)`);
      log(`  Response preview: "${rawContent.substring(0, 200)}..."`);
      result = JSON.parse(rawContent);
      log(`  ✅ JSON parsed successfully.`);
    } catch (err: any) {
      log(`  ❌ Error during API call or parsing: ${err.message}`);
      console.error(`Error in chunk ${chunkIdx+1}:`, err);
      result = { title: '', scenes: [] };
      if (rawContent) {
        log(`  Raw content: "${rawContent}"`);
      }
    }

    if (result && result.title && !globalTitle) {
      globalTitle = result.title;
      log(`  📌 Global title set: "${globalTitle}"`);
    }
    const sceneCount = result?.scenes?.length || 0;
    log(`  📦 Received ${sceneCount} scenes from chunk ${chunkIdx+1}`);
    if (sceneCount > 0) {
      log(`  First scene text: "${result.scenes[0]?.text?.substring(0, 60)}..."`);
    }

    allScenes = allScenes.concat(result.scenes || []);
    log(`  Cumulative scenes: ${allScenes.length}`);
  }

  // Sanitization
  log(`\n🧹 Sanitizing ${allScenes.length} scenes...`);
  let totalPromptsBefore = 0;
  let totalPromptsAfter = 0;
  for (const scene of allScenes) {
    if (scene.imagePrompts) {
      totalPromptsBefore += scene.imagePrompts.length;
      scene.imagePrompts = scene.imagePrompts
        .filter((p) => typeof p === 'string' && p.trim().length > 0)
        .filter((p, idx, self) => self.indexOf(p) === idx)
        .slice(0, 3);
      totalPromptsAfter += scene.imagePrompts.length;
    }
  }
  log(`  Before sanitization: ${totalPromptsBefore} prompts, after: ${totalPromptsAfter}`);

  // Save debug info to a file
  const debugDir = path.join(process.cwd(), 'logs');
  await fs.mkdir(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `scene_planning_${timestamp}.json`;
  const filePath = path.join(debugDir, filename);
  const debugData = {
    timestamp,
    scriptLength: script.length,
    chunks: chunks.length,
    title: globalTitle || 'Pitchside News Network',
    scenes: allScenes,
    rawResponses: allRawResponses,
  };
  await fs.writeFile(filePath, JSON.stringify(debugData, null, 2), 'utf-8');
  log(`💾 Debug data saved to ${filePath}`);

  console.log('\n🤖 AI Scene Planner Output:');
  console.log(`📌 Title: "${globalTitle}"`);
  console.log(`📌 Scenes: ${allScenes.length}`);

  allScenes.forEach((scene: PlannedScene, idx: number) => {
    console.log(`\n   Scene ${idx + 1}:`);
    console.log(`      Text: ${scene.text.substring(0, 100)}${scene.text.length > 100 ? '...' : ''}`);
    console.log(`      Image Prompts: ${scene.imagePrompts.join(', ')}`);
  });
  console.log('');

  const finalTitle = globalTitle || 'Pitchside News Network';
  log(`✅ Returning ${allScenes.length} scenes with title "${finalTitle}"`);

  return {
    title: finalTitle,
    scenes: allScenes,
  };
}