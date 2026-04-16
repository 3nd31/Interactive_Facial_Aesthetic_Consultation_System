/**
 * FaceDetector — MediaPipe Face Mesh integration
 * Extracts 478 3D facial landmarks in real-time
 */

import {
    FaceLandmarker,
    FaceLandmarkerOptions,
    FaceLandmarkerResult,
    FilesetResolver,
} from '@mediapipe/tasks-vision';

export interface FaceDetectorConfig {
    maxFaces: number;
    minDetectionConfidence: number;
    minTrackingConfidence: number;
    debug: boolean;
}

export interface FaceLandmark {
    x: number;
    y: number;
    z: number;
}

export interface FaceDetectionResult {
    landmarks: FaceLandmark[];
    blendshapes: Map<string, number>;
    faceMatrix: number[] | null;
    timestamp: number;
}

const DEFAULT_CONFIG: FaceDetectorConfig = {
    maxFaces: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    debug: true,
};

/**
 * Key facial landmarks extracted for surgery deformation.
 * Coordinates are in MediaPipe normalized space (x: 0~1 left→right, y: 0~1 top→bottom, z: depth).
 */
export interface SurgeryLandmarks {
    forehead:      { x: number; y: number; z: number };  // index 10 (top of face oval)
    noseTip:       { x: number; y: number; z: number };  // index 1
    noseBridge:    { x: number; y: number; z: number };  // index 6
    leftEyeUpper:  { x: number; y: number; z: number };  // index 159
    rightEyeUpper: { x: number; y: number; z: number };  // index 386
    leftInnerEye:  { x: number; y: number; z: number };  // index 133
    rightInnerEye: { x: number; y: number; z: number };  // index 362
    upperLip:      { x: number; y: number; z: number };  // index 13
    lowerLip:      { x: number; y: number; z: number };  // index 14
    chin:          { x: number; y: number; z: number };  // index 152
    leftJaw:       { x: number; y: number; z: number };  // index 234
    rightJaw:      { x: number; y: number; z: number };  // index 454
}

export class FaceDetector {
    private faceLandmarker: FaceLandmarker | null = null;
    private imageLandmarker: FaceLandmarker | null = null;
    private config: FaceDetectorConfig;
    private debugCanvas: HTMLCanvasElement | null = null;
    private debugCtx: CanvasRenderingContext2D | null = null;
    private _isReady = false;
    private fpsCounter = { frames: 0, lastTime: performance.now(), fps: 0 };

    constructor(config: Partial<FaceDetectorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    get isReady(): boolean {
        return this._isReady;
    }

    get currentFps(): number {
        return this.fpsCounter.fps;
    }

    async initialize(): Promise<void> {
        console.log('[FaceDetector] Initializing...');

        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const options: FaceLandmarkerOptions = {
            baseOptions: {
                modelAssetPath:
                    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'GPU',
            },
            numFaces: this.config.maxFaces,
            runningMode: 'VIDEO',
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            minFaceDetectionConfidence: this.config.minDetectionConfidence,
            minFacePresenceConfidence: this.config.minTrackingConfidence,
        };

        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, options);
        this._isReady = true;
        console.log('[FaceDetector] Ready');
    }

    detect(video: HTMLVideoElement, timestampMs: number): FaceDetectionResult | null {
        if (!this.faceLandmarker || !this._isReady) return null;

        const result: FaceLandmarkerResult =
            this.faceLandmarker.detectForVideo(video, timestampMs);

        this.updateFps();

        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
            return null;
        }

        const landmarks: FaceLandmark[] = result.faceLandmarks[0];

