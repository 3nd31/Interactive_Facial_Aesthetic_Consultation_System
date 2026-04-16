/**
 * Landing Page — Minimal hero with single CTA
 */

export function createLandingPage(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page landing';
  page.id = 'page-landing';

  page.innerHTML = `
    <div class="landing-hero">
      <h1 class="landing-logo">
        <span class="logo-gradient">FaceVR</span>
      </h1>
      <p class="landing-tagline">3D 整容模拟器</p>
      <button class="btn btn-primary btn-lg" id="btn-upload-photo">
        开始使用
      </button>
      <button class="btn-text" id="btn-start-camera">
        或使用摄像头实时捕捉 →
      </button>
    </div>
    <footer class="landing-footer">
      模拟效果仅供参考 · FaceVR © 2026
    </footer>
  `;

  return page;
}
