/**
 * APIClient — WebSocket + HTTP client for FaceVR server (FreeUV pipeline)
 * Handles photo upload → UV map + mesh URLs, and real-time progress
 */

export type ProgressCallback = (progress: number, stage: string) => void;

export interface FreeUVResult {
    jobId: string;
    uvUrl: string;
    meshUrl: string;
    paramsUrl: string;
    shapedirsUrl?: string;  // shapedirs.bin for local deformation
}

export interface FlameParams {
    shape: number[];       // 200-dim FLAME shape parameters
    expression?: number[]; // 100-dim expression parameters
}

export interface DeformResult {
    objText: string;       // OBJ format text from GPU
    processingTimeMs: number;
}

export class APIClient {
    private ws: WebSocket | null = null;
    private serverUrl: string;
    private wsUrl: string;
    private onProgress: ProgressCallback | null = null;
    private onModelReady: ((result: FreeUVResult) => void) | null = null;
    private reconnectTimer: number | null = null;
    private connected = false;

    constructor(serverUrl = 'http://localhost:3001') {
        this.serverUrl = serverUrl;
        this.wsUrl = serverUrl.replace('http', 'ws') + '/ws';
    }

    // --- WebSocket ---
    connect(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                let wsUrl = this.wsUrl;
                try {
                    const tokenRes = await fetch(`${this.serverUrl}/api/auth/token`, { method: 'POST' });
                    if (tokenRes.ok) {
                        const { token } = await tokenRes.json();
                        wsUrl = `${this.wsUrl}?token=${token}`;
                    }
                } catch {
                    console.warn('[API] Token fetch failed, connecting without token');
                }

                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    this.connected = true;
                    console.log('[API] WebSocket connected');
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    const msg = JSON.parse(event.data as string);
                    this.handleMessage(msg);
                };

                this.ws.onclose = () => {
                    this.connected = false;
                    console.log('[API] WebSocket disconnected');
                    this.scheduleReconnect();
                };

                this.ws.onerror = () => {
                    this.connected = false;
                    reject(new Error('WebSocket connection failed'));
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    disconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.ws?.close();
        this.ws = null;
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            console.log('[API] Attempting reconnect...');
            this.connect().catch(() => {
                this.scheduleReconnect();
            });
        }, 3000);
    }

    private handleMessage(msg: any): void {
        switch (msg.type) {
            case 'connected':
                console.log(`[API] Server assigned ID: ${msg.clientId}`);
                break;

            case 'job-progress':
                this.onProgress?.(msg.progress, msg.stage);
                break;

            case 'model-ready':
                console.log(`[API] Model ready: ${msg.jobId}`);
                if (msg.urls) {
                    this.onModelReady?.({
                        jobId: msg.jobId,
                        uvUrl: `${this.serverUrl}${msg.urls.uv}`,
                        meshUrl: `${this.serverUrl}${msg.urls.mesh}`,
                        paramsUrl: `${this.serverUrl}${msg.urls.params}`,
                        shapedirsUrl: msg.urls.shapedirs ? `${this.serverUrl}${msg.urls.shapedirs}` : undefined,
                    });
                }
                break;

            case 'job-started':
                console.log(`[API] Job started: ${msg.jobId}`);
                this.onProgress?.(0, '处理中...');
                break;

            case 'job-complete':
                console.log(`[API] Job complete: ${msg.jobId}`);
                this.onProgress?.(1, '完成');
                break;

            case 'pong':
                break;

            default:
                console.log('[API] Unknown message:', msg);
        }
    }

    // --- HTTP API ---

    /** Upload photo → OBJ + UV + FLAME params */
    async uploadPhoto(file: File | Blob): Promise<FreeUVResult> {
        const formData = new FormData();
        formData.append('photo', file, 'capture.jpg');

        const res = await fetch(`${this.serverUrl}/api/face`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const data = await res.json();

        return {
            jobId: data.jobId,
            uvUrl: `${this.serverUrl}${data.urls.uv}`,
            meshUrl: `${this.serverUrl}${data.urls.mesh}`,
            paramsUrl: `${this.serverUrl}${data.urls.params}`,
            shapedirsUrl: data.urls.shapedirs ? `${this.serverUrl}${data.urls.shapedirs}` : undefined,
        };
    }

    /** Deform face mesh with modified FLAME shape params */
    async deformFace(shape: number[], expression?: number[], jobId?: string): Promise<DeformResult> {
        const startTime = Date.now();
        const body: any = { shape };
        if (expression) body.expression = expression;
        if (jobId) body.job_id = jobId;

        const res = await fetch(`${this.serverUrl}/api/deform`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(`Deform failed: ${res.status}`);
        const objText = await res.text();
        return {
            objText,
            processingTimeMs: Date.now() - startTime,
        };
    }

    /** Fetch FLAME shape parameters for a job */
    async getFlameParams(paramsUrl: string): Promise<FlameParams> {
        const res = await fetch(paramsUrl);
        if (!res.ok) throw new Error(`Params fetch failed: ${res.status}`);
        return res.json();
    }
    async getJobStatus(jobId: string): Promise<{ status: string; urls: FreeUVResult }> {
        const res = await fetch(`${this.serverUrl}/api/job/${jobId}`);
        if (!res.ok) throw new Error(`Job status failed: ${res.status}`);
        const data = await res.json();
        return {
            status: data.status,
            urls: {
                jobId: data.jobId,
                uvUrl: `${this.serverUrl}${data.urls.uv}`,
                meshUrl: `${this.serverUrl}${data.urls.mesh}`,
                paramsUrl: data.urls.params ? `${this.serverUrl}${data.urls.params}` : '',
            },
        };
    }

    /** Download UV texture as an image */
    async downloadUVTexture(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load UV texture'));
            img.src = url;
        });
    }

    async checkHealth(): Promise<boolean> {
        try {
            const res = await fetch(`${this.serverUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    // --- Callbacks ---
    setOnProgress(cb: ProgressCallback): void {
        this.onProgress = cb;
    }

    setOnModelReady(cb: (result: FreeUVResult) => void): void {
        this.onModelReady = cb;
    }
}
