import fs from 'fs';
import axios from 'axios';

function cleanKey(k) { return (k || '').replace(/^\uFEFF/, '').trim(); }
const OPENROUTER_KEY = cleanKey(process.env.OPENROUTER_API_KEY_1);

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
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review: sending request to OpenRouter with headers: ${JSON.stringify({ authorization: 'Bearer ***REDACTED***', 'content-type': headers['content-type'] })}\n`);

    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'openai/gpt-4',
      messages: [
        { role: 'system', content: summaryPrompt },
        { role: 'user', content: JSON.stringify(memory) }
      ]
    }, { headers });

    // Log success (summary only)
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review success: status ${resp.status}\n`);

    let learnPlan = null;
    let rawContent = resp.data.choices?.[0]?.message?.content || '';
    try {
      learnPlan = JSON.parse(rawContent);
    } catch (jsonErr) {
      // If not valid JSON, save raw content for debugging
      learnPlan = { error: 'Malformed JSON', rawContent };
    }
    fs.writeFileSync('learningPlan.json', JSON.stringify(learnPlan, null, 2));
    // Log learning attempt
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning plan saved: ${JSON.stringify(Object.keys(learnPlan).slice(0,10))}\n`);
    return learnPlan;
  } catch (err) {
    // Log error with more readable output
    const errData = err?.response?.data || err?.message || String(err);
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review failed: ${JSON.stringify(errData)}\n`);
    console.error('Learning review failed:', errData);
    return { error: errData };
  }
}