        const blendshapes = new Map<string, number>();
        if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
            for (const bs of result.faceBlendshapes[0].categories) {
                blendshapes.set(bs.categoryName, bs.score);
            }
        }

        const faceMatrix = result.facialTransformationMatrixes
            && result.facialTransformationMatrixes.length > 0
            ? Array.from(result.facialTransformationMatrixes[0].data)
            : null;

        return { landmarks, blendshapes, faceMatrix, timestamp: timestampMs };
    }

    setDebugCanvas(canvas: HTMLCanvasElement): void {
        this.debugCanvas = canvas;
        this.debugCtx = canvas.getContext('2d');
    }

    drawDebugLandmarks(
        result: FaceDetectionResult,
        videoWidth: number,
        videoHeight: number
    ): void {
        if (!this.config.debug || !this.debugCtx || !this.debugCanvas) return;

        const ctx = this.debugCtx;
        const canvas = this.debugCanvas;
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw landmarks as small dots
        ctx.fillStyle = '#00BFA5';
        for (const lm of result.landmarks) {
            const x = lm.x * canvas.width;
            const y = lm.y * canvas.height;
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw connections for face contour (subset)
        ctx.strokeStyle = 'rgba(26, 115, 232, 0.4)';
        ctx.lineWidth = 0.5;

        const FACE_OVAL_INDICES = [
            10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
            397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
            172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
        ];

        ctx.beginPath();
        for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
            const lm = result.landmarks[FACE_OVAL_INDICES[i]];
            const x = lm.x * canvas.width;
            const y = lm.y * canvas.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw nose contour
        const NOSE_INDICES = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61, 185, 40, 39, 37];
        ctx.strokeStyle = 'rgba(0, 191, 165, 0.6)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < NOSE_INDICES.length; i++) {
            const idx = NOSE_INDICES[i];
            if (idx >= result.landmarks.length) continue;
            const lm = result.landmarks[idx];
            const x = lm.x * canvas.width;
            const y = lm.y * canvas.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // FPS display
        ctx.fillStyle = '#00BFA5';
        ctx.font = '12px Inter, monospace';
        ctx.fillText(`FPS: ${this.fpsCounter.fps}`, 10, 20);
        ctx.fillText(`Points: ${result.landmarks.length}`, 10, 36);
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

    /**
     * Detect face landmarks from a static image (not video).
     * Initializes a separate IMAGE-mode landmarker on first call.
     */
    async detectFromImage(img: HTMLImageElement | HTMLCanvasElement): Promise<FaceLandmark[] | null> {
        if (!this.imageLandmarker) {
            console.log('[FaceDetector] Initializing IMAGE mode landmarker...');
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );
            this.imageLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath:
                        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                    delegate: 'GPU',
                },
                numFaces: 1,
                runningMode: 'IMAGE',
                outputFaceBlendshapes: false,
                outputFacialTransformationMatrixes: false,
            });
            console.log('[FaceDetector] IMAGE mode ready');
        }

        const result = this.imageLandmarker.detect(img);
        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
            console.warn('[FaceDetector] No face detected in image');
            return null;
        }
        return result.faceLandmarks[0];
    }

    /**
     * Extract key surgery landmarks from 478-point MediaPipe result.
     * Returns positions needed for deformation targeting.
     */
    static extractSurgeryLandmarks(landmarks: FaceLandmark[]): SurgeryLandmarks {
        const lm = (i: number) => landmarks[i];
        return {
            forehead:      lm(10),
            noseTip:       lm(1),
            noseBridge:    lm(6),
            leftEyeUpper:  lm(159),
            rightEyeUpper: lm(386),
            leftInnerEye:  lm(133),
            rightInnerEye: lm(362),
            upperLip:      lm(13),
            lowerLip:      lm(14),
            chin:          lm(152),
            leftJaw:       lm(234),
            rightJaw:      lm(454),
        };
    }

    dispose(): void {
        if (this.faceLandmarker) {
            this.faceLandmarker.close();
            this.faceLandmarker = null;
        }
        if (this.imageLandmarker) {
            this.imageLandmarker.close();
            this.imageLandmarker = null;
        }
        this._isReady = false;
        console.log('[FaceDetector] Disposed');
    }
}
