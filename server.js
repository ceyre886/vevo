
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
const __dirname = path.resolve();
// Error logging utility
const LOG_DIR = path.join(__dirname, 'logs');
const ERROR_LOG = path.join(LOG_DIR, 'errors.log');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}
function logError(error, context = '') {
    const logEntry = `[${new Date().toISOString()}] ${context}\n${error.stack || error}\n\n`;
    fs.appendFileSync(ERROR_LOG, logEntry);
    console.error('ERROR:', context, error);
}

import { compute } from './ai/mathCore.js';
import { reviewAndLearn } from './ai/selfLearning.js';
import { proposeCodeImprovement } from './ai/selfEditor.js';


const app = express();
const port = process.env.PORT || 8080;

// --- Automated Memory Review & Learning ---
async function autoReviewAndLearn() {
    try {
        console.log('🔄 Running scheduled memory review and learning...');
        const result = await reviewAndLearn();
        fs.appendFileSync(path.join(LOG_DIR, 'learning.log'), `[${new Date().toISOString()}] Auto-learning cycle result: ${JSON.stringify(result)}\n`);
    } catch (err) {
        fs.appendFileSync(path.join(LOG_DIR, 'learning.log'), `[${new Date().toISOString()}] Auto-learning cycle error: ${err?.message || err}\n`);
    }
}
setInterval(autoReviewAndLearn, 60 * 60 * 1000); // run every hour, 24/7
autoReviewAndLearn(); // run immediately on startup

// Manual trigger endpoint for review/learning
app.post('/api/review-learn', async (req, res) => {
    try {
        const result = await reviewAndLearn();
        res.json({ success: true, result });
    } catch (err) {
        logError(err, 'Review and Learn failure');
        res.status(500).json({ success: false, error: err?.message || err });
    }
});

// Manual trigger endpoint for safe self-editing (guardrails enforced)
app.post('/api/self-edit', async (req, res) => {
    const { filePath, feedback } = req.body;
    // Guardrails: block critical files
    if (!filePath || filePath.includes('server.js') || filePath.includes('.env') || filePath.includes('/core')) {
        return res.status(403).json({ success: false, error: 'Editing critical files is not allowed.' });
    }
    try {
        await proposeCodeImprovement(filePath, feedback);
        res.json({ success: true });
    } catch (err) {
        logError(err, 'Self-edit failure');
        res.status(500).json({ success: false, error: err?.message || err });
    }
});

app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));


let vevoMemory = { personality: 'friendly', learnedResponses: [] };
const memoryFile = path.join(__dirname, 'vevoMemory.json');
if (fs.existsSync(memoryFile)) {
    vevoMemory = { ...vevoMemory, ...JSON.parse(fs.readFileSync(memoryFile, 'utf-8')) };
}
function saveMemory() { fs.writeFileSync(memoryFile, JSON.stringify(vevoMemory, null, 2)); }


