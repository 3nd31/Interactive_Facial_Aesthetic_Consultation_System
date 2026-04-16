const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/editor-controller-D-GIIWfS.js","assets/deformation-engine-MS1OrLrU.js","assets/gaussian-renderer-gTQTEezE.js"])))=>i.map(i=>d[i]);
(function(){const a=document.createElement("link").relList;if(a&&a.supports&&a.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))i(e);new MutationObserver(e=>{for(const n of e)if(n.type==="childList")for(const r of n.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&i(r)}).observe(document,{childList:!0,subtree:!0});function t(e){const n={};return e.integrity&&(n.integrity=e.integrity),e.referrerPolicy&&(n.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?n.credentials="include":e.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function i(e){if(e.ep)return;e.ep=!0;const n=t(e);fetch(e.href,n)}})();const f="modulepreload",w=function(l){return"/"+l},h={},m=function(a,t,i){let e=Promise.resolve();if(t&&t.length>0){let r=function(o){return Promise.all(o.map(d=>Promise.resolve(d).then(u=>({status:"fulfilled",value:u}),u=>({status:"rejected",reason:u}))))};document.getElementsByTagName("link");const s=document.querySelector("meta[property=csp-nonce]"),c=s?.nonce||s?.getAttribute("nonce");e=r(t.map(o=>{if(o=w(o),o in h)return;h[o]=!0;const d=o.endsWith(".css"),u=d?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${o}"]${u}`))return;const v=document.createElement("link");if(v.rel=d?"stylesheet":f,d||(v.as="script"),v.crossOrigin="",v.href=o,c&&v.setAttribute("nonce",c),document.head.appendChild(v),d)return new Promise((p,g)=>{v.addEventListener("load",p),v.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${o}`)))})}))}function n(r){const s=new Event("vite:preloadError",{cancelable:!0});if(s.payload=r,window.dispatchEvent(s),!s.defaultPrevented)throw r}return e.then(r=>{for(const s of r||[])s.status==="rejected"&&n(s.reason);return a().catch(n)})};function b(){const l=document.createElement("div");return l.className="page landing",l.id="page-landing",l.innerHTML=`
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
  `,l}function E(){const l=document.createElement("div");return l.className="page editor",l.id="page-editor",l.innerHTML=`
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
      </nav>

      <!-- Center: 3D Viewport -->
      <div class="editor-viewport" id="editor-viewport">
        <canvas id="viewport-canvas"></canvas>
        <div class="viewport-info">
          <span id="status-fps">--</span>
          <span id="status-gpu">检测中</span>
          <span id="status-gaussians">--</span>
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
          <div class="param-slider">
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
      </aside>
    </div>
  `,l}function L(l){const a=l.querySelectorAll(".nav-item");a.forEach(e=>{e.addEventListener("click",()=>{a.forEach(s=>s.classList.remove("active")),e.classList.add("active");const n=e.dataset.surgery||"nose";l.querySelectorAll(".param-group").forEach(s=>{s.style.display="none"});const r=l.querySelector(`#params-${n}`);r&&(r.style.display="block")})}),l.querySelectorAll('.param-slider input[type="range"]').forEach(e=>{const n=e.dataset.param,r=e.dataset.unit||"",s=parseFloat(e.dataset.scale||"1"),c=l.querySelector(`#val-${n}`),o=()=>{const d=(parseInt(e.value)*s).toFixed(1);c&&(c.textContent=`${d} ${r}`)};e.addEventListener("input",o),e.addEventListener("dblclick",()=>{e.value="0",o()}),o()});const i=l.querySelectorAll(".preset-chip");i.forEach(e=>{e.addEventListener("click",()=>{i.forEach(n=>n.classList.remove("active")),e.classList.add("active"),k(l,e.dataset.preset||"natural")})})}function k(l,a){const i={natural:{"nose-bridge":15,"nose-width":-5,"nose-tip":30,"nose-wing":-10},tall:{"nose-bridge":35,"nose-width":-10,"nose-tip":50,"nose-wing":-20},european:{"nose-bridge":45,"nose-width":-15,"nose-tip":80,"nose-wing":-30},korean:{"nose-bridge":25,"nose-width":-8,"nose-tip":20,"nose-wing":-15}}[a];if(i)for(const[e,n]of Object.entries(i)){const r=l.querySelector(`input[data-param="${e}"]`);r&&(r.value=String(n),r.dispatchEvent(new Event("input")))}}class y{app;currentPage="landing";capturePageInstance=null;viewportInstance=null;apiClient=null;constructor(){this.app=document.getElementById("app"),this.init()}init(){const a=b();this.app.appendChild(a);const t=document.createElement("div");t.className="page capture",t.id="page-capture",t.innerHTML=`
            <div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;">
                <div class="loading-spinner"></div>
                <p style="color:var(--c-text-2)">加载面部检测模块...</p>
            </div>
        `,this.app.appendChild(t);const i=E();this.app.appendChild(i);const e=document.createElement("div");e.id="model-loading",e.className="model-loading-overlay",e.style.display="none",e.innerHTML=`
            <div class="model-loading-card">
                <div class="loading-spinner"></div>
                <p class="model-loading-stage" id="loading-stage">连接服务器...</p>
                <div class="model-loading-bar">
                    <div class="model-loading-fill" id="loading-fill"></div>
                </div>
            </div>
        `,this.app.appendChild(e),this.navigateTo("landing"),this.bindNavigation(),this.initServerConnection(),console.log("[App] Initialized")}async initServerConnection(){try{const{APIClient:a}=await m(async()=>{const{APIClient:i}=await import("./api-client-Vc6AU8j2.js");return{APIClient:i}},[]);this.apiClient=new a("http://localhost:3001"),await this.apiClient.checkHealth()?(console.log("[App] Server connected"),await this.apiClient.connect()):console.log("[App] Server unavailable — using local-only mode")}catch(a){console.log("[App] Server connection skipped:",a)}}bindNavigation(){document.getElementById("btn-start-camera")?.addEventListener("click",()=>{this.navigateTo("capture")}),document.getElementById("btn-upload-photo")?.addEventListener("click",()=>{this.navigateTo("editor")}),document.getElementById("btn-editor-back")?.addEventListener("click",()=>{this.navigateTo("landing")})}async navigateTo(a){document.querySelectorAll(".page").forEach(i=>i.classList.remove("active")),this.currentPage=a;const t=document.getElementById(`page-${a}`);t&&t.classList.add("active"),a==="capture"&&await this.initCapturePage(),a==="editor"&&await this.initEditor(),console.log(`[App] → ${a}`)}showModelLoading(a){const t=document.getElementById("model-loading");t&&(t.style.display=a?"flex":"none")}updateLoadingProgress(a,t){const i=document.getElementById("loading-stage"),e=document.getElementById("loading-fill");i&&(i.textContent=t),e&&(e.style.width=`${Math.round(a*100)}%`)}async initEditor(){if(!this.viewportInstance)try{const[{EditorController:a}]=await Promise.all([m(()=>import("./editor-controller-D-GIIWfS.js"),__vite__mapDeps([0,1]))]),t=document.getElementById("page-editor"),i=document.getElementById("editor-viewport");L(t);const e=new a(t);let n=!1;try{const{UnityBridge:r}=await m(async()=>{const{UnityBridge:o}=await import("./unity-bridge-6Fam89PB.js");return{UnityBridge:o}},[]),s=new r(i);await s.init()&&(n=!0,this.viewportInstance=s,e.setUnityBridge(s),document.getElementById("btn-undo")?.addEventListener("click",()=>s.undo()),document.getElementById("btn-redo")?.addEventListener("click",()=>s.redo()),document.getElementById("btn-reset")?.addEventListener("click",()=>s.resetCamera()),document.getElementById("btn-export")?.addEventListener("click",()=>s.captureScreenshot()),s.setOnMessage((o,d)=>{switch(o){case"screenshot":m(async()=>{const{StorageManager:u}=await import("./storage-manager-B-6c3FAS.js");return{StorageManager:u}},[]).then(({StorageManager:u})=>{u.saveBase64Image(d.data,"surgery-result")});break;case"ply-loaded":console.log(`[App] Unity loaded ${d.count} gaussians`);break}}),this.apiClient?.isConnected()&&(this.showModelLoading(!0),this.apiClient.setOnProgress((o,d)=>{this.updateLoadingProgress(o,d)}),this.apiClient.setOnModelReady(o=>{console.log(`[App] Model received: ${o.byteLength} bytes → Unity`),s.loadPLYData(o),this.showModelLoading(!1)}),this.apiClient.requestModel("demo-face")),console.log("[App] Editor wired (Unity WebGL mode)"))}catch(r){console.warn("[App] Unity init failed, falling back to WebGPU:",r)}if(!n){const{GaussianViewport:r}=await m(async()=>{const{GaussianViewport:c}=await import("./gaussian-renderer-gTQTEezE.js");return{GaussianViewport:c}},__vite__mapDeps([2,1])),s=document.getElementById("viewport-canvas");if(s){const c=new r(s),o=await c.init();if(this.viewportInstance=c,o){e.setOnDeform(p=>{c.updateDeformation(p)});const{ComparisonView:d}=await m(async()=>{const{ComparisonView:p}=await import("./comparison-view-ci6OVD2t.js");return{ComparisonView:p}},[]),u=new d(i);document.getElementById("btn-compare")?.addEventListener("click",()=>u.toggle());const{StorageManager:v}=await m(async()=>{const{StorageManager:p}=await import("./storage-manager-B-6c3FAS.js");return{StorageManager:p}},[]);document.getElementById("btn-export")?.addEventListener("click",()=>{v.exportScreenshot(s)}),this.apiClient?.isConnected()&&(this.showModelLoading(!0),this.apiClient.setOnProgress((p,g)=>{this.updateLoadingProgress(p,g)}),this.apiClient.setOnModelReady(p=>{console.log(`[App] Model received: ${p.byteLength} bytes → WebGPU`),c.loadPLYData(p),this.showModelLoading(!1)}),this.apiClient.requestModel("demo-face")),console.log("[App] Editor wired (WebGPU fallback mode)")}}}}catch(a){console.error("[App] Editor init failed:",a)}}async initCapturePage(){try{const{CapturePage:a}=await m(async()=>{const{CapturePage:t}=await import("./capture-BCVGlqU3.js");return{CapturePage:t}},[]);if(!this.capturePageInstance){this.capturePageInstance=new a;const t=document.getElementById("page-capture");if(t){const i=this.capturePageInstance.getElement();i.classList.add("active"),t.replaceWith(i)}this.capturePageInstance.setOnComplete(async(i,e)=>{if(this.capturePageInstance?.deactivate(),e&&this.apiClient?.isConnected())try{this.showModelLoading(!0),this.updateLoadingProgress(.1,"上传照片..."),await this.apiClient.uploadPhoto(e),console.log("[App] Photo uploaded to server")}catch(n){console.warn("[App] Photo upload failed:",n),this.showModelLoading(!1)}this.navigateTo("editor")})}this.capturePageInstance.activate(),document.getElementById("btn-capture-back")?.addEventListener("click",()=>{this.capturePageInstance?.deactivate(),this.navigateTo("landing")})}catch(a){console.error("[App] Capture init failed:",a)}}}const C=document.getElementById("app");C?new y:document.addEventListener("DOMContentLoaded",()=>new y);
