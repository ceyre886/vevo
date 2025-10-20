import fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';

function cleanKey(k) { return (k || '').replace(/^\uFEFF/, '').trim(); }
const OPENROUTER_KEY = cleanKey(process.env.OPENROUTER_API_KEY_1);

export async function proposeCodeImprovement(filePath, feedback) {
  if (!OPENROUTER_KEY) {
    const msg = 'No OpenRouter API key provided (OPENROUTER_API_KEY_1). Code improvement skipped.';
    fs.appendFileSync('logs/self_edits.log', `[${new Date().toISOString()}] ${msg}\n`);
    console.warn(msg);
    return;
  }

  const oldCode = fs.readFileSync(filePath, 'utf-8');
  const prompt = `You are Jarvis's evolution assistant. Review this code and ${feedback}. Only modify functions, keep all security and safety intact. Return complete updated code.`;

  try {
    const headers = { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'content-type': 'application/json' };
    fs.appendFileSync('logs/self_edits.log', `[${new Date().toISOString()}] proposeCodeImprovement: sending request to OpenRouter (auth redacted)\n`);

    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'openai/gpt-4',
      messages: [
        { role: 'system', content: 'You are a safe self-modifying AI.' },
        { role: 'user', content: prompt },
        { role: 'user', content: oldCode }
      ]
    }, { headers });

    const newCode = resp.data.choices?.[0]?.message?.content;
    if (!newCode) throw new Error('No content returned from OpenRouter');

    fs.writeFileSync(`${filePath}.candidate.js`, newCode);
    try {
      execSync(`node --check ${filePath}.candidate.js`);
      fs.renameSync(`${filePath}.candidate.js`, filePath);
      fs.appendFileSync('logs/self_edits.log', `Code updated for ${filePath} at ${new Date().toISOString()}\n`);
      console.log(`✅ Code updated successfully for ${filePath}`);
    } catch (e) {
      console.log(`❌ Update failed. Keeping previous version. Reason: ${e.message}`);
      fs.unlinkSync(`${filePath}.candidate.js`);
    }
  } catch (err) {
    const errData = err?.response?.data || err?.message || String(err);
    console.error('Code improvement failed:', errData);
    fs.appendFileSync('logs/self_edits.log', `[${new Date().toISOString()}] Code improvement failed: ${JSON.stringify(errData)}\n`);
  }
}
