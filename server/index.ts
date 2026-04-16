/**
 * FaceVR Server — Express + WebSocket + FreeUV GPU Proxy
 * 
 * Proxies requests to the FreeUV GPU server (FastAPI):
 *   POST /api/face   → upload photo → receive ZIP (face.obj + uv_texture.png + params.json)
 *   POST /api/deform → shape params → receive deformed OBJ text
 *   GET  /api/schema → slider configuration from GPU server
 *   GET  /api/health → server + GPU health check
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const FREEUV_GPU_URL = 'http://jp-tyo-bgp-1.ofalias.net:60136';
const WS_TOKEN_SECRET = process.env.WS_TOKEN_SECRET || 'facevr-dev-secret';
const JOBS_DIR = path.join(__dirname, 'jobs');

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });

// --- Token management ---
function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}
function verifyToken(token: string): boolean {
    if (process.env.NODE_ENV !== 'production') return true;
    return activeTokens.has(token);
}
const activeTokens = new Set<string>();

// --- Express ---
const app = express();
app.use((await import('cors')).default());
app.use(express.json());

// Static files: serve job outputs
app.use('/jobs', express.static(JOBS_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// --- Auth token endpoint ---
app.post('/api/auth/token', (_req, res) => {
    const token = generateToken();
    activeTokens.add(token);
    res.json({ token, expiresIn: 3600 });
});

// ============================================================
// POST /api/face — Upload photo → GPU returns ZIP → unpack
// ============================================================
app.post('/api/face', upload.single('photo'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'No photo provided' });
        return;
    }

    const jobId = crypto.randomBytes(4).toString('hex');
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'input.jpg'), req.file.buffer);

    // Start async processing
    processJob(jobId, req.file.buffer);

    res.json({
        jobId,
        status: 'processing',
        urls: {
            uv: `/jobs/${jobId}/uv_texture.png`,
            mesh: `/jobs/${jobId}/face.obj`,
            params: `/jobs/${jobId}/params.json`,
            shapedirs: `/jobs/${jobId}/shapedirs.bin`,
        },
    });
});

// ============================================================
// POST /api/deform — FLAME shape → GPU returns deformed OBJ
// ============================================================
app.post('/api/deform', express.json(), async (req, res) => {
    const { shape, expression, job_id } = req.body;

    if (!shape || !Array.isArray(shape)) {
        res.status(400).json({ error: 'shape array (200 dims) required' });
        return;
    }

    // Pad to 200 dims if shorter
    const shapePadded = new Array(200).fill(0);
    for (let i = 0; i < Math.min(shape.length, 200); i++) shapePadded[i] = shape[i];

    const deformBody: any = { shape: shapePadded };
    if (expression && Array.isArray(expression)) {
        const exprPadded = new Array(100).fill(0);
        for (let i = 0; i < Math.min(expression.length, 100); i++) exprPadded[i] = expression[i];
        deformBody.expression = exprPadded;
    }

    try {
        const startTime = Date.now();

        const gpuRes = await fetch(`${FREEUV_GPU_URL}/api/deform`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deformBody),
        });

        if (gpuRes.ok) {
            const objText = await gpuRes.text();
            const processingTime = gpuRes.headers.get('X-Processing-Time-Ms') || (Date.now() - startTime);

            // Save deformed mesh if job_id provided
            if (job_id) {
                const jobDir = path.join(JOBS_DIR, job_id);
                if (fs.existsSync(jobDir)) {
                    fs.writeFileSync(path.join(jobDir, 'deformed.obj'), objText);
                }
            }

            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('X-Processing-Time-Ms', String(processingTime));
            res.send(objText);
        } else {
            const errText = await gpuRes.text();
            res.status(gpuRes.status).json({ error: 'GPU deform failed', detail: errText });
        }
    } catch (err: any) {
        res.status(503).json({
            error: 'GPU server unreachable',
            message: err.message,
            gpu_url: FREEUV_GPU_URL,
        });
    }
});

// ============================================================
// GET /api/schema — Proxy slider schema from GPU server
// ============================================================
app.get('/api/schema', async (_req, res) => {
    try {
        const gpuRes = await fetch(`${FREEUV_GPU_URL}/api/schema`, {
            signal: AbortSignal.timeout(5000),
        });
        if (gpuRes.ok) {
            const schema = await gpuRes.json();
            res.json(schema);
        } else {
            res.status(gpuRes.status).json({ error: 'Schema fetch failed' });
        }
    } catch (err: any) {
        // Fallback schema (basic)
        res.json({
            shape: {
                dim: 200,
                description: 'FLAME shape PCA 参数',
                range: [-3.0, 3.0],
                semantic_groups: {
                    face_width: { indices: [0, 1, 2], label: '脸型宽窄' },
                    face_length: { indices: [3, 4, 5], label: '脸型长短' },
                    jaw: { indices: [6, 7, 8, 9], label: '下巴' },
                    nose: { indices: [10, 11, 12, 13], label: '鼻子' },
                    eyes: { indices: [14, 15, 16, 17], label: '眼睛' },
                    mouth: { indices: [18, 19, 20, 21], label: '嘴巴' },
                    forehead: { indices: [22, 23, 24], label: '额头' },
                    cheeks: { indices: [25, 26, 27, 28], label: '脸颊' },
                },
            },
            expression: {
                dim: 100,
                description: 'FLAME expression PCA 参数',
                range: [-2.0, 2.0],
            },
            _source: 'fallback (GPU unreachable)',
        });
    }
});

// --- Latest job endpoint (for dev mode) ---
app.get('/api/jobs/latest', (_req, res) => {
    try {
        const dirs = fs.readdirSync(JOBS_DIR).filter(d => {
            const p = path.join(JOBS_DIR, d);
            return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'face.obj'));
        });
        if (dirs.length === 0) {
            res.status(404).json({ error: 'No completed jobs' });
            return;
        }
        // Sort by modification time (newest first)
        dirs.sort((a, b) => {
            const ta = fs.statSync(path.join(JOBS_DIR, a)).mtimeMs;
            const tb = fs.statSync(path.join(JOBS_DIR, b)).mtimeMs;
            return tb - ta;
        });
        const jobId = dirs[0];
        res.json({
            jobId,
            urls: {
                uv: `/jobs/${jobId}/uv_texture.png`,
                mesh: `/jobs/${jobId}/face.obj`,
                params: `/jobs/${jobId}/params.json`,
                shapedirs: `/jobs/${jobId}/shapedirs.bin`,
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- Job status endpoint ---
app.get('/api/job/:jobId', (req, res) => {
    const jobDir = path.join(JOBS_DIR, req.params.jobId);
    if (!fs.existsSync(jobDir)) {
        res.status(404).json({ error: 'Job not found' });
        return;
    }

    const uvExists = fs.existsSync(path.join(jobDir, 'uv_texture.png'));
    const meshExists = fs.existsSync(path.join(jobDir, 'face.obj'));
    const paramsExists = fs.existsSync(path.join(jobDir, 'params.json'));

    res.json({
        jobId: req.params.jobId,
        status: uvExists && meshExists ? 'completed' : 'processing',
        urls: {
            uv: `/jobs/${req.params.jobId}/uv_texture.png`,
            mesh: `/jobs/${req.params.jobId}/face.obj`,
            params: paramsExists ? `/jobs/${req.params.jobId}/params.json` : null,
        },
    });
});

// --- Health check ---
app.get('/api/health', async (_req, res) => {
    let gpuStatus: any = { status: 'unreachable' };
    try {
        const gpuRes = await fetch(`${FREEUV_GPU_URL}/api/health`, {
            signal: AbortSignal.timeout(10000),
        });
        if (gpuRes.ok) {
            gpuStatus = await gpuRes.json();
        }
    } catch { /* ignore */ }

    res.json({
        status: 'ok',
        version: '3.0.0',
        pipeline: 'freeuv',
        gpu_server: FREEUV_GPU_URL,
        gpu: gpuStatus,
    });
});