// Use only the one valid OpenRouter key
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY_1;

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    // Multi-AI and live data querying logic
    let sources = [];
    let aiResponses = [];
    let reasoningTrace = [];
    let memoryUpdate = false;
    let confidence = 0.7;
    let errors = [];

    // Math/logic reasoning (CASIO-style)
    let mathResult = null;
    if (/^[\d\s\+\-\*\/\(\)\.]+$/.test(message.trim())) {
      mathResult = compute(message.trim());
      if (mathResult !== null) {
        aiResponses.push(`Math result: ${mathResult}`);
        sources.push('mathCore');
        reasoningTrace.push('Used mathCore for computation');
      }
    }

    // Sanitizer: remove vendor-identifying phrases and stringify objects
    function sanitizeReply(raw) {
        if (raw === null || raw === undefined) return null;
        if (typeof raw === 'object') {
            try { raw = JSON.stringify(raw); } catch { raw = String(raw); }
        }
        let s = String(raw);
        // Strip common vendor/model identity phrases and any accidental key leaks
        s = s.replace(/As an? language model[^.]*\.?/gi, '');
        s = s.replace(/I am an? AI developed by [^.]*(\.|$)/gi, '');
        s = s.replace(/As an AI[^.]*(\.|$)/gi, '');
        s = s.replace(/I don't have the capability to[^.]*(\.|$)/gi, '');
        s = s.replace(/\[object Object\]/gi, '[object]');
        // Remove obvious vendor names that should not be exposed
        s = s.replace(/OpenAI/gi, '');
        s = s.replace(/openrouter\.ai/gi, '');
        s = s.replace(/HuggingFace/gi, '');
        s = s.replace(/xAI/gi, '');
        s = s.replace(/Google( AI)?/gi, '');
        // redact anything that looks like API keys
        s = s.replace(/(sk-|api_|key=)[A-Za-z0-9-_]{16,}/gi, '[REDACTED]');
        return s.trim();
    }

    // Central Jarvis persona/system prompt used for all LLM calls
    function getJarvisSystemPrompt() {
        return `You are Jarvis, an independent assistant with deep domain knowledge. Always speak as Jarvis (do not reveal or mention vendor names, 'OpenAI', 'GPT', or your providers). Use a confident but humble tone, provide concise reasoning steps when asked, include provenance when you used external sources, and never say you are "an AI developed by" another organization. When you cannot answer, ask clarifying questions or offer to queue for learning.`;
    }

    // Query OpenRouter (GPT-4) with robust error handling and automatic backup key retry
    // Generic key fallback system for any service
    async function tryKeys(keys, requestFn, contextLabel = 'AI Service') {
        for (let i = 0; i < keys.length; i++) {
            try {
                const result = await requestFn(keys[i], i);
                if (result && !result.error) {
                    reasoningTrace.push(`Used ${contextLabel} key ${i+1}`);
                    return result;
                }
            } catch (e) {
                logError(e, `${contextLabel} API failure (key ${i+1})`);
                errors.push({
                    source: contextLabel,
                    key: `KEY_${i+1}`,
                    key_value: keys[i],
                    message: e.message,
                    status: e.response?.status,
                    data: e.response?.data
                });
                reasoningTrace.push(`${contextLabel} error (key ${i+1}): ` + (e?.response?.data?.error || e?.message || 'Unknown error'));
                if (e.response?.status !== 401 && e.response?.status !== 403) break;
            }
        }
        return null;
    }

    // Clean up keys: remove BOM, invisible chars, trim
    function cleanKey(k) {
        return (k || '').replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
    }

    // Query OpenRouter (GPT-4) using generic key fallback
    async function queryOpenRouter(msg) {
        const keys = [process.env.OPENROUTER_API_KEY_1, process.env.OPENROUTER_API_KEY_2]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
            // conservative retry loop: query up to 2 times if vendor-like phrases are present
            let attempts = 0;
            let content = null;
            while (attempts < 2) {
                const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                    model: 'openai/gpt-4',
                    messages: [
                        { role: 'system', content: getJarvisSystemPrompt() },
                        { role: 'user', content: msg }
                    ]
                }, { headers });
                const raw = resp.data.choices?.[0]?.message?.content || '';
                const cleaned = sanitizeReply(raw);
                // if cleaned still contains vendor-identifying traces, retry with stricter instruction
                if (/OpenAI|openrouter|HuggingFace|xAI|Google/i.test(raw) || /I am an? AI/i.test(raw)) {
                    attempts++;
                    logError({ note: `Vendor mentions detected; retrying attempt ${attempts}` }, `OpenRouter vendor-scan`);
                    // on retry, prepend explicit instruction
                    msg = `Please reply strictly as Jarvis and do not include any provider or vendor names. ${msg}`;
                    continue;
                }
                content = cleaned;
                // redact headers for logging
                const redacted = { ...headers, authorization: headers.authorization ? 'Bearer [REDACTED]' : undefined };
                logError({ request: { headers: redacted, body: msg }, response: resp.data }, `OpenRouter API success (key ${idx+1})`);
                sources.push('OpenRouter');
                return { content };
            }
            // If retries didn't produce a clean response, return last cleaned content or null
            return { content };
        }, 'OpenRouter');
    }

    // Query Hugging Face using generic key fallback
    async function queryHuggingFace(msg) {
        const keys = [process.env.HF_API_KEY_1, process.env.HF_API_KEY_2, process.env.HF_API_KEY_3]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
            const resp = await axios.post('https://api-inference.huggingface.co/models/gpt2', {
                inputs: msg
            }, { headers });
            const redacted = { ...headers, authorization: headers.authorization ? 'Bearer [REDACTED]' : undefined };
            logError({ request: { headers: redacted, body: msg }, response: resp.data }, `HuggingFace API success (key ${idx+1})`);
            sources.push('HuggingFace');
            return { content: resp.data[0]?.generated_text || null };
        }, 'HuggingFace');
    }

    // Query Google AI Studio using generic key fallback
    async function queryGoogleAI(msg) {
        const keys = [process.env.GOOGLE_API_KEY_1, process.env.GOOGLE_API_KEY_2, process.env.GOOGLE_API_KEY_3]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const resp = await axios.post(`https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText?key=${key}`,
                { prompt: { text: `${getJarvisSystemPrompt()}\nUser: ${msg}` } },
                { headers: { 'content-type': 'application/json' } }
            );
            logError({ request: { key: '[REDACTED]', body: msg }, response: resp.data }, `Google AI Studio API success (key ${idx+1})`);
            sources.push('GoogleAI');
            return { content: resp.data.candidates?.[0]?.output || null };
        }, 'GoogleAI');
    }

    // Query xAI Grok using generic key fallback
    async function queryXAI(msg) {
        const keys = [process.env.XAI_API_KEY_1, process.env.XAI_API_KEY_2, process.env.XAI_API_KEY_3]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
            const resp = await axios.post('https://api.x.ai/v1/chat/completions', {
                model: 'grok-1',
                messages: [
                    { role: 'system', content: getJarvisSystemPrompt() },
                    { role: 'user', content: msg }
                ]
            }, { headers });
            const redacted = { ...headers, authorization: headers.authorization ? 'Bearer [REDACTED]' : undefined };
            logError({ request: { headers: redacted, body: msg }, response: resp.data }, `xAI Grok API success (key ${idx+1})`);
            sources.push('xAI');
            return { content: resp.data.choices?.[0]?.message?.content || null };
        }, 'xAI');
    }

    // Query Polygon using generic key fallback
    async function queryPolygon() {
        const keys = [process.env.POLYGON_API_KEY_1, process.env.POLYGON_API_KEY_2]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const resp = await axios.get(`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?adjusted=true&apiKey=${key}`);
            logError({ request: { key }, response: resp.data }, `Polygon API success (key ${idx+1})`);
            sources.push('Polygon');
            return { content: JSON.stringify(resp.data) };
        }, 'Polygon');
    }

    // Query Alpaca using generic key fallback
    async function queryAlpaca() {
        const keys = [process.env.ALPACA_API_KEY_1]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const headers = { 'APCA-API-KEY-ID': key };
            const resp = await axios.get('https://paper-api.alpaca.markets/v2/account', { headers });
            logError({ request: { headers }, response: resp.data }, `Alpaca API success (key ${idx+1})`);
            sources.push('Alpaca');
            return { content: JSON.stringify(resp.data) };
        }, 'Alpaca');
    }

    // Query all sources in parallel
    const [openRouterResp] = await Promise.all([
        queryOpenRouter(message)
    ]);
    if (openRouterResp && openRouterResp.content) {
        aiResponses.push(sanitizeReply(openRouterResp.content));
    }

    // Synthesize and cross-reference answers
    // sanitize all responses before joining
    let reply = aiResponses.filter(Boolean).map(sanitizeReply).join(' | ');
    let isFallback = false;
    // Detect fallback/low-confidence answers
    if (!reply || /As a language AI model|I am an AI developed by OpenAI|I can't/.test(reply)) {
        isFallback = true;
        reply = "I don't have a high-confidence answer yet. Would you like me to (A) clarify, (B) ask external sources, or (C) queue this for learning and return later?";
        confidence = 0.2;
        reasoningTrace.push('Unknown flow triggered: fallback or low-confidence answer.');
        // Queue for learning
        const queueFile = path.join(__dirname, 'learningQueue.json');
        let learningQueue = [];
        if (fs.existsSync(queueFile)) {
            try { learningQueue = JSON.parse(fs.readFileSync(queueFile, 'utf-8')); } catch {}
        }
        learningQueue.push({
            id: Date.now(),
            message,
            sources,
            errors,
            timestamp: new Date().toISOString(),
            status: 'queued'
        });
        fs.writeFileSync(queueFile, JSON.stringify(learningQueue, null, 2));
    } else {
        confidence = aiResponses.length ? 0.8 + 0.1 * aiResponses.length : 0.5;
        reasoningTrace.push('Synthesized from: ' + sources.join(', '));
    }

    // Memory update
    vevoMemory.learnedResponses.push({ id: Date.now(), taskType: 'chat', payload: message, response: reply, confidence, sources, isFallback });
    saveMemory();
    memoryUpdate = true;

    // Output structured JSON with errors and fallback info
    res.json({
        reply,
        sources,
        reasoning_summary: reasoningTrace.join(' | '),
        confidence,
        memory_update: memoryUpdate,
        errors,
        isFallback
    });
    });

    // Placeholder for neural and symbolic reasoning modules
    const reasoningModule = {
        initialized: true,
        type: 'neural+symbolic',
        status: 'ready'
    };

    // Placeholder for calculator, diagram, and adaptive learning
    function gapFill(input) { return `Gap-filled: ${input}`; }
    function calculator(expr) { try { return eval(expr); } catch { return 'Error'; } }
    function diagram(desc) { return `Diagram for: ${desc}`; }
    function adaptiveLearn(data) { vevoMemory.learnedResponses.push({ id: Date.now(), taskType: 'adaptive', payload: data }); saveMemory(); return 'Learned.'; }

    // /api/system-status endpoint
