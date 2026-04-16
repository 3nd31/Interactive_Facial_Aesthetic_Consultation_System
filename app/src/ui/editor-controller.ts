/**
 * EditorController — Wires editor UI sliders ↔ DeformationEngine ↔ GaussianRenderer
 * Dual-mode: WebGPU (DeformationEngine) + Unity (UnityBridge)
 * Supports hand gesture sculpting via webcam
 */

import { DeformationEngine, SurgeryParams } from '../modules/deformation-engine';
import type { UnityBridge } from '../modules/unity-bridge';
import { HandTracker } from '../modules/hand-tracker';
import { GestureSculptController } from '../modules/gesture-sculpt-controller';
import { WebcamModule } from '../modules/webcam';

export type OnDeformCallback = (params: SurgeryParams) => void;

export class EditorController {
    private engine: DeformationEngine;
    private pageEl: HTMLElement;
    private onDeform: OnDeformCallback | null = null;
    private unityBridge: UnityBridge | null = null;
    private activeSurgery = 'nose';

    // Gesture sculpting
    private handTracker: HandTracker | null = null;
    private gestureSculpt: GestureSculptController | null = null;
    private webcam: WebcamModule | null = null;
    private gestureActive = false;
    private gestureRafId: number | null = null;
    private lastGestureDeformTime = 0;

    constructor(pageEl: HTMLElement) {
        this.engine = new DeformationEngine();
        this.pageEl = pageEl;
        this.engine.pushHistory(); // initial state

        this.setupSliderBindings();
        this.setupSurgeryPanel();
        this.setupToolbar();
        this.setupKeyboard();
    }

    setOnDeform(cb: OnDeformCallback): void {
        this.onDeform = cb;
    }

    getEngine(): DeformationEngine {
        return this.engine;
    }

    /** Connect Unity bridge for dual-mode rendering */
    setUnityBridge(bridge: UnityBridge): void {
        this.unityBridge = bridge;
    }

    private setupSliderBindings(): void {
        const sliders = this.pageEl.querySelectorAll<HTMLInputElement>(
            '.param-slider input[type="range"]'
        );

        sliders.forEach((slider) => {
            const param = slider.dataset.param;
            if (!param) return; // Skip sliders without data-param (e.g. skin tone)
            const unit = slider.dataset.unit || '';
            const scale = parseFloat(slider.dataset.scale || '1');
            const valueEl = this.pageEl.querySelector(`#val-${param}`) as HTMLElement;

            const updateParam = () => {
                const val = parseInt(slider.value) * scale;
                if (valueEl) valueEl.textContent = `${val.toFixed(1)} ${unit}`;

                // Map slider param name to engine param key
                const params = this.engine.getParams();
                const mappedValue = parseInt(slider.value) * scale;
                this.mapSliderToParam(param, mappedValue, params);

                // Send to WebGPU path
                this.onDeform?.(params);

                // Unity deformation is handled via onDeform → engine.deform() → unityBridge
                // (no direct setSurgeryParam needed)
            };

            slider.addEventListener('input', updateParam);

            // Double-click to reset individual slider
            slider.addEventListener('dblclick', () => {
                slider.value = '0';
                updateParam();
                this.engine.pushHistory();
            });

            // Mouse up = commit to history
            slider.addEventListener('mouseup', () => {
                this.engine.pushHistory();
                this.updateToolbarState();
            });
        });
    }

    private mapSliderToParam(sliderName: string, value: number, params: SurgeryParams): void {
        switch (sliderName) {
            case 'nose-bridge': params.noseBridgeHeight = value; break;
            case 'nose-width': params.noseBridgeWidth = value; break;
            case 'nose-tip': params.noseTipAngle = value; break;
            case 'nose-wing': params.noseWingWidth = value; break;
            case 'jaw-width': params.jawWidth = value; break;
            case 'jaw-angle': params.jawAngle = value; break;
            case 'chin-length': params.chinLength = value; break;
            case 'chin-proj': params.chinProjection = value; break;
            case 'eye-lid': params.eyeLidWidth = value; break;
            case 'eye-corner': params.eyeCorner = value; break;
            case 'lip-volume': params.lipVolume = value; break;
            case 'lip-arch': params.lipArch = value; break;
        }
    }

