class l{container;mode="none";sliderPos=.5;isDragging=!1;overlay=null;constructor(e){this.container=e}toggle(){this.mode==="none"?this.activateSplit():this.mode==="split"?this.activateSlider():this.deactivate()}activateSplit(){this.deactivate(),this.mode="split",this.overlay=document.createElement("div"),this.overlay.className="comparison-overlay split-mode",this.overlay.innerHTML=`
      <div class="split-left">
        <div class="split-label">术前</div>
      </div>
      <div class="split-divider"></div>
      <div class="split-right">
        <div class="split-label">术后</div>
      </div>
    `,this.container.appendChild(this.overlay),this.injectStyles()}activateSlider(){this.deactivate(),this.mode="slider",this.overlay=document.createElement("div"),this.overlay.className="comparison-overlay slider-mode",this.overlay.innerHTML=`
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
    `,this.container.appendChild(this.overlay);const e=this.overlay.querySelector("#comparison-handle");this.setupSliderInteraction(e),this.updateSliderPosition(),this.injectStyles()}deactivate(){this.mode="none",this.overlay&&(this.overlay.remove(),this.overlay=null)}getMode(){return this.mode}setupSliderInteraction(e){const t=i=>{if(!this.isDragging||!this.overlay)return;const s=this.container.getBoundingClientRect();this.sliderPos=Math.max(.05,Math.min(.95,(i-s.left)/s.width)),this.updateSliderPosition()};e.addEventListener("mousedown",i=>{this.isDragging=!0,i.preventDefault()}),window.addEventListener("mousemove",i=>t(i.clientX)),window.addEventListener("mouseup",()=>{this.isDragging=!1}),e.addEventListener("touchstart",i=>{this.isDragging=!0,i.preventDefault()}),window.addEventListener("touchmove",i=>{i.touches.length>0&&t(i.touches[0].clientX)}),window.addEventListener("touchend",()=>{this.isDragging=!1})}updateSliderPosition(){if(!this.overlay||this.mode!=="slider")return;const e=(this.sliderPos*100).toFixed(1),t=this.overlay.querySelector(".slider-before"),i=this.overlay.querySelector("#comparison-handle");t&&(t.style.width=`${e}%`),i&&(i.style.left=`${e}%`)}injectStyles(){if(document.getElementById("comparison-styles"))return;const e=document.createElement("style");e.id="comparison-styles",e.textContent=`
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
    `,document.head.appendChild(e)}}export{l as ComparisonView};
