import fs from 'fs';
import axios from 'axios';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY_1;

export async function reviewAndLearn() {
  const memory = JSON.parse(fs.readFileSync('vevoMemory.json', 'utf-8'));
  const summaryPrompt = `Analyze Jarvis's past dialogues. Identify missing knowledge, contradictions, or unanswered topics. Suggest what Jarvis should research or learn next. Return structured JSON.`;

  try {
    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'openai/gpt-4',
      messages: [
        { role: 'system', content: summaryPrompt },
        { role: 'user', content: JSON.stringify(memory) }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}` }
    });
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
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning plan: ${JSON.stringify(learnPlan)}\n`);
    return learnPlan;
  } catch (err) {
    // Log error
    fs.appendFileSync('logs/learning.log', `[${new Date().toISOString()}] Learning review failed: ${err?.response?.data || err?.message || err}\n`);
    console.error('Learning review failed:', err?.response?.data || err?.message || err);
    return null;
  }
}
