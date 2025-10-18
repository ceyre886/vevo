
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
const port = process[REDACTED_FILENAME].PORT || 8080;

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
    if (!filePath || filePath.includes('server.js') || filePath.includes('[REDACTED_FILENAME]') || filePath.includes('/core')) {
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
const OPENROUTER_KEY = process[REDACTED_FILENAME].OPENROUTER_API_KEY_1;

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
        const keys = [process[REDACTED_FILENAME].OPENROUTER_API_KEY_1, process[REDACTED_FILENAME].OPENROUTER_API_KEY_2]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
            const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: msg }]
            }, { headers });
            logError({ request: { headers, body: msg }, response: resp.data }, `OpenRouter API success (key ${idx+1})`);
            sources.push('OpenRouter');
            return { content: resp.data.choices?.[0]?.message?.content || null };
        }, 'OpenRouter');
    }

    // Query Hugging Face using generic key fallback
    async function queryHuggingFace(msg) {
        const keys = [process[REDACTED_FILENAME].HF_API_KEY_1, process[REDACTED_FILENAME].HF_API_KEY_2, process[REDACTED_FILENAME].HF_API_KEY_3]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
            const resp = await axios.post('https://api-inference.huggingface.co/models/gpt2', {
                inputs: msg
            }, { headers });
            logError({ request: { headers, body: msg }, response: resp.data }, `HuggingFace API success (key ${idx+1})`);
            sources.push('HuggingFace');
            return { content: resp.data[0]?.generated_text || null };
        }, 'HuggingFace');
    }

    // Query Google AI Studio using generic key fallback
    async function queryGoogleAI(msg) {
        const keys = [process[REDACTED_FILENAME].GOOGLE_API_KEY_1, process[REDACTED_FILENAME].GOOGLE_API_KEY_2, process[REDACTED_FILENAME].GOOGLE_API_KEY_3]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const resp = await axios.post(`https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText?key=${key}`,
                { prompt: { text: msg } },
                { headers: { 'content-type': 'application/json' } }
            );
            logError({ request: { key, body: msg }, response: resp.data }, `Google AI Studio API success (key ${idx+1})`);
            sources.push('GoogleAI');
            return { content: resp.data.candidates?.[0]?.output || null };
        }, 'GoogleAI');
    }

    // Query xAI Grok using generic key fallback
    async function queryXAI(msg) {
        const keys = [process[REDACTED_FILENAME].XAI_API_KEY_1, process[REDACTED_FILENAME].XAI_API_KEY_2, process[REDACTED_FILENAME].XAI_API_KEY_3]
            .map(cleanKey)
            .filter(Boolean);
        return await tryKeys(keys, async (key, idx) => {
            const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
            const resp = await axios.post('https://api.x.ai/v1/chat/completions', {
                model: 'grok-1',
                messages: [{ role: 'user', content: msg }]
            }, { headers });
            logError({ request: { headers, body: msg }, response: resp.data }, `xAI Grok API success (key ${idx+1})`);
            sources.push('xAI');
            return { content: resp.data.choices?.[0]?.message?.content || null };
        }, 'xAI');
    }

    // Query Polygon using generic key fallback
    async function queryPolygon() {
        const keys = [process[REDACTED_FILENAME].POLYGON_API_KEY_1, process[REDACTED_FILENAME].POLYGON_API_KEY_2]
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
        const keys = [process[REDACTED_FILENAME].ALPACA_API_KEY_1]
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
        aiResponses.push(openRouterResp.content);
    }

    // Synthesize and cross-reference answers
    let reply = aiResponses.filter(Boolean).join(' | ');
    if (!reply) {
        if (errors.length === 0) {
            logError(new Error('No AI response'), 'Fallback response');
        }
        reply = "I'm unable to find a direct answer, but will continue learning.";
    }
    confidence = aiResponses.length ? 0.8 + 0.1 * aiResponses.length : 0.5;
    reasoningTrace.push('Synthesized from: ' + sources.join(', '));

    // Memory update
    vevoMemory.learnedResponses.push({ id: Date.now(), taskType: 'chat', payload: message, response: reply, confidence, sources });
    saveMemory();
    memoryUpdate = true;

    // Output structured JSON with errors
    res.json({
        reply,
        sources,
        reasoning_summary: reasoningTrace.join(' | '),
        confidence,
        memory_update: memoryUpdate,
        errors
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
    const keys = [process[REDACTED_FILENAME].OPENROUTER_API_KEY_1, process[REDACTED_FILENAME].OPENROUTER_API_KEY_2]
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
