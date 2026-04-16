/**
 * Editor Page — Clean 3-column layout: sidebar + viewport + panel
 */

export function createEditorPage(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page editor';
  page.id = 'page-editor';

  page.innerHTML = `
    <!-- Toolbar -->
    <div class="editor-toolbar">
      <button class="tool-btn" id="btn-editor-back" title="返回首页">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="toolbar-logo">FaceVR</span>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-actions">
        <button class="tool-btn" id="btn-undo" title="撤销 Ctrl+Z">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6h7a3 3 0 0 1 0 6H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 3L3 6l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="tool-btn" id="btn-redo" title="重做 Ctrl+Y">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 6H6a3 3 0 0 0 0 6h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 3l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="toolbar-divider"></div>
        <button class="tool-btn" id="btn-compare" title="前后对比">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
        <button class="tool-btn" id="btn-reset" title="重置全部">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1 1 1.8 4.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 12V8h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="tool-btn tool-btn-accent" id="btn-export" title="导出截图">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3M8 2v8M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="toolbar-divider"></div>
        <button class="tool-btn" id="btn-gesture" title="手势捏脸 (摄像头)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v3M5.5 2.5l1 2M10.5 2.5l-1 2M4 6c0-1 .5-2 2-2h4c1.5 0 2 1 2 2v4c0 2-1.5 4-4 4s-4-2-4-4V6z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="editor-body">
      <!-- Left: Surgery Categories -->
      <nav class="editor-nav">
        <div class="nav-item active" data-surgery="nose">
          <span class="nav-icon">👃</span>
          <span class="nav-label">鼻部</span>
        </div>
        <div class="nav-item" data-surgery="jaw">
          <span class="nav-icon">◻</span>
          <span class="nav-label">下颌</span>
        </div>
        <div class="nav-item" data-surgery="chin">
          <span class="nav-icon">▽</span>
          <span class="nav-label">下巴</span>
        </div>
        <div class="nav-item" data-surgery="eyes">
          <span class="nav-icon">◉</span>
          <span class="nav-label">眼部</span>
        </div>
        <div class="nav-item" data-surgery="lips">
          <span class="nav-icon">◡</span>
          <span class="nav-label">唇部</span>
        </div>
        <div class="nav-item" data-surgery="skin">
          <span class="nav-icon">🎨</span>
          <span class="nav-label">肤色</span>
        </div>
      </nav>

      <!-- Center: 3D Viewport -->
      <div class="editor-viewport" id="editor-viewport">
        <canvas id="viewport-canvas"></canvas>
        <div class="viewport-info">
          <span id="status-fps">--</span>
          <span id="status-gpu">检测中</span>
          <span id="status-gaussians">--</span>
        </div>

        <!-- Camera Preview for Hand Gesture Sculpting -->
        <div class="gesture-cam-container" id="gesture-cam" style="display:none;">
          <canvas id="gesture-cam-canvas"></canvas>
          <div class="gesture-cam-label">
            <span class="gesture-status" id="gesture-status">手势识别中...</span>
          </div>
        </div>
      </div>

      <!-- Right: Parameter Panel -->
      <aside class="editor-panel">
        <!-- Nose -->
        <div class="param-group" id="params-nose">
          <h3 class="param-group-title">鼻部整形</h3>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">鼻梁高度</span>
              <span class="param-value" id="val-nose-bridge">0.0 mm</span>
            </div>
            <input type="range" min="0" max="60" value="0" step="1"
                   data-param="nose-bridge" data-unit="mm" data-scale="0.1" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">鼻梁宽度</span>
              <span class="param-value" id="val-nose-width">0.0 mm</span>
            </div>
            <input type="range" min="-30" max="30" value="0" step="1"
                   data-param="nose-width" data-unit="mm" data-scale="0.1" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">鼻尖角度</span>
              <span class="param-value" id="val-nose-tip">0.0°</span>
            </div>
            <input type="range" min="-150" max="150" value="0" step="5"
                   data-param="nose-tip" data-unit="°" data-scale="0.1" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">鼻翼宽度</span>
              <span class="param-value" id="val-nose-wing">0.0 mm</span>
            </div>
            <input type="range" min="-50" max="0" value="0" step="1"
                   data-param="nose-wing" data-unit="mm" data-scale="0.1" />
          </div>
        </div>

        <!-- Jaw -->
        <div class="param-group" id="params-jaw" style="display:none;">
          <h3 class="param-group-title">下颌轮廓</h3>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">下颌宽度</span>
              <span class="param-value" id="val-jaw-width">0.0 mm</span>
            </div>
            <input type="range" min="-80" max="0" value="0" step="1"
                   data-param="jaw-width" data-unit="mm" data-scale="0.1" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">下颌角度</span>
              <span class="param-value" id="val-jaw-angle">0.0°</span>
            </div>
            <input type="range" min="-150" max="50" value="0" step="5"
                   data-param="jaw-angle" data-unit="°" data-scale="0.1" />
          </div>
        </div>

        <!-- Chin -->
        <div class="param-group" id="params-chin" style="display:none;">
          <h3 class="param-group-title">下巴塑形</h3>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">下巴长度</span>
              <span class="param-value" id="val-chin-length">0.0 mm</span>
            </div>
            <input type="range" min="-30" max="50" value="0" step="1"
                   data-param="chin-length" data-unit="mm" data-scale="0.1" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">下巴前突</span>
              <span class="param-value" id="val-chin-proj">0.0 mm</span>
            </div>
            <input type="range" min="-30" max="50" value="0" step="1"
                   data-param="chin-proj" data-unit="mm" data-scale="0.1" />
          </div>
        </div>

        <!-- Eyes -->
        <div class="param-group" id="params-eyes" style="display:none;">
          <h3 class="param-group-title">眼部手术</h3>
          <div class="param-slider" style="display:none;"> <!-- 隐藏双眼皮宽度 -->
            <div class="param-header">
              <span class="param-label">双眼皮宽度</span>
              <span class="param-value" id="val-eye-lid">0.0 mm</span>
            </div>
            <input type="range" min="0" max="40" value="0" step="1"
                   data-param="eye-lid" data-unit="mm" data-scale="0.1" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">开眼角</span>
              <span class="param-value" id="val-eye-corner">0.0 mm</span>
            </div>
            <input type="range" min="0" max="30" value="0" step="1"
                   data-param="eye-corner" data-unit="mm" data-scale="0.1" />
          </div>
        </div>

        <!-- Lips -->
        <div class="param-group" id="params-lips" style="display:none;">
          <h3 class="param-group-title">唇部塑形</h3>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">唇部丰满度</span>
              <span class="param-value" id="val-lip-volume">0.0 mm</span>
            </div>
            <input type="range" min="0" max="50" value="0" step="1"
                   data-param="lip-volume" data-unit="mm" data-scale="0.1" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">唇弓弧度</span>
              <span class="param-value" id="val-lip-arch">0.0°</span>
            </div>
            <input type="range" min="-20" max="40" value="0" step="1"
                   data-param="lip-arch" data-unit="°" data-scale="0.1" />
          </div>
        </div>

        <!-- Skin Tone -->
        <div class="param-group" id="params-skin" style="display:none;">
          <h3 class="param-group-title">肤色调节</h3>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">亮度</span>
              <span class="param-value" id="val-skin-brightness">100%</span>
            </div>
            <input type="range" min="60" max="130" value="100" step="1"
                   id="skin-brightness" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">暖色调</span>
              <span class="param-value" id="val-skin-warmth">0</span>
            </div>
            <input type="range" min="-30" max="30" value="0" step="1"
                   id="skin-warmth" />
          </div>
          <div class="param-slider">
            <div class="param-header">
              <span class="param-label">红润</span>
              <span class="param-value" id="val-skin-redness">0</span>
            </div>
            <input type="range" min="-20" max="20" value="0" step="1"
                   id="skin-redness" />
          </div>
        </div>

        <!-- Presets -->
        <div class="param-presets">
          <h3 class="param-group-title">快速预设</h3>
          <div class="presets-row">
            <button class="preset-chip" data-preset="natural">自然</button>
            <button class="preset-chip" data-preset="tall">高挺</button>
            <button class="preset-chip" data-preset="european">欧式</button>
            <button class="preset-chip" data-preset="korean">韩式</button>
          </div>
        </div>

        <!-- Hair Style — DISABLED until hair generation is production-ready -->
        <div class="param-presets" style="margin-top:12px; display:none;">
          <h3 class="param-group-title">💇 发型</h3>
          <div class="presets-row">
            <button class="preset-chip" data-hair="short">短发</button>
            <button class="preset-chip active" data-hair="medium">中长</button>
            <button class="preset-chip" data-hair="fluffy">蓬松</button>
          </div>
        </div>
      </aside>
    </div>
  `;

  return page;
}

