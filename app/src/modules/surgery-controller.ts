/**
 * SurgeryController — Maps semantic surgery operations to FLAME shape parameters
 * 
 * FLAME has 200 shape parameters. This module maps intuitive surgical concepts
 * (nose bridge height, jaw width, chin shape) to specific parameter combinations.
 * 
 * Architecture:
 *   User drags slider → SurgeryController.setParam() 
 *     → updates shape_params[] → POST /api/deform (22ms)
 *     → new vertices → update mesh
 */

export interface SurgeryRegion {
    id: string;
    name: string;
    nameZh: string;
    icon: string;
    params: SurgeryParam[];
}

export interface SurgeryParam {
    id: string;
    name: string;
    nameZh: string;
    min: number;
    max: number;
    default: number;
    value: number;
    // Which FLAME shape indices this param affects, with weights
    flameMapping: { index: number; weight: number }[];
}

export interface SurgeryPreset {
    id: string;
    name: string;
    nameZh: string;
    icon: string;
    values: Record<string, number>; // paramId → value
}

export type DeformCallback = (shapeParams: number[]) => Promise<void>;
export type RegionDeformCallback = (regionData: Record<string, number[]>) => Promise<void>;

export class SurgeryController {
    private regions: SurgeryRegion[] = [];
    private presets: SurgeryPreset[] = [];
    private baseShapeParams: number[] = new Array(200).fill(0);
    private currentShapeParams: number[] = new Array(200).fill(0);
    private undoStack: number[][] = [];
    private redoStack: number[][] = [];
    private maxUndoSteps = 50;
    private onDeform: DeformCallback | null = null;
    private onRegionDeform: RegionDeformCallback | null = null;
    private symmetryEnabled = true;
    private linkedMode = false; // false = independent (region-isolated), true = linked (global)

    constructor() {
        this.initRegions();
        this.initPresets();
    }

    // --- Region & Parameter Definitions ---
    // FLAME shape param indices are empirically mapped to facial features.
    // These mappings approximate the semantic meaning of PCA components.

