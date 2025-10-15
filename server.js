import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const port = 8080;

app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));

const __dirname = path.resolve();

let vevoMemory = { personality: 'friendly', learnedResponses: [] };
const memoryFile = path.join(__dirname, 'vevoMemory.json');
if (fs.existsSync(memoryFile)) {
    vevoMemory = { ...vevoMemory, ...JSON.parse(fs.readFileSync(memoryFile, 'utf-8')) };
}
function saveMemory() { fs.writeFileSync(memoryFile, JSON.stringify(vevoMemory, null, 2)); }

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    // Correct template literal
    const reply = `You said: "${message}". VevoAI is thinking...`;

    vevoMemory.learnedResponses.push({ id: Date.now(), taskType: 'chat', payload: message, response: reply, confidence: 0.5 });
    saveMemory();
    res.json({ reply, personality: vevoMemory.personality });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, () => console.log(`VevoAI running at http://localhost:${port}`));

process.on('SIGINT', () => { saveMemory(); process.exit(0); });