// --- HTTP Server ---
const server = http.createServer(app);

// --- WebSocket ---
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map<string, WebSocket>();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (process.env.NODE_ENV === 'production' && (!token || !verifyToken(token))) {
        ws.close(4001, 'Unauthorized');
        return;
    }

    const clientId = crypto.randomBytes(4).toString('hex');
    clients.set(clientId, ws);
    console.log(`[WS] Client connected: ${clientId}`);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            handleWSMessage(clientId, ws, msg);
        } catch (e) {
            console.error('[WS] Invalid message:', e);
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`[WS] Client disconnected: ${clientId}`);
    });
});

function handleWSMessage(clientId: string, ws: WebSocket, msg: any) {
    switch (msg.type) {
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        case 'get-job-status': {
            const jobDir = path.join(JOBS_DIR, msg.jobId || '');
            const uvExists = fs.existsSync(path.join(jobDir, 'uv_texture.png'));
            ws.send(JSON.stringify({
                type: 'job-status',
                jobId: msg.jobId,
                status: uvExists ? 'completed' : 'processing',
            }));
            break;
        }
    }
}

// ============================================================
// Job processing — POST photo to GPU, receive ZIP, unpack
// ============================================================
async function processJob(jobId: string, photoBuffer: Buffer) {
    const broadcast = (data: any) => {
        const msg = JSON.stringify(data);
        clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        });
    };

    broadcast({ type: 'job-started', jobId });
    const jobDir = path.join(JOBS_DIR, jobId);

    try {
        // Send photo to GPU server
        const formData = new FormData();
        formData.append('photo', new Blob([photoBuffer]), 'photo.jpg');

        broadcast({ type: 'job-progress', jobId, progress: 0.1, stage: '发送至 FreeUV GPU...' });

        const gpuRes = await fetch(`${FREEUV_GPU_URL}/api/face`, {
            method: 'POST',
            body: formData,
        });

        if (!gpuRes.ok) {
            const errText = await gpuRes.text();
            throw new Error(`GPU /api/face returned ${gpuRes.status}: ${errText}`);
        }

        broadcast({ type: 'job-progress', jobId, progress: 0.6, stage: '接收 3D 模型 ZIP...' });

        const processingTime = gpuRes.headers.get('X-Processing-Time-Ms');
        console.log(`[Job ${jobId}] GPU processing time: ${processingTime}ms`);

        // Response is a ZIP file
        const zipBuffer = Buffer.from(await gpuRes.arrayBuffer());

        broadcast({ type: 'job-progress', jobId, progress: 0.8, stage: '解压模型文件...' });

        // Unzip the response
        // Use AdmZip for simplicity
        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        for (const entry of entries) {
            const name = entry.entryName;
            // Write each file from ZIP to job dir
            // Expected: face.obj, uv_texture.png, params.json, flaw_uv.jpg
            const outputPath = path.join(jobDir, name);
            fs.writeFileSync(outputPath, entry.getData());
            console.log(`[Job ${jobId}] Extracted: ${name} (${entry.getData().length} bytes)`);
        }

        broadcast({ type: 'job-progress', jobId, progress: 0.95, stage: '模型就绪' });
        console.log(`[Job ${jobId}] FreeUV reconstruction complete`);

    } catch (err: any) {
        console.error(`[Job ${jobId}] GPU processing failed: ${err.message}`);

        broadcast({
            type: 'job-error',
            jobId,
            error: err.message,
        });

        // Generate minimal fallback so frontend doesn't break completely
        await generateFallbackUV(jobDir);
    }

    // Notify clients
    broadcast({
        type: 'model-ready',
        jobId,
        format: 'uv+mesh',
        urls: {
            uv: `/jobs/${jobId}/uv_texture.png`,
            mesh: `/jobs/${jobId}/face.obj`,
            params: `/jobs/${jobId}/params.json`,
            shapedirs: `/jobs/${jobId}/shapedirs.bin`,
        },
    });

    broadcast({ type: 'job-complete', jobId });
}

