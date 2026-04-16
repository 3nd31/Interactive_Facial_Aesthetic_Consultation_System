/**
 * UnityBridge — Web Shell ↔ Unity WebGL communication layer
 * 
 * FreeUV Pipeline: Unity is the PRIMARY renderer (not fallback)
 * 
 * Web → Unity (SendMessage):
 *   LoadFaceModel(json)      → load OBJ mesh + UV texture
 *   SetSurgeryParam(json)    → set FLAME shape params
 *   SetBaseParams(json)      → set initial FLAME params
 *   ApplyPreset(name)        → apply preset by name
 *   Undo / Redo / ResetAll   → surgery history
 *   ToggleComparison         → before/after view
 *   CaptureScreenshot        → get PNG via event
 * 
 * Unity → Web (CustomEvent 'unity-message'):
 *   model-loaded    → mesh + UV ready
 *   screenshot      → base64 PNG data
 *   deform-complete → vertices updated
 */

declare global {
    interface Window {
        createUnityInstance?: (canvas: HTMLCanvasElement, config: any) => Promise<UnityInstance>;
    }
}

interface UnityInstance {
    SendMessage(objectName: string, methodName: string, value?: string | number): void;
    Quit(): Promise<void>;
    SetFullscreen(fullscreen: boolean): void;
}

export type UnityMessageHandler = (type: string, payload: any) => void;

export class UnityBridge {
    private instance: UnityInstance | null = null;
    private container: HTMLElement;
    private canvas: HTMLCanvasElement | null = null;
    private iframe: HTMLIFrameElement | null = null;
    private onMessage: UnityMessageHandler | null = null;
    private ready = false;
    private messageQueue: { method: string; value?: string }[] = [];

    // Unity build output path (relative to public/)
    private buildPath: string;

    constructor(container: HTMLElement, buildPath = '/unity-build') {
        this.container = container;
        this.buildPath = buildPath;

        // Listen for Unity→JS messages
        window.addEventListener('unity-message', ((e: CustomEvent) => {
            this.handleUnityMessage(e.detail);
        }) as EventListener);

        // Also listen for postMessage from iframe mode
        window.addEventListener('message', (e) => {
            if (e.data?.source === 'unity') {
                this.handleUnityMessage(e.data);
            }
        });
    }

    /**
     * Initialize Unity WebGL runtime
     * Tries iframe first (simpler), then direct createUnityInstance
     */
    async init(): Promise<boolean> {
        try {
            // Check if Unity build exists
            const buildExists = await this.checkBuildExists();
            if (!buildExists) {
                console.warn('[UnityBridge] Unity build not found at', this.buildPath);
                return false;
            }

            // Try direct embed first (better performance)
            const loaderExists = await this.checkFileExists(`${this.buildPath}/Build/unity-build.loader.js`);
            if (loaderExists) {
                return await this.initDirect();
            }
            // Fallback to iframe
            return this.initIframe();
        } catch (err) {
            console.error('[UnityBridge] Init failed:', err);
            return false;
        }
    }

    /**
     * Iframe embedding — isolated, works with any Unity build
     */
    private initIframe(): boolean {
        this.iframe = document.createElement('iframe');
        this.iframe.src = `${this.buildPath}/index.html`;
        this.iframe.id = 'unity-viewport';
        this.iframe.style.cssText = `
            width: 100%; height: 100%;
            border: none; background: #0a0a0f;
            border-radius: 12px;
        `;
        this.iframe.allow = 'autoplay; fullscreen; gamepad; xr-spatial-tracking';

        const existingCanvas = this.container.querySelector('#viewport-canvas');
        if (existingCanvas) {
            existingCanvas.replaceWith(this.iframe);
        } else {
            this.container.insertBefore(this.iframe, this.container.firstChild);
        }

        this.iframe.onload = () => {
            this.ready = true;
            this.flushQueue();
            console.log('[UnityBridge] Iframe loaded');
        };

        return true;
    }