// /api/learning-status endpoint
app.get('/api/learning-status', (req, res) => {
    let learningPlan = null;
    try {
        learningPlan = fs.existsSync(path.join(__dirname, 'learningPlan.json'))
            ? JSON.parse(fs.readFileSync(path.join(__dirname, 'learningPlan.json'), 'utf-8'))
            : null;
    } catch (err) {
        learningPlan = { error: 'Failed to read learningPlan.json', details: err?.message || err };
    }
    let logContent = '';
    try {
        logContent = fs.existsSync(path.join(LOG_DIR, 'learning.log'))
            ? fs.readFileSync(path.join(LOG_DIR, 'learning.log'), 'utf-8').split('\n').slice(-10).join('\n')
            : '';
    } catch {}
    res.json({
        learningPlan,
        recentLogs: logContent
    });
});
    app.get('/api/system-status', (req, res) => {
        res.json({
            status: 'operational',
            reasoning: reasoningModule,
            memory: vevoMemory.learnedResponses.length,
            time: new Date().toISOString()
        });
    });

    // /api/test-keys endpoint
    app.get('/api/test-keys', async (req, res) => {
    // Echo the exact key and headers sent to OpenRouter
    function cleanKey(k) {
        return (k || '').replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
    }
    const keys = [process.env.OPENROUTER_API_KEY_1, process.env.OPENROUTER_API_KEY_2]
        .map(cleanKey)
        .filter(Boolean);
    let results = { openRouter: [], headersSent: [], errors: [] };
    for (let i = 0; i < keys.length; i++) {
        const headers = { 'authorization': `Bearer ${keys[i]}`, 'content-type': 'application/json' };
        try {
            const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: 'Test key' }]
            }, {
                headers
            });
            results.openRouter.push(keys[i]);
            results.headersSent.push(headers);
        } catch (e) {
            logError(e, `Invalid OpenRouter key: ${keys[i]}`);
            results.errors.push({
                key: keys[i],
                headers,
                message: e.message,
                status: e.response?.status,
                data: e.response?.data
            });
        }
    }
    res.json(results);
    });

