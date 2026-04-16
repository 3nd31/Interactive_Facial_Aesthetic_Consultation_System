/**
 * DeformationEngine — Manages FLAME surgery parameters + undo/redo history
 * Uses local shapedirs-based deformation (no GPU server needed)
 */

import { APIClient } from './api-client';
import { UnityBridge } from './unity-bridge';

export interface SurgeryParams {
    noseBridgeHeight: number;
    noseBridgeWidth: number;
    noseTipAngle: number;
    noseWingWidth: number;
    jawWidth: number;
    jawAngle: number;
    chinLength: number;
    chinProjection: number;
    eyeLidWidth: number;
    eyeCorner: number;
    lipVolume: number;
    lipArch: number;
}

export type VertexUpdateCallback = (objText: string) => void;

export class DeformationEngine {
    private apiClient: APIClient | null = null;
    private unityBridge: UnityBridge | null = null;
    private onVertexUpdate: VertexUpdateCallback | null = null;
    private throttleTimer: number | null = null;
    private throttleMs = 30; // 30ms for local deformation (no network)
    private pendingParams: number[] | null = null;
    private pendingRegionParams: Record<string, number[]> | null = null;
    private jobId: string | null = null;
    private lastDeformTime = 0;
    private linkedMode = false; // false = independent (region-isolated), true = linked (global)

    // Current surgery params
    private currentParams: SurgeryParams;

    // Undo/redo history
    private history: SurgeryParams[] = [];
    private historyIndex = -1;
    private maxHistory = 50;

    // FLAME base shape (from params.json)
    private baseShape: number[] = new Array(200).fill(0);

    constructor(apiClient?: APIClient) {
        this.apiClient = apiClient || null;
        this.currentParams = this.defaultParams();
    }

    setApiClient(client: APIClient): void {
        this.apiClient = client;
    }

    setUnityBridge(bridge: UnityBridge): void {
        this.unityBridge = bridge;
        // Face-only mode: enable after Unity rebuild with shapedirs-based face weights
        // (old build has broken coordinate-space face detection → 0 face verts → zero deformation)
        // TODO: uncomment after Unity rebuild:
        // bridge.setFaceOnlyMode(!this.linkedMode);
    }

    setJobId(jobId: string): void {
        this.jobId = jobId;
    }

    setOnVertexUpdate(cb: VertexUpdateCallback): void {
        this.onVertexUpdate = cb;
    }

    /** Set linked mode: true = global deformation, false = face-only (skull doesn't move) */
    setLinkedMode(enabled: boolean): void {
        this.linkedMode = enabled;
        // Send face-only mode to Unity (face-only = !linked)
        if (this.unityBridge) {
            this.unityBridge.setFaceOnlyMode(!enabled);
        }
    }

    isLinkedMode(): boolean {
        return this.linkedMode;
    }

    /** Set the base FLAME shape params (from /api/face params.json) */
    setBaseShape(shape: number[]): void {
        this.baseShape = [...shape];
    }

    // --- Param management ---

    getParams(): SurgeryParams {
        return { ...this.currentParams };
    }

    defaultParams(): SurgeryParams {
        return {
            noseBridgeHeight: 0,
            noseBridgeWidth: 0,
            noseTipAngle: 0,
            noseWingWidth: 0,
            jawWidth: 0,
            jawAngle: 0,
            chinLength: 0,
            chinProjection: 0,
            eyeLidWidth: 0,
            eyeCorner: 0,
            lipVolume: 0,
            lipArch: 0,
        };
    }

    setParams(params: SurgeryParams): void {
        this.currentParams = { ...params };
    }

    // --- Undo/Redo ---