    private initRegions(): void {
        this.regions = [
            {
                id: 'nose', name: 'Nose', nameZh: '鼻部', icon: '👃',
                params: [
                    {
                        id: 'nose-bridge-height', name: 'Bridge Height', nameZh: '鼻梁高度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 0, weight: 0.8 }, { index: 5, weight: 0.3 }]
                    },
                    {
                        id: 'nose-tip-up', name: 'Tip Upward', nameZh: '鼻尖上翘',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 1, weight: 0.6 }, { index: 12, weight: 0.4 }]
                    },
                    {
                        id: 'nose-width', name: 'Width', nameZh: '鼻翼宽度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 3, weight: 0.7 }, { index: 8, weight: 0.3 }]
                    },
                    {
                        id: 'nose-length', name: 'Length', nameZh: '鼻部长度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 2, weight: 0.5 }, { index: 6, weight: 0.5 }]
                    },
                ],
            },
            {
                id: 'jaw', name: 'Jawline', nameZh: '下颌线', icon: '🫧',
                params: [
                    {
                        id: 'jaw-width', name: 'Jaw Width', nameZh: '下颌宽度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 4, weight: 0.9 }, { index: 15, weight: 0.2 }]
                    },
                    {
                        id: 'jaw-angle', name: 'Jaw Angle', nameZh: '下颌角度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 7, weight: 0.7 }, { index: 18, weight: 0.3 }]
                    },
                    {
                        id: 'jaw-sharpness', name: 'Sharpness', nameZh: '下颌锐度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 9, weight: 0.6 }, { index: 20, weight: 0.4 }]
                    },
                ],
            },
            {
                id: 'chin', name: 'Chin', nameZh: '下巴', icon: '🔻',
                params: [
                    {
                        id: 'chin-length', name: 'Length', nameZh: '下巴长度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 10, weight: 0.8 }, { index: 22, weight: 0.3 }]
                    },
                    {
                        id: 'chin-protrusion', name: 'Protrusion', nameZh: '下巴前突',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 11, weight: 0.7 }, { index: 25, weight: 0.3 }]
                    },
                    {
                        id: 'chin-width', name: 'Width', nameZh: '下巴宽度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 13, weight: 0.6 }, { index: 28, weight: 0.4 }]
                    },
                ],
            },
            {
                id: 'cheek', name: 'Cheekbone', nameZh: '颧骨', icon: '✨',
                params: [
                    {
                        id: 'cheek-height', name: 'Height', nameZh: '颧骨高度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 14, weight: 0.7 }, { index: 30, weight: 0.3 }]
                    },
                    {
                        id: 'cheek-width', name: 'Width', nameZh: '颧骨宽度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 16, weight: 0.8 }]
                    },
                    {
                        id: 'cheek-fullness', name: 'Fullness', nameZh: '面颊丰满',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 17, weight: 0.6 }, { index: 32, weight: 0.4 }]
                    },
                ],
            },
            {
                id: 'forehead', name: 'Forehead', nameZh: '额头', icon: '🧠',
                params: [
                    {
                        id: 'forehead-height', name: 'Height', nameZh: '额头高度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 19, weight: 0.7 }, { index: 35, weight: 0.3 }]
                    },
                    {
                        id: 'forehead-width', name: 'Width', nameZh: '额头宽度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 21, weight: 0.8 }]
                    },
                ],
            },
            {
                id: 'eye', name: 'Eye Area', nameZh: '眼部', icon: '👁️',
                params: [
                    {
                        id: 'eye-size', name: 'Eye Size', nameZh: '眼睛大小',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 23, weight: 0.6 }, { index: 38, weight: 0.4 }]
                    },
                    {
                        id: 'eye-spacing', name: 'Spacing', nameZh: '眼间距',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 24, weight: 0.7 }]
                    },
                    {
                        id: 'eye-tilt', name: 'Tilt', nameZh: '眼角倾斜',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 26, weight: 0.5 }, { index: 40, weight: 0.5 }]
                    },
                ],
            },
            {
                id: 'lip', name: 'Lips', nameZh: '唇部', icon: '💋',
                params: [
                    {
                        id: 'lip-fullness', name: 'Fullness', nameZh: '唇部丰满',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 27, weight: 0.7 }, { index: 42, weight: 0.3 }]
                    },
                    {
                        id: 'lip-width', name: 'Width', nameZh: '嘴唇宽度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 29, weight: 0.6 }]
                    },
                    {
                        id: 'lip-cupid-bow', name: "Cupid's Bow", nameZh: '唇弓弧度',
                        min: -2, max: 2, default: 0, value: 0,
                        flameMapping: [{ index: 31, weight: 0.5 }, { index: 45, weight: 0.5 }]
                    },
                ],
            },
        ];
    }

    private initPresets(): void {
        this.presets = [
            {
                id: 'korean-nose', name: 'Korean Style Nose', nameZh: '韩式美鼻', icon: '🇰🇷',
                values: {
                    'nose-bridge-height': 1.2,
                    'nose-tip-up': 0.6,
                    'nose-width': -0.8,
                    'nose-length': -0.3,
                },
            },
            {
                id: 'natural-nose', name: 'Natural Nose', nameZh: '自然款鼻型', icon: '🌿',
                values: {
                    'nose-bridge-height': 0.5,
                    'nose-tip-up': 0.2,
                    'nose-width': -0.3,
                    'nose-length': 0,
                },
            },
            {
                id: 'v-line-jaw', name: 'V-Line Jawline', nameZh: 'V脸线条', icon: '💎',
                values: {
                    'jaw-width': -1.5,
                    'jaw-angle': -0.8,
                    'jaw-sharpness': 1.0,
                    'chin-length': 0.3,
                    'chin-width': -0.8,
                },
            },
            {
                id: 'baby-face', name: 'Baby Face', nameZh: '减龄幼态', icon: '👶',
                values: {
                    'cheek-fullness': 0.8,
                    'chin-length': -0.5,
                    'jaw-width': -0.6,
                    'eye-size': 0.7,
                    'forehead-height': -0.3,
                },
            },
            {
                id: 'sharp-contour', name: 'Sharp Contour', nameZh: '立体轮廓', icon: '🗿',
                values: {
                    'nose-bridge-height': 1.0,
                    'cheek-height': 0.8,
                    'jaw-sharpness': 0.6,
                    'chin-protrusion': 0.4,
                    'forehead-width': -0.3,
                },
            },
            {
                id: 'soft-feminine', name: 'Soft Feminine', nameZh: '柔美女性化', icon: '🌸',
                values: {
                    'jaw-width': -1.0,
                    'chin-width': -0.6,
                    'cheek-fullness': 0.4,
                    'lip-fullness': 0.5,
                    'eye-size': 0.4,
                    'forehead-height': 0.3,
                },
            },
            {
                id: 'masculine', name: 'Masculine', nameZh: '阳刚硬朗', icon: '💪',
                values: {
                    'jaw-width': 0.6,
                    'jaw-angle': 0.5,
                    'chin-protrusion': 0.5,
                    'cheek-height': 0.4,
                    'nose-bridge-height': 0.8,
                    'forehead-width': 0.4,
                },
            },
        ];
    }

    // --- Public API ---

    setDeformCallback(cb: DeformCallback): void {
        this.onDeform = cb;
    }

    setRegionDeformCallback(cb: RegionDeformCallback): void {
        this.onRegionDeform = cb;
    }

    setLinkedMode(enabled: boolean): void {
        this.linkedMode = enabled;
    }

    isLinkedMode(): boolean {
        return this.linkedMode;
    }

    setBaseParams(params: number[]): void {
        this.baseShapeParams = [...params];
        this.currentShapeParams = [...params];
    }

    getRegions(): SurgeryRegion[] {
        return this.regions;
    }

    getPresets(): SurgeryPreset[] {
        return this.presets;
    }

    getParam(paramId: string): SurgeryParam | undefined {
        for (const region of this.regions) {
            const param = region.params.find(p => p.id === paramId);
            if (param) return param;
        }
        return undefined;
    }

    getCurrentShapeParams(): number[] {
        return [...this.currentShapeParams];
    }

    /** Set a single surgery parameter and trigger deform */
    async setParam(paramId: string, value: number): Promise<void> {
        const param = this.getParam(paramId);
        if (!param) return;

        // Save undo state
        this.pushUndo();

        // Clamp value
        param.value = Math.max(param.min, Math.min(param.max, value));

        // Rebuild shape params from all current parameter values
        this.rebuildShapeParams();

        // Trigger deform
        await this.triggerDeform();
    }

    /** Apply a preset (overrides specific params, keeps others) */
    async applyPreset(presetId: string): Promise<void> {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset) return;

        this.pushUndo();

        for (const [paramId, value] of Object.entries(preset.values)) {
            const param = this.getParam(paramId);
            if (param) {
                param.value = Math.max(param.min, Math.min(param.max, value));
            }
        }

        this.rebuildShapeParams();
        await this.triggerDeform();
    }

    /** Reset all parameters to default */
    async reset(): Promise<void> {
        this.pushUndo();

        for (const region of this.regions) {
            for (const param of region.params) {
                param.value = param.default;
            }
        }

        this.currentShapeParams = [...this.baseShapeParams];
        await this.triggerDeform();
    }

    // --- Undo / Redo ---

    async undo(): Promise<void> {
        if (this.undoStack.length === 0) return;
        this.redoStack.push([...this.currentShapeParams]);
        this.currentShapeParams = this.undoStack.pop()!;
        this.syncParamValuesFromShape();
        await this.triggerDeform();
    }

    async redo(): Promise<void> {
        if (this.redoStack.length === 0) return;
        this.undoStack.push([...this.currentShapeParams]);
        this.currentShapeParams = this.redoStack.pop()!;
        this.syncParamValuesFromShape();
        await this.triggerDeform();
    }

    canUndo(): boolean { return this.undoStack.length > 0; }
    canRedo(): boolean { return this.redoStack.length > 0; }

    // --- Gesture Sculpting ---
    // Maps pixel drag on face mesh to FLAME param adjustments
    // The "keyword" from hand interaction translates to shape param changes

    /**
     * Gesture sculpt: drag on face region → adjust closest FLAME param
     * @param regionId - which face region (nose/jaw/chin/etc)
     * @param deltaX - horizontal drag amount (-1 to 1, normalized)
     * @param deltaY - vertical drag amount (-1 to 1, normalized)  
     * @param mode - 'push' (drag normal) | 'smooth' (Shift+drag) | 'flatten'
     */
    async gestureSculpt(
        regionId: string,
        deltaX: number,
        deltaY: number,
        mode: 'push' | 'smooth' | 'flatten' = 'push'
    ): Promise<void> {
        const region = this.regions.find(r => r.id === regionId);
        if (!region) return;

        const sensitivity = mode === 'smooth' ? 0.3 : mode === 'flatten' ? 0.1 : 1.0;

        // Map drag direction to param changes based on region
        for (const param of region.params) {
            let delta = 0;
            // Vertical drag typically maps to primary axis (height/length)
            if (param.id.includes('height') || param.id.includes('length') || param.id.includes('up') || param.id.includes('size')) {
                delta = -deltaY * sensitivity * 2;
            }
            // Horizontal drag maps to width/spacing
            else if (param.id.includes('width') || param.id.includes('spacing')) {
                delta = deltaX * sensitivity * 2;
            }
            // Diagonal/other
            else {
                delta = (-deltaY + deltaX) * 0.5 * sensitivity * 2;
            }

            if (Math.abs(delta) > 0.01) {
                param.value = Math.max(param.min, Math.min(param.max, param.value + delta));
            }
        }

        this.rebuildShapeParams();
        await this.triggerDeform();
    }

    /** Start a gesture sculpt (saves undo state) */
    gestureStart(): void {
        this.pushUndo();
    }

    // --- Symmetry ---

    setSymmetry(enabled: boolean): void {
        this.symmetryEnabled = enabled;
    }

    isSymmetryEnabled(): boolean {
        return this.symmetryEnabled;
    }

    // --- Internals ---

    private pushUndo(): void {
        this.undoStack.push([...this.currentShapeParams]);
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
        this.redoStack = []; // Clear redo on new action
    }

    private rebuildShapeParams(): void {
        // Start from base params
        this.currentShapeParams = [...this.baseShapeParams];

        // Apply all surgery param contributions
        for (const region of this.regions) {
            for (const param of region.params) {
                if (param.value !== param.default) {
                    const delta = param.value - param.default;
                    for (const mapping of param.flameMapping) {
                        this.currentShapeParams[mapping.index] += delta * mapping.weight;
                    }
                }
            }
        }
    }

    /** Reverse-sync: from shape params back to UI param values (after undo) */
    private syncParamValuesFromShape(): void {
        // Approximate: set each param based on its primary FLAME index
        for (const region of this.regions) {
            for (const param of region.params) {
                if (param.flameMapping.length > 0) {
                    const primaryMapping = param.flameMapping[0];
                    const shapeVal = this.currentShapeParams[primaryMapping.index] - this.baseShapeParams[primaryMapping.index];
                    param.value = Math.max(param.min, Math.min(param.max,
                        param.default + shapeVal / primaryMapping.weight
                    ));
                }
            }
        }
    }

    private async triggerDeform(): Promise<void> {
        if (this.linkedMode) {
            // Linked mode: global deformation (whole face moves together)
            if (this.onDeform) {
                await this.onDeform(this.currentShapeParams);
            }
        } else {
            // Independent mode: per-region isolated deformation
            if (this.onRegionDeform) {
                const regionData = this.buildRegionShapeArrays();
                await this.onRegionDeform(regionData);
            } else if (this.onDeform) {
                // Fallback to global if no region callback set
                await this.onDeform(this.currentShapeParams);
            }
        }
    }

    /**
     * Build per-region shape parameter arrays for region-isolated deformation.
     * Each region gets its own 200-dim array containing only that region's contribution.
     */
    private buildRegionShapeArrays(): Record<string, number[]> {
        const result: Record<string, number[]> = {};

        for (const region of this.regions) {
            const regionParams = new Array(200).fill(0);
            let hasNonZero = false;

            for (const param of region.params) {
                if (param.value !== param.default) {
                    const delta = param.value - param.default;
                    for (const mapping of param.flameMapping) {
                        regionParams[mapping.index] += delta * mapping.weight;
                        hasNonZero = true;
                    }
                }
            }

            if (hasNonZero) {
                result[region.id] = regionParams;
            }
        }

        return result;
    }

    // --- Serialization ---

    toJSON(): object {
        const paramValues: Record<string, number> = {};
        for (const region of this.regions) {
            for (const param of region.params) {
                if (param.value !== param.default) {
                    paramValues[param.id] = param.value;
                }
            }
        }
        return {
            shapeParams: this.currentShapeParams,
            paramValues,
            symmetry: this.symmetryEnabled,
        };
    }

    fromJSON(data: any): void {
        if (data.shapeParams) {
            this.currentShapeParams = [...data.shapeParams];
        }
        if (data.paramValues) {
            for (const [paramId, value] of Object.entries(data.paramValues)) {
                const param = this.getParam(paramId);
                if (param) param.value = value as number;
            }
        }
        if (data.symmetry !== undefined) {
            this.symmetryEnabled = data.symmetry;
        }
    }
}
