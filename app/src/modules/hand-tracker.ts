/**
 * HandTracker — MediaPipe Hand Landmarker integration
 * Tracks 21 hand landmarks in real-time from webcam video
 * 
 * Follows same pattern as FaceDetector for consistency.
 */

import {
    HandLandmarker,
    HandLandmarkerOptions,
    HandLandmarkerResult,
    FilesetResolver,
} from '@mediapipe/tasks-vision';

export interface HandLandmark {
    x: number; // 0-1 normalized
    y: number;
    z: number;
}

export interface HandTrackingResult {
    landmarks: HandLandmark[];      // 21 landmarks, screen-space normalized
    worldLandmarks: HandLandmark[]; // 21 landmarks, real-world meters
    handedness: string;             // 'Left' or 'Right'
    timestamp: number;
}

export interface HandTrackerConfig {
    maxHands: number;
    minDetectionConfidence: number;
    minTrackingConfidence: number;
}

const DEFAULT_CONFIG: HandTrackerConfig = {
    maxHands: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
};

// MediaPipe hand landmark indices
export const HAND = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// Connections for debug visualization
export const HAND_CONNECTIONS: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
    [0, 5], [5, 6], [6, 7], [7, 8],       // index
    [0, 9], [9, 10], [10, 11], [11, 12],   // middle
    [0, 13], [13, 14], [14, 15], [15, 16], // ring
    [0, 17], [17, 18], [18, 19], [19, 20], // pinky
    [5, 9], [9, 13], [13, 17],             // palm
];

export class HandTracker {
    private handLandmarker: HandLandmarker | null = null;
    private config: HandTrackerConfig;
    private _isReady = false;
    private fpsCounter = { frames: 0, lastTime: performance.now(), fps: 0 };
    private lastTimestamp = -1;

    constructor(config: Partial<HandTrackerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    get isReady(): boolean {
        return this._isReady;
    }

    get currentFps(): number {
        return this.fpsCounter.fps;
    }

    async initialize(): Promise<void> {
        console.log('[HandTracker] Initializing...');

        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const options: HandLandmarkerOptions = {
            baseOptions: {
                modelAssetPath:
                    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                delegate: 'GPU',
            },
            numHands: this.config.maxHands,
            runningMode: 'VIDEO',
            minHandDetectionConfidence: this.config.minDetectionConfidence,
            minHandPresenceConfidence: this.config.minTrackingConfidence,
            minTrackingConfidence: this.config.minTrackingConfidence,
        };

        this.handLandmarker = await HandLandmarker.createFromOptions(vision, options);
        this._isReady = true;
        console.log('[HandTracker] Ready');
    }

    detect(video: HTMLVideoElement, timestampMs: number): HandTrackingResult | null {
        if (!this.handLandmarker || !this._isReady) return null;

        // MediaPipe requires strictly increasing timestamps
        if (timestampMs <= this.lastTimestamp) {
            timestampMs = this.lastTimestamp + 1;
        }
        this.lastTimestamp = timestampMs;

        const result: HandLandmarkerResult =
            this.handLandmarker.detectForVideo(video, timestampMs);

        this.updateFps();

        if (!result.landmarks || result.landmarks.length === 0) {
            return null;
        }

        const landmarks: HandLandmark[] = result.landmarks[0];
        const worldLandmarks: HandLandmark[] =
            result.worldLandmarks?.[0] || landmarks;
        const handedness = result.handednesses?.[0]?.[0]?.categoryName || 'Right';

        return { landmarks, worldLandmarks, handedness, timestamp: timestampMs };
    }

    /**
     * Draw hand skeleton on a canvas overlay for debug/UX feedback
     */
    drawDebug(
        ctx: CanvasRenderingContext2D,
        result: HandTrackingResult,
        canvasWidth: number,
        canvasHeight: number,
        pinchActive: boolean = false
    ): void {
        // Mirror horizontally so hand appears natural (like a mirror)
        ctx.save();
        ctx.translate(canvasWidth, 0);
        ctx.scale(-1, 1);

        // Draw connections
        ctx.strokeStyle = pinchActive ? '#FF4081' : '#00BFA5';
        ctx.lineWidth = 2;

        for (const [a, b] of HAND_CONNECTIONS) {
            const la = result.landmarks[a];
            const lb = result.landmarks[b];
            ctx.beginPath();
            ctx.moveTo(la.x * canvasWidth, la.y * canvasHeight);
            ctx.lineTo(lb.x * canvasWidth, lb.y * canvasHeight);
            ctx.stroke();
        }

        // Draw landmarks
        for (let i = 0; i < result.landmarks.length; i++) {
            const lm = result.landmarks[i];
            const x = lm.x * canvasWidth;
            const y = lm.y * canvasHeight;

            // Highlight thumb tip and index tip
            if (i === HAND.THUMB_TIP || i === HAND.INDEX_TIP) {
                ctx.fillStyle = pinchActive ? '#FF4081' : '#FFD740';
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = '#00BFA5';
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw pinch line between thumb and index
        const thumb = result.landmarks[HAND.THUMB_TIP];
        const index = result.landmarks[HAND.INDEX_TIP];
        ctx.strokeStyle = pinchActive ? 'rgba(255, 64, 129, 0.8)' : 'rgba(255, 215, 64, 0.5)';
        ctx.lineWidth = pinchActive ? 3 : 1;
        ctx.setLineDash(pinchActive ? [] : [4, 4]);
        ctx.beginPath();
        ctx.moveTo(thumb.x * canvasWidth, thumb.y * canvasHeight);
        ctx.lineTo(index.x * canvasWidth, index.y * canvasHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // Restore before drawing text (un-mirror so text is readable)
        ctx.restore();

        // FPS / status text (drawn without mirror transform)
        ctx.fillStyle = '#00BFA5';
        ctx.font = '12px Inter, monospace';
        ctx.fillText(`Hand FPS: ${this.fpsCounter.fps}`, 10, 20);
        ctx.fillText(pinchActive ? '✊ PINCH' : '✋ OPEN', 10, 36);
    }

    private updateFps(): void {
        this.fpsCounter.frames++;
        const now = performance.now();
        const elapsed = now - this.fpsCounter.lastTime;
        if (elapsed >= 1000) {
            this.fpsCounter.fps = Math.round(
                (this.fpsCounter.frames * 1000) / elapsed
            );
            this.fpsCounter.frames = 0;
            this.fpsCounter.lastTime = now;
        }
    }

    dispose(): void {
        if (this.handLandmarker) {
            this.handLandmarker.close();
            this.handLandmarker = null;
        }
        this._isReady = false;
        console.log('[HandTracker] Disposed');
    }
}