async function generateFallbackUV(jobDir: string) {
    // Minimal placeholder when GPU is unavailable
    const { createCanvas } = await import('canvas').catch(() => ({ createCanvas: null }));

    if (createCanvas) {
        const canvas = createCanvas(512, 512);
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 512, 512);
        grad.addColorStop(0, '#e8c4a0');
        grad.addColorStop(0.5, '#d4a574');
        grad.addColorStop(1, '#c49060');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        fs.writeFileSync(path.join(jobDir, 'uv_texture.png'), canvas.toBuffer('image/png'));
    } else {
        fs.writeFileSync(path.join(jobDir, 'uv_texture.png'), Buffer.alloc(0));
    }
}

// --- Start ---
server.listen(PORT, () => {
    console.log(`\n  🎨 FaceVR Server v3.0 (FreeUV Pipeline)`);
    console.log(`  ➜ HTTP:    http://localhost:${PORT}`);
    console.log(`  ➜ WS:      ws://localhost:${PORT}/ws`);
    console.log(`  ➜ API:     http://localhost:${PORT}/api/health`);
    console.log(`  ➜ GPU:     ${FREEUV_GPU_URL}`);
    console.log(`  ➜ Auth:    ${process.env.NODE_ENV === 'production' ? 'ENFORCED' : 'DEV MODE (open)'}\n`);
});