    /**
     * Direct Unity instance — better performance, full API access
     */
    private async initDirect(): Promise<boolean> {
        await this.loadScript(`${this.buildPath}/Build/unity-build.loader.js`);

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'unity-canvas';
        this.canvas.style.cssText = 'width:100%;height:100%;display:block;';
        this.canvas.tabIndex = 1; // Allow focus for input

        const existingCanvas = this.container.querySelector('#viewport-canvas');
        if (existingCanvas) {
            existingCanvas.replaceWith(this.canvas);
        } else {
            this.container.insertBefore(this.canvas, this.container.firstChild);
        }

        if (!window.createUnityInstance) {
            console.error('[UnityBridge] createUnityInstance not found');
            return false;
        }

        this.instance = await window.createUnityInstance(this.canvas, {
            dataUrl: `${this.buildPath}/Build/unity-build.data`,
            frameworkUrl: `${this.buildPath}/Build/unity-build.framework.js`,
            codeUrl: `${this.buildPath}/Build/unity-build.wasm`,
            streamingAssetsUrl: `${this.buildPath}/StreamingAssets`,
            companyName: 'FaceVR',
            productName: 'FaceVR Surgery Simulator',
            productVersion: '3.0',
        });

        this.ready = true;
        this.flushQueue();
        console.log('[UnityBridge] Direct instance created');
        return true;
    }

    // ====== Web → Unity: FreeUV Pipeline ======

    /**
     * Load face model from FreeUV server result
     */
    loadFaceModel(uvUrl: string, meshUrl: string, shapedirsUrl?: string): void {
        this.sendMessage('JSBridge', 'LoadFaceModel',
            JSON.stringify({ uvUrl, meshUrl, shapedirsUrl: shapedirsUrl || '' }));
    }

    /**
     * [DEPRECATED] Update mesh with deformed OBJ text (from /api/deform GPU result).
     * Prefer applyLocalDeformation() for local shapedirs-based deformation.
     */
    updateDeformedMesh(objText: string): void {
        this.sendMessage('JSBridge', 'UpdateDeformedMesh', objText);
    }

    /**
     * Apply local deformation from FLAME shape params (no server needed).
     * Uses shapedirs.bin matrix loaded during model init.
     */
    applyLocalDeformation(params: number[]): void {
        this.sendMessage('JSBridge', 'ApplyLocalDeformation',
            JSON.stringify({ params }));
    }

    /**
     * Apply direct vertex displacement (no PCA). Sends surgery params as named fields.
     * Each param directly moves a facial region's vertices.
     */
    applyDirectDeformation(params: Record<string, number>): void {
        this.sendMessage('JSBridge', 'ApplyDirectDeformation',
            JSON.stringify(params));
    }

    /**
     * Apply region-isolated deformation (per-region shape arrays).
     * Each region's shape is applied only to its facial area.
     */
    applyRegionDeformation(regions: Record<string, number[]>): void {
        this.sendMessage('JSBridge', 'ApplyRegionDeformation',
            JSON.stringify(regions));
    }

    /**
     * Enable/disable face-only masking mode.
     * When enabled, skull/neck vertices won't move during deformation.
     */
    setFaceOnlyMode(enabled: boolean): void {
        this.sendMessage('JSBridge', 'SetFaceOnlyMode',
            JSON.stringify({ enabled }));
    }

    /**
     * Set hair style preset: "short", "medium", "fluffy"
     */
    setHairStyle(style: string): void {
        this.sendMessage('JSBridge', 'SetHairStyle', style);
    }

    /**
     * Set skin color tint (multiplied with UV texture).
     * Values near 1.0 preserve original, lower values darken/tint.
     */
    setSkinColor(r: number, g: number, b: number): void {
        this.sendMessage('JSBridge', 'SetSkinColor', JSON.stringify({ r, g, b }));
    }

