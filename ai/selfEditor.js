import fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY_1;

export async function proposeCodeImprovement(filePath, feedback) {
  const oldCode = fs.readFileSync(filePath, 'utf-8');
  const prompt = `You are Jarvis's evolution assistant. Review this code and ${feedback}. Only modify functions, keep all security and safety intact. Return complete updated code.`;

  try {
    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'openai/gpt-4',
      messages: [
        { role: 'system', content: 'You are a safe self-modifying AI.' },
        { role: 'user', content: prompt },
        { role: 'user', content: oldCode }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}` }
    });
    const newCode = resp.data.choices[0].message.content;
    fs.writeFileSync(`${filePath}.candidate.js`, newCode);
    try {
      execSync(`node --check ${filePath}.candidate.js`);
      fs.renameSync(`${filePath}.candidate.js`, filePath);
      fs.appendFileSync('logs/self_edits.log', `Code updated for ${filePath} at ${new Date().toISOString()}\n`);
      console.log(`✅ Code updated successfully for ${filePath}`);
    } catch {
      console.log(`❌ Update failed. Keeping previous version.`);
      fs.unlinkSync(`${filePath}.candidate.js`);
    }
  } catch (err) {
    console.error('Code improvement failed:', err?.response?.data || err?.message || err);
  }
}
