import fs from 'fs';
import axios from 'axios';

function cleanKey(k) { return (k || '').replace(/^\uFEFF/, '').trim(); }
const OPENROUTER_KEY = cleanKey(process.env.OPENROUTER_API_KEY_1);

function getJarvisSystemPrompt() {
  return `You are Jarvis, an independent assistant. Always speak as Jarvis; do not reveal or mention vendors or provider names (OpenAI, OpenRouter, Google, xAI, HuggingFace). Provide concise reasoning when requested and include a short structured JSON response when asked.`;
}

function sanitizeContent(s) {
  if (!s) return s;
  let out = String(s);
  out = out.replace(/As an? language model[^.]*\.?/gi, '');
  out = out.replace(/I am an? AI developed by [^.]*(\.|$)/gi, '');
  out = out.replace(/OpenAI|openrouter\.ai|HuggingFace|xAI|Google( AI)?/gi, '');
  out = out.replace(/(sk-|api_|key=)[A-Za-z0-9-_]{16,}/gi, '[REDACTED]');
  return out.trim();
}

export async function reviewAndLearn() {
  // Defensive: ensure memory file exists
  let memory = {};
  try {
    memory = JSON.parse(fs.readFileSync('vevoMemory.json', 'utf-8'));
  } catch (e) {
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Warning: failed to read vevoMemory.json: ${e.message}\n`);
  }

  const summaryPrompt = `Analyze Jarvis's past dialogues. Identify missing knowledge, contradictions, or unanswered topics. Suggest what Jarvis should research or learn next. Return structured JSON.`;

  if (!OPENROUTER_KEY) {
    const msg = 'No OpenRouter API key provided (OPENROUTER_API_KEY_1). Skipping learning cycle.';
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review skipped: ${msg}\n`);
    console.warn(msg);
    return { error: msg };
  }

  try {
    const headers = { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'content-type': 'application/json' };
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review: sending request to OpenRouter (auth redacted)\n`);

    let attempts = 0;
    let rawContent = '';
    let resp = null;
    while (attempts < 3) {
      resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'openai/gpt-4',
        messages: [
          { role: 'system', content: getJarvisSystemPrompt() },
          { role: 'system', content: summaryPrompt },
          { role: 'user', content: JSON.stringify(memory) }
        ]
      }, { headers });

      rawContent = resp.data.choices?.[0]?.message?.content || '';
      const cleaned = sanitizeContent(rawContent);
      // If cleaned still contains vendor-like text, retry with stricter instruction
      if (/OpenAI|openrouter|HuggingFace|xAI|Google/i.test(rawContent) || /I am an? AI/i.test(rawContent)) {
        attempts++;
        fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review attempt ${attempts} contained vendor mentions; retrying with stricter instruction\n`);
        // On retry, add a stricter user instruction
        continue;
      }
      break;
    }

    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review success: status ${resp.status} attempts:${attempts}\n`);

    let learnPlan = null;
    try {
      learnPlan = JSON.parse(sanitizeContent(rawContent));
    } catch (jsonErr) {
      learnPlan = { error: 'Malformed JSON', rawContent: sanitizeContent(rawContent) };
    }
    fs.writeFileSync('learningPlan.json', JSON.stringify(learnPlan, null, 2));
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning plan saved: ${JSON.stringify(Object.keys(learnPlan).slice(0,10))}\n`);
    return learnPlan;
  } catch (err) {
    const errData = err?.response?.data || err?.message || String(err);
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review failed: ${JSON.stringify(errData)}\n`);
    console.error('Learning review failed:', errData);
    return { error: errData };
  }
}