/**
 * Initialize editor interactivity
 */
export function initEditorInteractions(page: HTMLElement): void {
  // Nav item switching with panel visibility
  const items = page.querySelectorAll('.nav-item');
  items.forEach((item) => {
    item.addEventListener('click', () => {
      items.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      const surgery = (item as HTMLElement).dataset.surgery || 'nose';

      // Show/hide param groups
      page.querySelectorAll('.param-group').forEach((g) => {
        (g as HTMLElement).style.display = 'none';
      });
      const target = page.querySelector(`#params-${surgery}`);
      if (target) (target as HTMLElement).style.display = 'block';
    });
  });

  // Slider value display
  const sliders = page.querySelectorAll<HTMLInputElement>(
    '.param-slider input[type="range"]'
  );
  sliders.forEach((slider) => {
    const param = slider.dataset.param!;
    const unit = slider.dataset.unit || '';
    const scale = parseFloat(slider.dataset.scale || '1');
    const valueEl = page.querySelector(`#val-${param}`) as HTMLElement;

    const updateDisplay = () => {
      const val = (parseInt(slider.value) * scale).toFixed(1);
      if (valueEl) valueEl.textContent = `${val} ${unit}`;
    };

    slider.addEventListener('input', updateDisplay);
    slider.addEventListener('dblclick', () => {
      slider.value = '0';
      updateDisplay();
    });
    updateDisplay();
  });

  // Preset buttons
  const presetBtns = page.querySelectorAll('.preset-chip');
  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(page, (btn as HTMLElement).dataset.preset || 'natural');
    });
  });
}

function applyPreset(page: HTMLElement, preset: string): void {
  const presets: Record<string, Record<string, number>> = {
    natural: { 'nose-bridge': 15, 'nose-width': -5, 'nose-tip': 30, 'nose-wing': -10 },
    tall: { 'nose-bridge': 35, 'nose-width': -10, 'nose-tip': 50, 'nose-wing': -20 },
    european: { 'nose-bridge': 45, 'nose-width': -15, 'nose-tip': 80, 'nose-wing': -30 },
    korean: { 'nose-bridge': 25, 'nose-width': -8, 'nose-tip': 20, 'nose-wing': -15 },
  };

  const values = presets[preset];
  if (!values) return;

  for (const [param, val] of Object.entries(values)) {
    const slider = page.querySelector<HTMLInputElement>(
      `input[data-param="${param}"]`
    );
    if (slider) {
      slider.value = String(val);
      slider.dispatchEvent(new Event('input'));
    }
  }
}
