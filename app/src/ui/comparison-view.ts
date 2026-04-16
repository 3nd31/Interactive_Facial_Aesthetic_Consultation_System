/**
 * ComparisonView — Before/After comparison modes
 * Modes: split-screen, slider overlay
 */

export class ComparisonView {
    private container: HTMLElement;
    private mode: 'split' | 'slider' | 'none' = 'none';
    private sliderPos = 0.5;
    private isDragging = false;
    private overlay: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    toggle(): void {
        if (this.mode === 'none') {
            this.activateSplit();
        } else if (this.mode === 'split') {
            this.activateSlider();
        } else {
            this.deactivate();
        }
    }

    activateSplit(): void {
        this.deactivate();
        this.mode = 'split';

        this.overlay = document.createElement('div');
        this.overlay.className = 'comparison-overlay split-mode';
        this.overlay.innerHTML = `
      <div class="split-left">
        <div class="split-label">术前</div>
      </div>
      <div class="split-divider"></div>
      <div class="split-right">
        <div class="split-label">术后</div>
      </div>
    `;
        this.container.appendChild(this.overlay);

        // Add CSS
        this.injectStyles();
    }

    activateSlider(): void {
        this.deactivate();
        this.mode = 'slider';

        this.overlay = document.createElement('div');
        this.overlay.className = 'comparison-overlay slider-mode';
        this.overlay.innerHTML = `
      <div class="slider-before">
        <div class="split-label">术前</div>
      </div>
      <div class="slider-handle" id="comparison-handle">
        <div class="slider-handle-line"></div>
        <div class="slider-handle-grip">⟷</div>
        <div class="slider-handle-line"></div>
      </div>
      <div class="slider-after">
        <div class="split-label">术后</div>
      </div>
    `;
        this.container.appendChild(this.overlay);

        const handle = this.overlay.querySelector('#comparison-handle') as HTMLElement;
        this.setupSliderInteraction(handle);
        this.updateSliderPosition();
        this.injectStyles();
    }

    deactivate(): void {
        this.mode = 'none';
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    getMode(): string {
        return this.mode;
    }

    private setupSliderInteraction(handle: HTMLElement): void {
        const onMove = (clientX: number) => {
            if (!this.isDragging || !this.overlay) return;
            const rect = this.container.getBoundingClientRect();
            this.sliderPos = Math.max(0.05, Math.min(0.95, (clientX - rect.left) / rect.width));
            this.updateSliderPosition();
        };

        handle.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => onMove(e.clientX));
        window.addEventListener('mouseup', () => { this.isDragging = false; });

        handle.addEventListener('touchstart', (e) => {
            this.isDragging = true;
            e.preventDefault();
        });
        window.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) onMove(e.touches[0].clientX);
        });
        window.addEventListener('touchend', () => { this.isDragging = false; });
    }

    private updateSliderPosition(): void {
        if (!this.overlay || this.mode !== 'slider') return;
        const pct = (this.sliderPos * 100).toFixed(1);
        const before = this.overlay.querySelector('.slider-before') as HTMLElement;
        const handle = this.overlay.querySelector('#comparison-handle') as HTMLElement;
        if (before) before.style.width = `${pct}%`;
        if (handle) handle.style.left = `${pct}%`;
    }

    private injectStyles(): void {
        if (document.getElementById('comparison-styles')) return;

        const style = document.createElement('style');
        style.id = 'comparison-styles';
        style.textContent = `
      .comparison-overlay {
        position: absolute;
        inset: 0;
        z-index: 10;
        pointer-events: none;
      }
      .comparison-overlay.slider-mode { pointer-events: auto; }

      /* Split mode */
      .split-mode {
        display: flex;
      }
      .split-left, .split-right {
        flex: 1;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 12px;
      }
      .split-divider {
        width: 2px;
        background: var(--color-primary);
        box-shadow: 0 0 8px var(--color-primary-glow);
      }
      .split-label {
        background: rgba(0,0,0,0.6);
        color: white;
        padding: 4px 12px;
        border-radius: var(--radius-full);
        font-size: 12px;
        font-weight: 600;
        pointer-events: none;
      }

      /* Slider mode */
      .slider-mode {
        display: flex;
        position: relative;
      }
      .slider-before {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 50%;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 12px;
        border-right: 2px solid var(--color-primary);
        overflow: hidden;
      }
      .slider-after {
        position: absolute;
        right: 0; top: 0; bottom: 0;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 12px;
      }
      .slider-handle {
        position: absolute;
        top: 0; bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        cursor: ew-resize;
        z-index: 20;
        pointer-events: auto;
        width: 30px;
      }
      .slider-handle-line {
        flex: 1;
        width: 2px;
        background: var(--color-primary);
        box-shadow: 0 0 6px var(--color-primary-glow);
      }
      .slider-handle-grip {
        width: 30px;
        height: 30px;
        background: var(--color-primary);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: white;
        box-shadow: var(--shadow-glow);
      }
    `;
        document.head.appendChild(style);
    }
}