// /api/test-persona endpoint - returns a sample response using Jarvis persona
app.get('/api/test-persona', async (req, res) => {
    try {
        const prompt = 'Provide a short 2-3 sentence answer introducing yourself.';
        // Use internal prompt generator
        const jarvisPrompt = `${getJarvisSystemPrompt()}\nUser: ${prompt}`;
        // If OpenRouter key available, call it; otherwise synthesize a local Jarvis response
        const key = (process.env.OPENROUTER_API_KEY_1 || '').replace(/^\uFEFF/, '').trim();
        if (!key) {
            // Local synthetic response that follows persona constraints
            const local = `I am Jarvis — a practical, inquisitive assistant. I focus on providing clear, evidence-based answers and will ask clarifying questions when needed.`;
            return res.json({ persona: 'jarvis', sample: local });
        }
        // Otherwise forward to OpenRouter safely
        const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
        const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'openai/gpt-4',
            messages: [
                { role: 'system', content: getJarvisSystemPrompt() },
                { role: 'user', content: prompt }
            ]
        }, { headers });
        const content = resp.data.choices?.[0]?.message?.content || '';
        res.json({ persona: 'jarvis', sample: sanitizeReply(content) });
    } catch (err) {
        logError(err, 'Persona test failure');
        res.status(500).json({ error: err?.message || String(err) });
    }
});

    // /api/upgrade endpoint
    app.post('/api/upgrade', (req, res) => {
        // Simulate upgrade logic
        reasoningModule.status = 'upgraded';
        res.json({ upgraded: true, status: reasoningModule.status });
    });

    // Example endpoints for gap-filling, calculator, diagram, adaptive learning
    app.post('/api/gap-fill', (req, res) => {
        const { input } = req.body;
        res.json({ result: gapFill(input) });
    });

    app.post('/api/calculate', (req, res) => {
        const { expr } = req.body;
        res.json({ result: calculator(expr) });
    });

    app.post('/api/diagram', (req, res) => {
        const { desc } = req.body;
        res.json({ result: diagram(desc) });
    });

    app.post('/api/adaptive-learn', (req, res) => {
        const { data } = req.body;
        res.json({ result: adaptiveLearn(data) });
    });



// Move static handler below all API routes
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, () => {
    console.log(`VevoAI running at http://localhost:${port}`);
    console.log('Server startup complete.');
});
// Error handlers for diagnostics
process.on('uncaughtException', (err) => {
    logError(err, 'Uncaught Exception');
});
process.on('unhandledRejection', (reason, promise) => {
    logError(reason instanceof Error ? reason : new Error(String(reason)), 'Unhandled Rejection');
});

process.on('SIGINT', () => {
    saveMemory();
    process.exit(0);
});
