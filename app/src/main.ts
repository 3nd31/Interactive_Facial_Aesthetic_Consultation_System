/**
 * FaceVR — Main Entry Point
 * Routes between Landing → Capture → Editor pages
 * Integrates API client for server communication
 */

import './styles/index.css';
import { createLandingPage } from './ui/landing';
import { createEditorPage, initEditorInteractions } from './ui/editor';
import { FaceDetector } from './modules/face-detector';

type Page = 'landing' | 'capture' | 'editor';

class App {
    private app: HTMLElement;
    private currentPage: Page = 'landing';
    private capturePageInstance: any = null;
    private viewportInstance: any = null;
    private apiClient: any = null;
    private faceDetector: FaceDetector = new FaceDetector();

    constructor() {
        this.app = document.getElementById('app')!;
        this.init();
    }

    private init(): void {
        // Landing
        const landing = createLandingPage();
        this.app.appendChild(landing);

        // Capture placeholder
        const capturePlaceholder = document.createElement('div');
        capturePlaceholder.className = 'page capture';
        capturePlaceholder.id = 'page-capture';
        capturePlaceholder.innerHTML = `
            <div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;">
                <div class="loading-spinner"></div>
                <p style="color:var(--c-text-2)">加载面部检测模块...</p>
            </div>
        `;
        this.app.appendChild(capturePlaceholder);

        // Editor
        const editor = createEditorPage();
        this.app.appendChild(editor);

        // Loading overlay for model download
        const overlay = document.createElement('div');
        overlay.id = 'model-loading';
        overlay.className = 'model-loading-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML = `
            <div class="model-loading-card">
                <div class="loading-spinner"></div>
                <p class="model-loading-stage" id="loading-stage">连接服务器...</p>
                <div class="model-loading-bar">
                    <div class="model-loading-fill" id="loading-fill"></div>
                </div>
            </div>
        `;
        this.app.appendChild(overlay);

        // Dev mode: ?dev in URL → skip landing, go straight to editor
        const isDevMode = new URLSearchParams(window.location.search).has('dev');
        if (isDevMode) {
            console.log('[App] 🔧 DEV MODE — auto-loading latest job into editor');
            this.navigateTo('editor');
        } else {
            this.navigateTo('landing');
        }
        this.bindNavigation();
        this.initServerConnection();
        console.log('[App] Initialized' + (isDevMode ? ' (DEV MODE)' : ''));
    }

    private async initServerConnection(): Promise<void> {
        try {
            const { APIClient } = await import('./modules/api-client');
            this.apiClient = new APIClient('http://localhost:3001');

            // Check if server is available
            const healthy = await this.apiClient.checkHealth();
            if (healthy) {
                console.log('[App] Server connected');
                await this.apiClient.connect();
            } else {
                console.log('[App] Server unavailable — using local-only mode');
            }
        } catch (err) {
            console.log('[App] Server connection skipped:', err);
        }
    }

    private bindNavigation(): void {
        document.getElementById('btn-start-camera')?.addEventListener('click', () => {
            this.navigateTo('capture');
        });
        document.getElementById('btn-upload-photo')?.addEventListener('click', async () => {
            // Navigate to editor first (initializes Unity + EditorController),
            // then trigger upload in background
            await this.navigateTo('editor');
            this.triggerPhotoUpload();
        });
        document.getElementById('btn-editor-back')?.addEventListener('click', () => {
            this.navigateTo('landing');
        });
    }

    /** Open file picker → upload → GPU process → load into Unity */
    private triggerPhotoUpload(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file || !this.apiClient) return;

            // Show loading overlay
            this.showModelLoading(true);
            this.updateLoadingProgress(0.1, '上传中...');

            try {
                // Upload photo
                const result = await this.apiClient.uploadPhoto(file);
                console.log(`[App] Upload done, jobId: ${result.jobId}`);
                this.updateLoadingProgress(0.3, '重建中...');

                // Poll for completion
                let status = 'processing';
                for (let i = 0; i < 60; i++) {
                    await new Promise(r => setTimeout(r, 2000));
                    const jobStatus = await this.apiClient.getJobStatus(result.jobId);
                    status = jobStatus.status;
                    this.updateLoadingProgress(0.3 + i * 0.01, '重建中...');

                    if (status === 'completed') {
                        this.updateLoadingProgress(0.9, '加载模型...');
                        const urls = jobStatus.urls;
                        console.log('[App] Job complete, loading model into Unity...');

                        // Load model into Unity (with shapedirs for local deformation)
                        if (this.viewportInstance && 'loadFaceModel' in this.viewportInstance) {
                            (this.viewportInstance as any).loadFaceModel(urls.uvUrl, urls.meshUrl, (urls as any).shapedirsUrl);
                            // Detect face landmarks from input photo and send to Unity
                            this.detectAndSendLandmarks(result.jobId, this.viewportInstance);
                        }

                        // Load FLAME params + wire DeformationEngine for slider deformation
                        if (urls.paramsUrl) {
                            try {
                                const params = await this.apiClient.getFlameParams(urls.paramsUrl);
                                const shape = params.shape || [];

                                if (this.viewportInstance && 'setBaseParams' in this.viewportInstance) {
                                    (this.viewportInstance as any).setBaseParams(shape);
                                }

                                // Find the EditorController and wire its engine
                                const editorEl = document.getElementById('page-editor');
                                if (editorEl && (editorEl as any).__controller) {
                                    const ctrl = (editorEl as any).__controller;
                                    const engine = ctrl.getEngine();
                                    engine.setBaseShape(shape);
                                    // Wire UnityBridge for local deformation (primary)
                                    if (this.viewportInstance && 'applyLocalDeformation' in this.viewportInstance) {
                                        engine.setUnityBridge(this.viewportInstance);
                                    }
                                    engine.setApiClient(this.apiClient!);
                                    engine.setJobId(result.jobId);
                                    engine.setOnVertexUpdate((objText: string) => {
                                        if (this.viewportInstance && 'updateDeformedMesh' in this.viewportInstance) {
                                            (this.viewportInstance as any).updateDeformedMesh(objText);
                                        }
                                    });
                                    console.log(`[App] Deformation pipeline wired via upload (${shape.length} dims)`);
                                }

                                console.log(`[App] Base shape loaded (${shape.length} dims)`);
                            } catch (e) {
                                console.warn('[App] Params fetch failed:', e);
                            }
                        }

                        this.updateLoadingProgress(1, '完成');
                        setTimeout(() => this.showModelLoading(false), 1000);
                        break;
                    } else if (status === 'error') {
                        throw new Error('GPU processing failed');
                    }
                }

                if (status !== 'completed') {
                    throw new Error('Processing timeout');
                }
            } catch (err) {
                console.error('[App] Upload pipeline failed:', err);
                this.updateLoadingProgress(0, '处理失败');
                setTimeout(() => this.showModelLoading(false), 3000);
            }
        };
        input.click();
    }

    /**
     * Load the most recent cached job data into Unity so sliders work
     * without requiring a new photo upload.
     */
    private async autoLoadCachedJob(
        unityBridge: any,
        controller: any
    ): Promise<void> {
        const serverBase = 'http://localhost:3001';
        try {
            // Check URL param ?job=xxx for specific job override
            const urlJobId = new URLSearchParams(window.location.search).get('job');
            if (urlJobId) {
                console.log(`[App] Loading job from URL param: ${urlJobId}`);
                await this.loadJobIntoEditor(urlJobId, serverBase, unityBridge, controller);
                return;
            }
            // Try to find the latest completed job
            const res = await fetch(`${serverBase}/api/jobs/latest`);
            if (!res.ok) {
                // Fallback: try known cached job
                console.log('[App] No /api/jobs/latest, trying cached job ff4fc331...');
                await this.loadJobIntoEditor('ff4fc331', serverBase, unityBridge, controller);
                return;
            }
            const data = await res.json();
            if (data.jobId) {
                await this.loadJobIntoEditor(data.jobId, serverBase, unityBridge, controller);
            }
        } catch (err) {
            // Fallback: try known cached job directly
            console.warn('[App] Auto-load failed, trying fallback:', err);
            try {
                await this.loadJobIntoEditor('ff4fc331', serverBase, unityBridge, controller);
            } catch (e2) {
                console.warn('[App] Fallback load also failed:', e2);
            }
        }
    }

    private async loadJobIntoEditor(
        jobId: string,
        serverBase: string,
        unityBridge: any,
        controller: any
    ): Promise<void> {
        const uvUrl = `${serverBase}/jobs/${jobId}/uv_texture.png`;
        const meshUrl = `${serverBase}/jobs/${jobId}/face.obj`;
        const shapedirsUrl = `${serverBase}/jobs/${jobId}/shapedirs.bin`;
        const paramsUrl = `${serverBase}/jobs/${jobId}/params.json`;

        // Check if files exist
        const check = await fetch(meshUrl, { method: 'HEAD' });
        if (!check.ok) {
            console.warn(`[App] Job ${jobId} mesh not found`);
            return;
        }

        // Wait for Unity scene to be fully initialized (JSBridge may not be ready yet)
        console.log(`[App] Waiting for Unity scene ready before loading job: ${jobId}`);
        await this.waitForUnityScene(8000); // wait up to 8 seconds

        console.log(`[App] Auto-loading cached job: ${jobId}`);

        // Load model into Unity
        unityBridge.loadFaceModel(uvUrl, meshUrl, shapedirsUrl);

        // Detect face landmarks from input photo and send to Unity
        this.detectAndSendLandmarks(jobId, unityBridge);

        // Load params and wire deformation engine
        try {
            const paramsRes = await fetch(paramsUrl);
            if (paramsRes.ok) {
                const params = await paramsRes.json();
                const shape = params.shape || [];
                unityBridge.setBaseParams(shape);

                const engine = controller.getEngine();
                engine.setBaseShape(shape);
                engine.setUnityBridge(unityBridge);
                if (this.apiClient) {
                    engine.setApiClient(this.apiClient);
                }
                engine.setJobId(jobId);
                engine.setOnVertexUpdate((objText: string) => {
                    unityBridge.updateDeformedMesh(objText);
                });

                console.log(`[App] ✅ Cached job loaded: ${jobId} (${shape.length} shape dims)`);
            }
        } catch (e) {
            console.warn('[App] Params load failed:', e);
        }
    }

    /**
     * Wait for Unity scene to be fully initialized (JSBridge ready).
     * Listens for unity-message events or falls back to a fixed delay.
     */
    private waitForUnityScene(timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            let resolved = false;
            const done = () => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            };

            // Listen for any unity→JS message (proves JSBridge is alive)
            const handler = ((e: CustomEvent) => {
                console.log('[App] Unity scene signal received:', e.detail?.type);
                window.removeEventListener('unity-message', handler as EventListener);
                done();
            }) as EventListener;
            window.addEventListener('unity-message', handler);

            // Also listen for postMessage from iframe
            const msgHandler = (e: MessageEvent) => {
                if (e.data?.source === 'unity') {
                    console.log('[App] Unity iframe signal received:', e.data?.type);
                    window.removeEventListener('message', msgHandler);
                    done();
                }
            };
            window.addEventListener('message', msgHandler);

            // Fallback: just wait the timeout
            setTimeout(() => {
                window.removeEventListener('unity-message', handler as EventListener);
                window.removeEventListener('message', msgHandler);
                console.log('[App] Unity wait timeout — proceeding anyway');
                done();
            }, timeoutMs);
        });
    }

    private async navigateTo(page: Page): Promise<void> {
        document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
        this.currentPage = page;
        const targetEl = document.getElementById(`page-${page}`);
        if (targetEl) targetEl.classList.add('active');

        if (page === 'capture') await this.initCapturePage();
        if (page === 'editor') await this.initEditor();
        console.log(`[App] → ${page}`);
    }

    private showModelLoading(show: boolean): void {
        const overlay = document.getElementById('model-loading');
        if (overlay) overlay.style.display = show ? 'flex' : 'none';
    }

    private updateLoadingProgress(progress: number, stage: string): void {
        const stageEl = document.getElementById('loading-stage');
        const fillEl = document.getElementById('loading-fill');
        if (stageEl) stageEl.textContent = stage;
        if (fillEl) fillEl.style.width = `${Math.round(progress * 100)}%`;
    }

    private async initEditor(): Promise<void> {
        if (this.viewportInstance) return;

        try {
            const [{ EditorController }] = await Promise.all([
                import('./ui/editor-controller'),
            ]);

            const editorEl = document.getElementById('page-editor')!;
            const viewportContainer = document.getElementById('editor-viewport')!;

            // Init editor interactions (panel switching, slider display)
            initEditorInteractions(editorEl);

            // Init controller
            const controller = new EditorController(editorEl);
            // Store reference for cross-wiring (e.g., triggerPhotoUpload)
            (editorEl as any).__controller = controller;

            // ---- Unity WebGL is PRIMARY renderer ----
            let unityLoaded = false;
            try {
                const { UnityBridge } = await import('./modules/unity-bridge');
                const unityBridge = new UnityBridge(viewportContainer);
                const success = await unityBridge.init();

                if (success) {
                    unityLoaded = true;
                    this.viewportInstance = unityBridge;
                    controller.setUnityBridge(unityBridge);

                    // Wire engine → Unity bridge immediately (don't wait for params.json)
                    const engine = controller.getEngine();
                    engine.setUnityBridge(unityBridge);

                    // Auto-load last cached job (so sliders work without new upload)
                    this.autoLoadCachedJob(unityBridge, controller);

                    // Wire toolbar → Unity
                    document.getElementById('btn-undo')?.addEventListener('click', () => unityBridge.undo());
                    document.getElementById('btn-redo')?.addEventListener('click', () => unityBridge.redo());
                    document.getElementById('btn-reset')?.addEventListener('click', () => unityBridge.resetAll());
                    document.getElementById('btn-compare')?.addEventListener('click', () => unityBridge.toggleComparison());
                    document.getElementById('btn-export')?.addEventListener('click', () => unityBridge.captureScreenshot());

                    // Handle Unity→JS messages (FreeUV pipeline)
                    unityBridge.setOnMessage((type, payload) => {
                        switch (type) {
                            case 'screenshot':
                                // Download screenshot as PNG
                                if (payload?.data) {
                                    const link = document.createElement('a');
                                    link.download = `facevr-${Date.now()}.png`;
                                    link.href = payload.data;
                                    link.click();
                                }
                                break;
                            case 'model-loaded':
                                console.log('[App] Face model loaded in Unity');
                                this.showModelLoading(false);
                                break;
                            case 'deform-complete':
                                console.log('[App] Deform complete');
                                break;
                        }
                    });

                    // Wire surgery controller → DeformationEngine → GPU → Unity mesh update
                    controller.setOnDeform((params) => {
                        // Trigger GPU deformation with current params
                        controller.getEngine().deform(params);
                    });


                    // Wire API client for FreeUV model loading
                    if (this.apiClient?.isConnected()) {
                        this.apiClient.setOnProgress((p: number, s: string) => {
                            this.updateLoadingProgress(p, s);
                        });
                        this.apiClient.setOnModelReady((result: any) => {
                            console.log(`[App] FreeUV model ready → Unity`);
                            unityBridge.loadFaceModel(result.uvUrl, result.meshUrl, result.shapedirsUrl);
                            // Detect face landmarks from input photo and send to Unity
                            this.detectAndSendLandmarks(result.jobId, unityBridge);
                            if (result.paramsUrl) {
                                fetch(result.paramsUrl).then(r => r.json()).then(params => {
                                    const shape = params.shape || [];
                                    unityBridge.setBaseParams(shape);

                                    // Wire DeformationEngine for local slider deformation
                                    const engine = controller.getEngine();
                                    engine.setBaseShape(shape);
                                    engine.setUnityBridge(unityBridge);  // Local deformation (primary)
                                    engine.setApiClient(this.apiClient!); // Fallback
                                    engine.setJobId(result.jobId);

                                    // Legacy: when server returns deformed OBJ → send to Unity
                                    engine.setOnVertexUpdate((objText: string) => {
                                        unityBridge.updateDeformedMesh(objText);
                                    });

                                    console.log(`[App] Deformation pipeline wired: local shapedirs (${shape.length} dims)`);
                                }).catch(e => console.warn('[App] Params fetch failed:', e));
                            }
                        });
                    }

                    // Also wire for triggerPhotoUpload flow (direct polling)
                    // DeformationEngine will be wired when model loads via
                    // either WS model-ready or direct polling in triggerPhotoUpload

                    console.log('[App] ✅ Editor wired (Unity WebGL + FreeUV + VR mode)');
                }
            } catch (err) {
                console.warn('[App] Unity init failed:', err);
            }

            // ---- Fallback: standalone editor (no VR) ----
            if (!unityLoaded) {
                console.log('[App] Unity unavailable → standalone editor.html (no VR)');
                window.location.href = '/editor.html';
            }

        } catch (err) {
            console.error('[App] Editor init failed:', err);
        }
    }

    private async initCapturePage(): Promise<void> {
        try {
            const { CapturePage } = await import('./ui/capture');
            if (!this.capturePageInstance) {
                this.capturePageInstance = new CapturePage();
                const placeholder = document.getElementById('page-capture');
                if (placeholder) {
                    const realEl = this.capturePageInstance.getElement();
                    realEl.classList.add('active');
                    placeholder.replaceWith(realEl);
                }
                this.capturePageInstance.setOnComplete(async (_result: any, photo: Blob | null) => {
                    this.capturePageInstance?.deactivate();

                    // Upload photo to server if available
                    if (photo && this.apiClient?.isConnected()) {
                        try {
                            this.showModelLoading(true);
                            this.updateLoadingProgress(0.1, '上传照片...');
                            await this.apiClient.uploadPhoto(photo);
                            console.log('[App] Photo uploaded to server');
                        } catch (err) {
                            console.warn('[App] Photo upload failed:', err);
                            this.showModelLoading(false);
                        }
                    }

                    this.navigateTo('editor');
                });
            }
            this.capturePageInstance.activate();
            document.getElementById('btn-capture-back')?.addEventListener('click', () => {
                this.capturePageInstance?.deactivate();
                this.navigateTo('landing');
            });
        } catch (err) {
            console.error('[App] Capture init failed:', err);
        }
    }

    /**
     * Detect face landmarks from the server's input photo using MediaPipe,
     * then send the key surgery landmarks to Unity for adaptive deformation.
     */
    private async detectAndSendLandmarks(jobId: string, bridge: any): Promise<void> {
        const serverBase = 'http://localhost:3001';
        const inputUrl = `${serverBase}/jobs/${jobId}/input.jpg`;

        try {
            // Load input photo as an Image element
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load input image'));
                img.src = inputUrl;
            });

            console.log(`[App] Input photo loaded: ${img.width}x${img.height}`);

            // Run MediaPipe face detection
            const landmarks = await this.faceDetector.detectFromImage(img);
            if (!landmarks) {
                console.warn('[App] No face detected in input photo, using hardcoded landmarks');
                return;
            }

            // Extract surgery-relevant landmarks
            const surgeryLandmarks = FaceDetector.extractSurgeryLandmarks(landmarks);
            console.log('[App] MediaPipe surgery landmarks:', surgeryLandmarks);

            // Send to Unity (delay slightly to let mesh load first)
            setTimeout(() => {
                if ('setFaceLandmarks' in bridge) {
                    bridge.setFaceLandmarks(surgeryLandmarks);
                    console.log('[App] ✅ MediaPipe landmarks sent to Unity');
                }
            }, 3000); // 3s delay for mesh to finish loading
        } catch (err) {
            console.warn('[App] Landmark detection failed:', err);
        }
    }
}

const appEl = document.getElementById('app');
if (appEl) new App();
else document.addEventListener('DOMContentLoaded', () => new App());
