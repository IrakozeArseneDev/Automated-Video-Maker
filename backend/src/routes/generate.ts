import { Router } from 'express';
import { generateVoiceSample } from '../services/ttsService.js';
import fs from 'fs/promises';
import path from 'path';  // ✅ missing import added

const router = Router();

router.post('/generate', async (req, res) => {
  const { script, mode } = req.body;
  if (!script || typeof script !== 'string') {
    return res.status(400).json({ error: 'Script is required' });
  }
  if (!['short', 'long'].includes(mode)) {
    return res.status(400).json({ error: 'Mode must be "short" or "long"' });
  }
  return res.status(501).json({ error: 'Use the WebSocket generation endpoint for progress and job execution.' });
});

router.post('/generate-topic', async (req, res) => {
  const { topic, durationMinutes, mode } = req.body;
  if (typeof topic !== 'string' || !topic.trim() || typeof durationMinutes !== 'number' || durationMinutes < 0.5 || durationMinutes > 60 || !['short', 'long'].includes(mode)) {
    return res.status(400).json({ error: 'Topic and duration are required' });
  }
  const targetWords = Math.max(50, durationMinutes * 150);
  const prompt = `Write a highly engaging YouTube ${mode === 'short' ? 'Shorts' : 'long-form'} voiceover script about "${topic}".

Target length: approximately ${targetWords} words.

PRIMARY GOAL:
Maximize viewer retention, watch time, curiosity, and emotional engagement.

IMPORTANT RULES:
- Write ONLY the words that will be spoken.
- Do NOT include titles, headings, scene directions, camera instructions, editing notes, timestamps, emojis, bullet points, or any formatting.
- Do NOT use parentheses, brackets, or any production instructions.
- Output must be plain text for text-to-speech narration.

HARD HOOK RULE (VERY IMPORTANT):
- The FIRST sentence must instantly grab attention (within 1–2 seconds).
- It MUST NOT be generic or introductory.
- Do NOT start with:
  "When it comes to..."
  "Today we're talking about..."
  "Let's talk about..."
  "Did you know..."
  "In this video..."
  "There are..."
  "For years..."
  "Many people..."
- Instead, start with something that creates shock, curiosity, contradiction, urgency, or disbelief.

GOOD HOOK EXAMPLES:
- "You're more likely to be struck by lightning than this happening."
- "This sounds impossible, but it's real."
- "Nobody expected this to be true."
- "Everything you know about ${topic} might be wrong."
- "This changes how you see ${topic} forever."

RETENTION RULES (VERY IMPORTANT):
- Every sentence must either:
  1) increase curiosity, or
  2) deliver value, or
  3) create suspense
- Avoid filler, repetition, or explanations that resolve too early.
- Reveal information gradually (don't explain everything at once).
- Use curiosity gaps constantly (make the viewer want the next sentence).
- Keep momentum high throughout the script.

STYLE:
- Natural, conversational, human-like storytelling.
- Simple language, easy to understand.
- Short, punchy sentences mixed with slightly longer ones for rhythm.
- Sound like a compelling story, not a lecture or article.
- Emotionally engaging (surprise, curiosity, amazement, urgency when appropriate).

YOUTUBE SHORTS SPECIFIC RULES:
- The first sentence is the most important part of the entire script.
- No slow introductions or context-building at the start.
- Hook first, explain later.
- Keep escalating curiosity every few seconds.

END RULE:
- End with a strong, memorable final thought that feels complete but slightly thought-provoking.

Return ONLY the final voiceover script.`;

  try {
    if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'GROQ_API_KEY is not configured' });
    const Groq = (await import('groq-sdk')).default;
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_tokens: Math.ceil(targetWords * 1.5),
    });
    const generatedScript = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ script: generatedScript });
  } catch (error) {
    console.error('Groq script generation error:', error);
    res.status(500).json({ error: 'Failed to generate script' });
  }
});

router.post('/test-voice', async (req, res) => {
  const { text, voiceId, speed } = req.body;
  if (!text) return res.status(400).json({ error: 'Text is required' });
  if (!voiceId) return res.status(400).json({ error: 'voiceId is required' });
  try {
    const audioPath = await generateVoiceSample(text, voiceId, speed || 1.0);
    // Ensure file exists before sending
    await fs.access(audioPath);
    res.setHeader('Content-Type', 'audio/wav');
    res.sendFile(audioPath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to send audio' });
      }
      // Delete file after 5 seconds (allow time for transmission)
      setTimeout(() => fs.unlink(audioPath).catch(console.error), 5000);
    });
  } catch (error) {
    console.error('Voice generation failed:', error);
    res.status(500).json({ error: 'Voice generation failed: ' + (error instanceof Error ? error.message : 'unknown') });
  }
});

router.get('/voices', async (req, res) => {
  const modelsDir = path.join(process.cwd(), 'models');
  try {
    const files = await fs.readdir(modelsDir);
    const voiceFiles = files.filter(f => f.endsWith('.onnx') && !f.includes('json'));
    const voices = voiceFiles.map(file => {
      // Extract name from filename: en_US-ryan-high.onnx -> Ryan (High)
      let name = file.replace('.onnx', '').replace(/en_US-/g, '').replace(/-/g, ' ');
      // Capitalize first letter of each word
      name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return {
        id: file.replace('.onnx', ''),
        name: name,
        gender: name.toLowerCase().includes('amy') || name.toLowerCase().includes('hfc') ? 'female' : 'male',
        description: `Piper voice - ${name}`
      };
    });
    res.json({ voices });
  } catch (err) {
    console.error('Failed to list voices:', err);
    res.status(500).json({ error: 'Could not list voices' });
  }
});

export default router;
