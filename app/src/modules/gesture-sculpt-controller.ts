/**
 * GestureSculptController — Maps hand gestures to face deformation
 * 
 * State machine: IDLE → PINCH → DRAG → RELEASE
 * 
 * When user pinches (thumb+index close), it selects a face region based
 * on the hand's screen position. Dragging while pinching applies
 * deformation deltas to the DeformationEngine.
 */

import { HandTrackingResult, HAND } from './hand-tracker';
import type { SurgeryParams } from './deformation-engine';

// Gesture states
type GestureState = 'IDLE' | 'PINCH' | 'DRAG';

// Face region that the gesture targets
type FaceRegion = 'nose' | 'jaw' | 'eye' | 'lip' | 'forehead' | 'cheek';

export interface GestureSculptConfig {
    pinchThreshold: number;       // Normalized distance to trigger pinch (0-1)
    releaseThreshold: number;     // Normalized distance to release pinch
    dragSensitivity: number;      // How much drag translates to param change
    minDragDistance: number;       // Minimum drag before applying deformation
}

export interface GestureEvent {
    type: 'pinch-start' | 'drag' | 'pinch-end';
    region: FaceRegion;
    deltaX: number;   // Normalized drag delta (-1 to 1)
    deltaY: number;
    position: { x: number; y: number }; // Pinch midpoint (0-1)
}

const DEFAULT_CONFIG: GestureSculptConfig = {
    pinchThreshold: 0.06,
    releaseThreshold: 0.08,
    dragSensitivity: 8.0,
    minDragDistance: 0.005,
};

// Map face regions to surgery param keys
const REGION_PARAMS: Record<FaceRegion, (keyof SurgeryParams)[]> = {
    nose: ['noseBridgeHeight', 'noseBridgeWidth', 'noseWingWidth', 'noseTipAngle'],
    jaw: ['jawWidth', 'jawAngle'],
    eye: ['eyeLidWidth', 'eyeCorner'],
    lip: ['lipVolume', 'lipArch'],
    forehead: ['eyeLidWidth', 'eyeCorner'],   // forehead drags affect brow/eye area
    cheek: ['jawWidth', 'jawAngle'],           // cheek changes are jaw operations in FLAME
};

export class GestureSculptController {
    private config: GestureSculptConfig;
    private state: GestureState = 'IDLE';
    private pinchRegion: FaceRegion = 'nose';
    private pinchStartPos: { x: number; y: number } = { x: 0, y: 0 };
    private lastPinchPos: { x: number; y: number } = { x: 0, y: 0 };
    private onGesture: ((event: GestureEvent) => void) | null = null;

    // Accumulated params from gesture drag
    private gestureParams: SurgeryParams = this.emptyParams();

    constructor(config: Partial<GestureSculptConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    setOnGesture(callback: (event: GestureEvent) => void): void {
        this.onGesture = callback;
    }

    getState(): GestureState {
        return this.state;
    }

    getGestureParams(): SurgeryParams {
        return { ...this.gestureParams };
    }

    /**
     * Process a hand tracking frame and emit gesture events
     */
    processFrame(hand: HandTrackingResult): void {
        const thumb = hand.landmarks[HAND.THUMB_TIP];
        const index = hand.landmarks[HAND.INDEX_TIP];

        // Calculate pinch distance (normalized)
        const dx = thumb.x - index.x;
        const dy = thumb.y - index.y;
        const pinchDist = Math.sqrt(dx * dx + dy * dy);

        // Pinch midpoint
        const midX = (thumb.x + index.x) / 2;
        const midY = (thumb.y + index.y) / 2;

        const isPinching = pinchDist < this.config.pinchThreshold;
        const isReleased = pinchDist > this.config.releaseThreshold;

        switch (this.state) {
            case 'IDLE':
                if (isPinching) {
                    this.state = 'PINCH';
                    this.pinchRegion = this.detectRegion(midX, midY);
                    this.pinchStartPos = { x: midX, y: midY };
                    this.lastPinchPos = { x: midX, y: midY };
                    this.gestureParams = this.emptyParams();

                    this.emitEvent({
                        type: 'pinch-start',
                        region: this.pinchRegion,
                        deltaX: 0,
                        deltaY: 0,
                        position: { x: midX, y: midY },
                    });
                }
                break;

            case 'PINCH':
            case 'DRAG': {
                if (isReleased) {
                    // Release
                    this.emitEvent({
                        type: 'pinch-end',
                        region: this.pinchRegion,
                        deltaX: 0,
                        deltaY: 0,
                        position: { x: midX, y: midY },
                    });
                    this.state = 'IDLE';
                    break;
                }

                // Calculate drag delta from last frame
                const dragDx = midX - this.lastPinchPos.x;
                const dragDy = midY - this.lastPinchPos.y;
                const dragDist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);

                if (dragDist > this.config.minDragDistance) {
                    this.state = 'DRAG';

                    // Apply delta to gesture params
                    this.applyDelta(this.pinchRegion, dragDx, dragDy);

                    this.emitEvent({
                        type: 'drag',
                        region: this.pinchRegion,
                        deltaX: dragDx,
                        deltaY: dragDy,
                        position: { x: midX, y: midY },
                    });

                    this.lastPinchPos = { x: midX, y: midY };
                }
                break;
            }
        }
    }

    /**
     * Detect which face region the gesture is targeting
     * Based on screen position (webcam is mirrored, so left/right are flipped)
     */
    private detectRegion(x: number, y: number): FaceRegion {
        // Check left/right edges first for cheek (any Y)
        if (x < 0.25 || x > 0.75) return 'cheek';

        // Y zones for center of frame (top to bottom)
        if (y < 0.25) return 'forehead';
        if (y < 0.40) return 'eye';
        if (y < 0.55) return 'nose';
        if (y < 0.70) return 'lip';
        return 'jaw';
    }

    /**
     * Apply drag delta to surgery params based on region
     * Vertical drag = primary param (height/length/volume)
     * Horizontal drag = secondary param (width/angle)
     */
    private applyDelta(region: FaceRegion, dx: number, dy: number): void {
        const sens = this.config.dragSensitivity;
        const params = REGION_PARAMS[region];
        if (!params || params.length === 0) return;

        // Primary param: vertical drag
        const primaryKey = params[0];
        (this.gestureParams as any)[primaryKey] += -dy * sens;

        // Secondary param: horizontal drag (if available)
        if (params.length > 1) {
            const secondaryKey = params[1];
            (this.gestureParams as any)[secondaryKey] += dx * sens;
        }
    }

    private emitEvent(event: GestureEvent): void {
        this.onGesture?.(event);
    }

    reset(): void {
        this.state = 'IDLE';
        this.gestureParams = this.emptyParams();
    }

    private emptyParams(): SurgeryParams {
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
}
