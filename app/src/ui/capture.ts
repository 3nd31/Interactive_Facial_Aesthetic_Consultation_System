/**
 * Capture Page — Webcam preview + face detection + guided alignment
 */

import { WebcamModule } from '../modules/webcam';
import { FaceDetector, FaceDetectionResult } from '../modules/face-detector';

export class CapturePage {
  private element: HTMLElement;
  private webcam: WebcamModule;
  private faceDetector: FaceDetector;
  private animationId: number | null = null;
  private onComplete: ((result: FaceDetectionResult, photo: Blob | null) => void) | null = null;
  private lastVideo: HTMLVideoElement | null = null;

  constructor() {
    this.webcam = new WebcamModule();
    this.faceDetector = new FaceDetector({ debug: true });
    this.element = this.createElement();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  setOnComplete(cb: (result: FaceDetectionResult, photo: Blob | null) => void): void {
    this.onComplete = cb;
  }

  /**
   * Capture current video frame as JPEG Blob
   */
  private async capturePhoto(): Promise<Blob | null> {
    if (!this.lastVideo) return null;
    const canvas = document.createElement('canvas');
    canvas.width = this.lastVideo.videoWidth;
    canvas.height = this.lastVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(this.lastVideo, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
    });
  }

  async activate(): Promise<void> {
    const viewport = this.element.querySelector('.capture-viewport') as HTMLElement;
    const statusEl = this.element.querySelector('.capture-status') as HTMLElement;
    const scanBtn = this.element.querySelector('#btn-scan') as HTMLButtonElement;
    const fpsEl = this.element.querySelector('.capture-fps') as HTMLElement;

    // Initialize face detector
    statusEl.innerHTML = `<div class="status-item">⏳ 正在加载 AI 模型...</div>`;
    await this.faceDetector.initialize();

    // Start webcam
    statusEl.innerHTML = `<div class="status-item">📷 启动摄像头...</div>`;
    try {
      const video = await this.webcam.start(viewport);
      this.lastVideo = video;
      const debugCanvas = viewport.querySelector('canvas') as HTMLCanvasElement;
      this.faceDetector.setDebugCanvas(debugCanvas);

      // Start detection loop
      let lastResult: FaceDetectionResult | null = null;
      let stableFrames = 0;

      const detectLoop = () => {
        if (!this.webcam.isActive) return;

        const result = this.faceDetector.detect(video, performance.now());

        if (result) {
          lastResult = result;
          stableFrames++;
          this.faceDetector.drawDebugLandmarks(
            result,
            video.videoWidth,
            video.videoHeight
          );
          this.updateStatus(statusEl, true, stableFrames);

          // Update face guide
          const oval = viewport.querySelector('.face-guide-oval') as HTMLElement;
          if (oval) oval.classList.add('detected');
        } else {
          stableFrames = 0;
          this.updateStatus(statusEl, false, 0);
          const oval = viewport.querySelector('.face-guide-oval') as HTMLElement;
          if (oval) oval.classList.remove('detected');
        }

        fpsEl.textContent = `FPS: ${this.faceDetector.currentFps}`;
        this.animationId = requestAnimationFrame(detectLoop);
      };

      detectLoop();

      // Scan button
      scanBtn.disabled = false;
      scanBtn.onclick = async () => {
        if (lastResult && stableFrames >= 10) {
          scanBtn.disabled = true;
          scanBtn.textContent = '📤 正在捕捉...';
          const photo = await this.capturePhoto();
          this.onComplete?.(lastResult, photo);
        }
      };
    } catch {
      statusEl.innerHTML = `
        <div class="status-item warn">❌ 摄像头访问被拒绝</div>
      `;
    }
  }

  deactivate(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.webcam.stop();
    this.lastVideo = null;
  }

  private updateStatus(el: HTMLElement, detected: boolean, stableFrames: number): void {
    if (detected) {
      el.innerHTML = `
        <div class="status-item ok">✅ 面部已检测</div>
        <div class="status-item ${stableFrames > 10 ? 'ok' : ''}">
          ${stableFrames > 10 ? '✅' : '⏳'} 稳定度: ${Math.min(100, Math.round(stableFrames * 3.3))}%
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="status-item warn">⚠️ 未检测到面部</div>
        <div class="status-item">💡 请正面朝向摄像头</div>
      `;
    }
  }

  private createElement(): HTMLElement {
    const page = document.createElement('div');
    page.className = 'page capture';
    page.id = 'page-capture';

    page.innerHTML = `
      <div class="capture-header">
        <button class="capture-back" id="btn-capture-back">← 返回</button>
        <span class="capture-step">步骤 1 / 3</span>
      </div>

      <div class="capture-viewport">
        <canvas></canvas>
        <div class="face-guide">
          <div class="face-guide-oval"></div>
        </div>
      </div>

      <div class="capture-status">
        <div class="status-item">点击"开始体验"启动摄像头</div>
      </div>

      <div class="capture-actions">
        <button class="btn btn-primary" id="btn-scan" disabled>
          📸 开始扫描
        </button>
        <div class="capture-fps">FPS: --</div>
      </div>
    `;

    return page;
  }
}
