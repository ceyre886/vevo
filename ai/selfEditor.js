import fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';

function cleanKey(k) { return (k || '').replace(/^\uFEFF/, '').trim(); }
const OPENROUTER_KEY = cleanKey(process.env.OPENROUTER_API_KEY_1);

function getJarvisSystemPrompt() {
  return `You are Jarvis, an independent assistant. When proposing code edits, speak as Jarvis and never reference provider names or that you are a model. Provide concise rationale for changes and keep security constraints intact.`;
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

export async function proposeCodeImprovement(filePath, feedback) {
  if (!OPENROUTER_KEY) {
    const msg = 'No OpenRouter API key provided (OPENROUTER_API_KEY_1). Code improvement skipped.';
    fs.appendFileSync('logs/self_edits.log', `[${new Date().toISOString()}] ${msg}\n`);
    console.warn(msg);
    return;
  }

  const oldCode = fs.readFileSync(filePath, 'utf-8');
  const prompt = `Review the following code and ${feedback}. Only modify code where necessary, keep security checks, and return the updated file content. Provide a one-paragraph justification.`;

  try {
    const headers = { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'content-type': 'application/json' };
    fs.appendFileSync('logs/self_edits.log', `[${new Date().toISOString()}] proposeCodeImprovement: sending request to OpenRouter (auth redacted)\n`);

    let attempts = 0;
    let newCode = null;
    while (attempts < 3) {
      const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'openai/gpt-4',
        messages: [
          { role: 'system', content: getJarvisSystemPrompt() },
          { role: 'user', content: prompt },
          { role: 'user', content: oldCode }
        ]
      }, { headers });

      newCode = resp.data.choices?.[0]?.message?.content || '';
      const cleaned = sanitizeContent(newCode);
      if (/OpenAI|openrouter|HuggingFace|xAI|Google/i.test(newCode) || /I am an? AI/i.test(newCode)) {
        attempts++;
        fs.appendFileSync('logs/self_edits.log', `[${new Date().toISOString()}] proposeCodeImprovement attempt ${attempts} contained vendor mentions; retrying\n`);
        continue;
      }
      newCode = cleaned;
      break;
    }

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