    pushHistory(): void {
        // Remove any forward history if we're not at the end
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ ...this.currentParams });
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
        this.historyIndex = this.history.length - 1;
    }

    undo(): SurgeryParams | null {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.currentParams = { ...this.history[this.historyIndex] };
            return this.getParams();
        }
        return null;
    }

    redo(): SurgeryParams | null {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.currentParams = { ...this.history[this.historyIndex] };
            return this.getParams();
        }
        return null;
    }

    get canUndo(): boolean {
        return this.historyIndex > 0;
    }

    get canRedo(): boolean {
        return this.historyIndex < this.history.length - 1;
    }

    // --- Deformation ---

    /**
     * Build per-region FLAME shape arrays for region-isolated deformation.
     * Each region gets its own independent shape array — only that region's
     * surgery params modify that array's PCA components. This prevents
     * cross-feature coupling.
     */
    private buildRegionShapeArrays(): Record<string, number[]> {
        const p = this.currentParams;

        // Each region starts from baseShape (unmodified)
        const nose = [...this.baseShape];
        const jaw = [...this.baseShape];
        const chin = [...this.baseShape];
        const eye = [...this.baseShape];
        const lip = [...this.baseShape];

        // --- Nose (only modifies nose shape) ---
        // Use stronger PCA components — region masking prevents cross-feature leak
        nose[0] += p.noseBridgeHeight * 0.8;   // PC0: strongest nose (global, but masked)
        nose[1] += p.noseBridgeHeight * 1.2;   // PC1: face height/nose vertical
        nose[7] += p.noseBridgeHeight * 2.0;
        nose[12] += p.noseBridgeHeight * 1.5;
        nose[2] += p.noseBridgeWidth * 1.2;
        nose[6] += p.noseBridgeWidth * 1.5;
        nose[3] += p.noseTipAngle * 1.5;
        nose[16] += p.noseTipAngle * 2.0;
        nose[12] += p.noseWingWidth * 2.0;
        nose[16] += p.noseWingWidth * 1.5;
        nose[6] += p.noseWingWidth * 0.8;

        // --- Jaw ---
        jaw[4] += p.jawWidth * 1.5;
        jaw[6] += p.jawWidth * 1.0;
        jaw[2] += p.jawWidth * 0.5;
        jaw[3] += p.jawAngle * 1.0;
        jaw[5] += p.jawAngle * 1.5;

        // --- Chin ---
        chin[1] += p.chinLength * 1.5;
        chin[3] += p.chinProjection * 1.5;

        // --- Eye ---
        eye[16] += p.eyeLidWidth * 1.5;
        eye[2] += p.eyeLidWidth * 0.5;
        eye[7] += p.eyeCorner * 1.0;
        eye[3] += p.eyeCorner * 0.8;

        // --- Lip ---
        lip[7] += p.lipVolume * 1.5;
        lip[5] += p.lipVolume * 1.0;
        lip[12] += p.lipArch * 1.5;
        lip[6] += p.lipArch * 0.8;

        return { nose, jaw, chin, eye, lip };
    }

    /**
     * Build combined shape array (legacy, for non-region deformation).
     */
    private buildShapeArray(): number[] {
        const shape = [...this.baseShape];
        const p = this.currentParams;

        shape[0] += p.noseBridgeHeight * 0.8;
        shape[1] += p.noseBridgeHeight * 1.2;
        shape[7] += p.noseBridgeHeight * 2.0;
        shape[12] += p.noseBridgeHeight * 1.5;
        shape[2] += p.noseBridgeWidth * 1.2;
        shape[6] += p.noseBridgeWidth * 1.5;
        shape[3] += p.noseTipAngle * 1.5;
        shape[16] += p.noseTipAngle * 2.0;
        shape[12] += p.noseWingWidth * 2.0;
        shape[16] += p.noseWingWidth * 1.5;
        shape[6] += p.noseWingWidth * 0.8;
        shape[4] += p.jawWidth * 1.5;
        shape[6] += p.jawWidth * 1.0;
        shape[2] += p.jawWidth * 0.5;
        shape[3] += p.jawAngle * 1.0;
        shape[5] += p.jawAngle * 1.5;
        shape[1] += p.chinLength * 1.5;
        shape[3] += p.chinProjection * 1.5;
        shape[16] += p.eyeLidWidth * 1.5;
        shape[2] += p.eyeLidWidth * 0.5;
        shape[7] += p.eyeCorner * 1.0;
        shape[3] += p.eyeCorner * 0.8;
        shape[7] += p.lipVolume * 1.5;
        shape[5] += p.lipVolume * 1.0;
        shape[12] += p.lipArch * 1.5;
        shape[6] += p.lipArch * 0.8;

        return shape;
    }

    /**
     * Request mesh deformation with current params.
     * Uses region-isolated shapes via Unity bridge, with fallback to legacy.
     * Throttled to avoid overwhelming Unity.
     */
    async deform(params?: SurgeryParams): Promise<void> {
        if (params) {
            this.currentParams = { ...params };
        }

        const now = Date.now();
        if (now - this.lastDeformTime < this.throttleMs) {
            if (!this.throttleTimer) {
                this.throttleTimer = window.setTimeout(() => {
                    this.throttleTimer = null;
                    this.executeDeform();
                }, this.throttleMs);
            }
            return;
        }

        await this.executeDeform();
    }

    private async executeDeform(): Promise<void> {
        this.lastDeformTime = Date.now();

        // Primary: direct vertex displacement via Unity bridge (no PCA)
        if (this.unityBridge) {
            const p = this.currentParams;
            this.unityBridge.applyDirectDeformation({
                noseBridgeHeight: p.noseBridgeHeight,
                noseBridgeWidth: p.noseBridgeWidth,
                noseTipAngle: p.noseTipAngle,
                noseWingWidth: p.noseWingWidth,
                jawWidth: p.jawWidth,
                jawAngle: p.jawAngle,
                chinLength: p.chinLength,
                chinProjection: p.chinProjection,
                eyeLidWidth: p.eyeLidWidth,
                eyeCorner: p.eyeCorner,
                lipVolume: p.lipVolume,
                lipArch: p.lipArch,
            });
            return;
        }

        // Fallback: legacy PCA server-side deformation
        if (!this.apiClient) {
            console.warn('[Deform] No Unity bridge or API client set');
            return;
        }

        try {
            const shapeArray = this.buildShapeArray();
            const result = await this.apiClient.deformFace(
                shapeArray, undefined, this.jobId || undefined
            );

            if (result.objText && this.onVertexUpdate) {
                this.onVertexUpdate(result.objText);
            }
        } catch (err) {
            console.error('[Deform] Deformation failed:', err);
        }
    }

    /** Cancel any pending deform requests */
    cancel(): void {
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }
        this.pendingParams = null;
        this.pendingRegionParams = null;
    }
}
