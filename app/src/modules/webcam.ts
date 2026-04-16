/**
 * WebcamModule — Manages camera lifecycle and video frame capture
 */

export interface WebcamConfig {
    width: number;
    height: number;
    facingMode: 'user' | 'environment';
    frameRate: number;
}

const DEFAULT_CONFIG: WebcamConfig = {
    width: 1280,
    height: 720,
    facingMode: 'user',
    frameRate: 30,
};

export class WebcamModule {
    private video: HTMLVideoElement | null = null;
    private stream: MediaStream | null = null;
    private config: WebcamConfig;
    private _isActive = false;

    constructor(config: Partial<WebcamConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    get isActive(): boolean {
        return this._isActive;
    }

    get videoElement(): HTMLVideoElement | null {
        return this.video;
    }

    async start(targetElement: HTMLElement): Promise<HTMLVideoElement> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: this.config.width },
                    height: { ideal: this.config.height },
                    facingMode: this.config.facingMode,
                    frameRate: { ideal: this.config.frameRate },
                },
                audio: false,
            });

            this.video = document.createElement('video');
            this.video.srcObject = this.stream;
            this.video.setAttribute('playsinline', '');
            this.video.setAttribute('autoplay', '');
            this.video.muted = true;

            targetElement.prepend(this.video);

            await new Promise<void>((resolve) => {
                this.video!.onloadedmetadata = () => {
                    this.video!.play();
                    resolve();
                };
            });

            this._isActive = true;
            console.log(
                `[Webcam] Started: ${this.video.videoWidth}x${this.video.videoHeight} @ ${this.config.frameRate}fps`
            );

            return this.video;
        } catch (err) {
            console.error('[Webcam] Failed to start:', err);
            throw err;
        }
    }

    stop(): void {
        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
        }
        if (this.video) {
            this.video.remove();
            this.video = null;
        }
        this._isActive = false;
        console.log('[Webcam] Stopped');
    }

    async switchCamera(): Promise<void> {
        this.config.facingMode =
            this.config.facingMode === 'user' ? 'environment' : 'user';
        if (this._isActive && this.video) {
            const parent = this.video.parentElement;
            this.stop();
            if (parent) {
                await this.start(parent);
            }
        }
    }

    captureFrame(): ImageData | null {
        if (!this.video || !this._isActive) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(this.video, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    static async checkPermission(): Promise<PermissionState> {
        try {
            const result = await navigator.permissions.query({
                name: 'camera' as PermissionName,
            });
            return result.state;
        } catch {
            return 'prompt';
        }
    }
}