    /**
     * Set base FLAME params (from /api/face result)
     */
    setBaseParams(params: number[]): void {
        this.sendMessage('JSBridge', 'SetBaseParams',
            JSON.stringify({ data: params }));
    }

    /**
     * Set a single surgery param (from slider drag)
     */
    setSurgeryParam(area: string, paramName: string, value: number): void {
        this.sendMessage('JSBridge', 'SetSurgeryParam',
            JSON.stringify({ area, param: paramName, value }));
    }

    /**
     * Set FLAME shape params (batch, from preset)
     */
    setSurgeryParams(indices: number[], values: number[]): void {
        this.sendMessage('JSBridge', 'SetSurgeryParam',
            JSON.stringify({ indices, values }));
    }

    /**
     * Apply a named preset
     */
    applyPreset(preset: string): void {
        this.sendMessage('JSBridge', 'ApplyPreset', preset);
    }

    /**
     * Send MediaPipe face landmarks to Unity for adaptive deformation targeting.
     * Call after loadFaceModel once landmarks are detected from the source photo.
     */
    setFaceLandmarks(landmarks: Record<string, { x: number; y: number; z: number }>): void {
        this.sendMessage('JSBridge', 'SetFaceLandmarks', JSON.stringify(landmarks));
    }

    undo(): void { this.sendMessage('JSBridge', 'Undo'); }
    redo(): void { this.sendMessage('JSBridge', 'Redo'); }
    resetAll(): void { this.sendMessage('JSBridge', 'ResetAll'); }
    toggleComparison(): void { this.sendMessage('JSBridge', 'ToggleComparison'); }
    captureScreenshot(): void { this.sendMessage('JSBridge', 'CaptureScreenshot'); }

    /** Kept for backwards compat (resetCamera → ResetAll) */
    resetCamera(): void { this.resetAll(); }

    // ====== Unity → Web: Event handling ======

    setOnMessage(handler: UnityMessageHandler): void {
        this.onMessage = handler;
    }

    private handleUnityMessage(detail: any): void {
        if (!detail) return;
        const { type, payload } = detail;
        console.log('[UnityBridge] ←', type);

        // Parse payload if it's a string
        let parsed = payload;
        if (typeof payload === 'string') {
            try { parsed = JSON.parse(payload); } catch { /* keep as string */ }
        }

        this.onMessage?.(type, parsed);
    }

    // ====== Public API ======

    /**
     * Generic sendMessage (exposed for custom calls)
     */
    sendMessage(objectName: string, methodName: string, value?: string): void {
        if (!this.ready) {
            // Queue messages until Unity is ready
            this.messageQueue.push({ method: `${objectName}.${methodName}`, value });
            return;
        }

        if (this.instance) {
            // Direct mode
            if (value !== undefined) {
                this.instance.SendMessage(objectName, methodName, value);
            } else {
                this.instance.SendMessage(objectName, methodName);
            }
        } else if (this.iframe?.contentWindow) {
            // Iframe mode: postMessage
            this.iframe.contentWindow.postMessage(
                { target: 'unity', objectName, method: methodName, value },
                '*'
            );
        }
    }

    isReady(): boolean { return this.ready; }

    async destroy(): Promise<void> {
        if (this.instance) {
            await this.instance.Quit();
            this.instance = null;
        }
        this.iframe?.remove();
        this.canvas?.remove();
        this.ready = false;
    }

    // ====== Internal ======

    private flushQueue(): void {
        for (const msg of this.messageQueue) {
            const [obj, method] = msg.method.split('.');
            this.sendMessage(obj, method, msg.value);
        }
        this.messageQueue = [];
    }

    private loadScript(src: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    private async checkBuildExists(): Promise<boolean> {
        try {
            const res = await fetch(`${this.buildPath}/index.html`, { method: 'HEAD' });
            return res.ok;
        } catch { return false; }
    }

    private async checkFileExists(path: string): Promise<boolean> {
        try {
            const res = await fetch(path, { method: 'HEAD' });
            return res.ok;
        } catch { return false; }
    }
}