    private setupSurgeryPanel(): void {
        const items = this.pageEl.querySelectorAll('.nav-item');
        items.forEach((item) => {
            item.addEventListener('click', () => {
                items.forEach((i) => i.classList.remove('active'));
                item.classList.add('active');
                this.activeSurgery = (item as HTMLElement).dataset.surgery || 'nose';
                this.switchParamPanel(this.activeSurgery);
            });
        });
    }

    private switchParamPanel(surgery: string): void {
        const sections = this.pageEl.querySelectorAll('.param-group');
        sections.forEach((s) => (s as HTMLElement).style.display = 'none');
        const target = this.pageEl.querySelector(`#params-${surgery}`);
        if (target) (target as HTMLElement).style.display = 'block';
    }

    private setupToolbar(): void {
        // Undo
        this.pageEl.querySelector('#btn-undo')?.addEventListener('click', () => {
            const params = this.engine.undo();
            if (params) {
                this.syncSlidersToParams(params);
                this.onDeform?.(params);
            }
            this.updateToolbarState();
        });

        // Redo
        this.pageEl.querySelector('#btn-redo')?.addEventListener('click', () => {
            const params = this.engine.redo();
            if (params) {
                this.syncSlidersToParams(params);
                this.onDeform?.(params);
            }
            this.updateToolbarState();
        });

        // Reset
        this.pageEl.querySelector('#btn-reset')?.addEventListener('click', () => {
            const params = this.engine.defaultParams();
            this.syncSlidersToParams(params);
            this.onDeform?.(params);
            this.engine.pushHistory();
            this.updateToolbarState();
        });

        // Preset chips (surgery)
        const presetBtns = this.pageEl.querySelectorAll('.preset-chip[data-preset]');
        presetBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                presetBtns.forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                const preset = (btn as HTMLElement).dataset.preset || 'natural';
                this.applyPreset(preset);
            });
        });

        // Hair style chips
        const hairBtns = this.pageEl.querySelectorAll('.preset-chip[data-hair]');
        hairBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                hairBtns.forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                const style = (btn as HTMLElement).dataset.hair || 'medium';
                this.unityBridge?.setHairStyle(style);
            });
        });

        // Skin tone sliders — brightness, warmth, redness → RGB tint
        const skinSliders = ['skin-brightness', 'skin-warmth', 'skin-redness'];
        const updateSkinColor = () => {
            const brightness = parseInt((this.pageEl.querySelector('#skin-brightness') as HTMLInputElement)?.value || '100') / 100;
            const warmth = parseInt((this.pageEl.querySelector('#skin-warmth') as HTMLInputElement)?.value || '0') / 100;
            const redness = parseInt((this.pageEl.querySelector('#skin-redness') as HTMLInputElement)?.value || '0') / 100;

            // Compute RGB tint
            const r = Math.min(1.4, Math.max(0.3, brightness + warmth * 0.3 + redness * 0.2));
            const g = Math.min(1.4, Math.max(0.3, brightness - warmth * 0.1 - redness * 0.05));
            const b = Math.min(1.4, Math.max(0.3, brightness - warmth * 0.25 - redness * 0.1));

            this.unityBridge?.setSkinColor(r, g, b);
        };

        skinSliders.forEach(id => {
            const slider = this.pageEl.querySelector(`#${id}`) as HTMLInputElement;
            if (!slider) return;
            slider.addEventListener('input', () => {
                // Update display value
                const valEl = this.pageEl.querySelector(`#val-${id}`) as HTMLElement;
                if (valEl) {
                    if (id === 'skin-brightness') valEl.textContent = `${slider.value}%`;
                    else valEl.textContent = slider.value;
                }
                updateSkinColor();
            });
        });

        // Gesture sculpt toggle — hand tracking directly controls face model
        this.pageEl.querySelector('#btn-gesture')?.addEventListener('click', () => {
            if (this.gestureActive) {
                this.disableGestureSculpt();
            } else {
                this.enableGestureSculpt();
            }
        });
    }

    // === Gesture Sculpting — Hand directly controls face model ===

    private async enableGestureSculpt(): Promise<void> {
        const btn = this.pageEl.querySelector('#btn-gesture');
        const camContainer = this.pageEl.querySelector('#gesture-cam') as HTMLElement;
        const statusEl = this.pageEl.querySelector('#gesture-status') as HTMLElement;
        if (!camContainer) return;

        try {
            // Show camera feed filling the entire viewport area (behind the 3D model)
            const viewport = this.pageEl.querySelector('#editor-viewport') as HTMLElement;
            camContainer.style.display = 'block';
            camContainer.style.position = 'absolute';
            camContainer.style.left = '0';
            camContainer.style.top = '0';
            camContainer.style.width = '100%';
            camContainer.style.height = '100%';
            camContainer.style.zIndex = '1';
            camContainer.style.borderRadius = '0';
            camContainer.style.overflow = 'hidden';
            camContainer.style.boxShadow = 'none';
            camContainer.style.background = 'transparent';

            btn?.classList.add('gesture-active');
            if (statusEl) statusEl.textContent = '加载手部模型...';

            // Start webcam (video hidden — only used for hand tracking input)
            this.webcam = new WebcamModule({ width: 640, height: 480, frameRate: 30 });
            const video = await this.webcam.start(camContainer);
            // Hide the real camera feed — only show hand landmark skeleton
            video.style.display = 'none';

            // Make the canvas fill the viewport for drawing hand keypoints
            const canvas = camContainer.querySelector('#gesture-cam-canvas') as HTMLCanvasElement;
            if (canvas) {
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.position = 'absolute';
                canvas.style.left = '0';
                canvas.style.top = '0';
            }

            // Initialize hand tracker
            this.handTracker = new HandTracker();
            await this.handTracker.initialize();

            // Initialize gesture controller — maps hand movements to face params
            this.gestureSculpt = new GestureSculptController();
            this.gestureSculpt.setOnGesture((event) => {
                if (event.type === 'drag') {
                    // Throttle deformation to max 15 FPS during gesture drag
                    const now = performance.now();
                    if (now - this.lastGestureDeformTime < 67) return;
                    this.lastGestureDeformTime = now;

                    const gestureParams = this.gestureSculpt!.getGestureParams();
                    const currentParams = this.engine.getParams();
                    const merged: SurgeryParams = { ...currentParams };
                    for (const key of Object.keys(gestureParams) as (keyof SurgeryParams)[]) {
                        merged[key] = currentParams[key] + gestureParams[key];
                    }
                    this.onDeform?.(merged);
                    this.syncSlidersToParams(merged);
                }
                if (event.type === 'pinch-end') {
                    // Commit gesture changes to engine history
                    const gestureParams = this.gestureSculpt!.getGestureParams();
                    const currentParams = this.engine.getParams();
                    for (const key of Object.keys(gestureParams) as (keyof SurgeryParams)[]) {
                        currentParams[key] += gestureParams[key];
                    }
                    this.engine.setParams(currentParams);
                    this.engine.pushHistory();
                }
            });

            this.gestureActive = true;
            if (statusEl) statusEl.textContent = '就绪 ✋ 捏合拖动控制人脸';
            console.log('[EditorController] Gesture sculpt enabled — hand controls face model');

            // Start tracking loop
            this.runGestureLoop(video);
        } catch (err) {
            console.error('[EditorController] Gesture sculpt failed:', err);
            if (statusEl) statusEl.textContent = '启动失败';
            this.disableGestureSculpt();
        }
    }

    private disableGestureSculpt(): void {
        const btn = this.pageEl.querySelector('#btn-gesture');
        const camContainer = this.pageEl.querySelector('#gesture-cam') as HTMLElement;

        if (this.gestureRafId !== null) {
            cancelAnimationFrame(this.gestureRafId);
            this.gestureRafId = null;
        }
        this.webcam?.stop();
        this.webcam = null;
        this.handTracker?.dispose();
        this.handTracker = null;
        this.gestureSculpt?.reset();
        this.gestureSculpt = null;
        this.gestureActive = false;

        btn?.classList.remove('gesture-active');
        if (camContainer) {
            camContainer.style.display = 'none';
            camContainer.style.position = '';
            camContainer.style.left = '';
            camContainer.style.top = '';
            camContainer.style.bottom = '';
            camContainer.style.width = '';
            camContainer.style.height = '';
            camContainer.style.zIndex = '';
            camContainer.style.borderRadius = '';
            camContainer.style.overflow = '';
            camContainer.style.boxShadow = '';
            camContainer.style.background = '';
        }
        console.log('[EditorController] Gesture sculpt disabled');
    }

    private runGestureLoop(video: HTMLVideoElement): void {
        const canvas = this.pageEl.querySelector('#gesture-cam-canvas') as HTMLCanvasElement;
        const statusEl = this.pageEl.querySelector('#gesture-status') as HTMLElement;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const loop = () => {
            if (!this.gestureActive || !this.handTracker?.isReady) {
                this.gestureRafId = requestAnimationFrame(loop);
                return;
            }

            // Set canvas size to match video
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const result = this.handTracker.detect(video, performance.now());

            if (result) {
                // Process gesture
                this.gestureSculpt?.processFrame(result);
                const isPinching = this.gestureSculpt?.getState() !== 'IDLE';

                // Draw hand skeleton
                this.handTracker.drawDebug(ctx, result, canvas.width, canvas.height, isPinching);

                if (statusEl) {
                    const state = this.gestureSculpt?.getState() || 'IDLE';
                    statusEl.textContent = state === 'IDLE' ? '就绪 ✋' :
                        state === 'PINCH' ? '捏合 ✊' : '拖动 🤏';
                }
            } else {
                if (statusEl) statusEl.textContent = `识别中... FPS:${this.handTracker.currentFps}`;
            }

            this.gestureRafId = requestAnimationFrame(loop);
        };

        this.gestureRafId = requestAnimationFrame(loop);
    }

    private setupKeyboard(): void {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                const params = this.engine.undo();
                if (params) {
                    this.syncSlidersToParams(params);
                    this.onDeform?.(params);
                }
                this.updateToolbarState();
            }
            if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                const params = this.engine.redo();
                if (params) {
                    this.syncSlidersToParams(params);
                    this.onDeform?.(params);
                }
                this.updateToolbarState();
            }
        });
    }

    private updateToolbarState(): void {
        const undoBtn = this.pageEl.querySelector('#btn-undo') as HTMLButtonElement;
        const redoBtn = this.pageEl.querySelector('#btn-redo') as HTMLButtonElement;
        if (undoBtn) undoBtn.style.opacity = this.engine.canUndo ? '1' : '0.3';
        if (redoBtn) redoBtn.style.opacity = this.engine.canRedo ? '1' : '0.3';
    }

    private syncSlidersToParams(params: SurgeryParams): void {
        const mappings: [string, number, number][] = [
            ['nose-bridge', params.noseBridgeHeight, 10],
            ['nose-width', params.noseBridgeWidth, 10],
            ['nose-tip', params.noseTipAngle, 10],
            ['nose-wing', params.noseWingWidth, 10],
        ];

        for (const [name, value, scale] of mappings) {
            const slider = this.pageEl.querySelector<HTMLInputElement>(`input[data-param="${name}"]`);
            if (slider) {
                slider.value = String(Math.round(value / (1 / scale)));
                slider.dispatchEvent(new Event('input'));
            }
        }
    }

    private applyPreset(preset: string): void {
        const presets: Record<string, Partial<SurgeryParams>> = {
            natural: { noseBridgeHeight: 1.5, noseBridgeWidth: -0.5, noseTipAngle: 3, noseWingWidth: -1 },
            tall: { noseBridgeHeight: 3.5, noseBridgeWidth: -1, noseTipAngle: 5, noseWingWidth: -2 },
            european: { noseBridgeHeight: 4.5, noseBridgeWidth: -1.5, noseTipAngle: 8, noseWingWidth: -3 },
            korean: { noseBridgeHeight: 2.5, noseBridgeWidth: -0.8, noseTipAngle: 2, noseWingWidth: -1.5 },
        };

        const vals = presets[preset];
        if (!vals) return;

        const params = { ...this.engine.getParams(), ...vals };
        this.syncSlidersToParams(params);
        this.onDeform?.(params);
        this.engine.pushHistory();
        this.updateToolbarState();
    }
}
