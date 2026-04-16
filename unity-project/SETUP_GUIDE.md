# Unity 项目初始化指南

## 步骤 1: 在 Unity Hub 创建项目

1. 打开 Unity Hub → "New Project"
2. 选择编辑器版本: `6000.3.2f1` (路径: `E:\unity_editor\6000.3.2f1`)
3. 模板: **3D (Built-in Render Pipeline)** 或 **Universal 3D**
4. 项目名: `FaceVR-Unity`
5. 位置: `E:\xb_all\3deditor\unity-project`
6. 创建

## 步骤 2: 配置阶段

### Player Settings (Edit → Project Settings → Player)
```
平台: WebGL
公司名: FaceVR
产品名: FaceVR Surgery Simulator
分辨率:
  - WebGL Template: Minimal
  - Default Canvas Width: 1280
  - Default Canvas Height: 720
Publishing Settings:
  - Compression Format: Brotli
  - Decompression Fallback: true
Other Settings:
  - Color Space: Linear
  - Graphics APIs: WebGPU, WebGL 2.0 (按顺序)
  - Strip Engine Code: true
```

### 移动 Compute Shader
将 `Assets/Shaders/GaussianSort.compute` 复制到 `Assets/Resources/GaussianSort.compute`
（SceneSetup.cs 用 Resources.Load 加载它）

## 步骤 3: 创建场景

1. 创建新场景: File → New Scene → Empty
2. 创建空 GameObject: "SceneManager"  
3. 挂载 `SceneSetup` 脚本
4. 确保 `Auto Init Demo = true`
5. 保存场景为 `Assets/Scenes/Main.unity`

## 步骤 4: 首次构建

1. File → Build Settings
2. Add Open Scenes
3. Platform: WebGL → Switch Platform
4. Build → 选择 `e:\xb_all\3deditor\app\public\unity-build\`

## 步骤 5: 嵌入 Web Shell

在 `app/src/ui/editor.ts` 中加入:
```javascript
const iframe = document.createElement('iframe');
iframe.src = '/unity-build/index.html';
iframe.style.cssText = 'width:100%;height:100%;border:none;';
viewportContainer.appendChild(iframe);

// Listen for Unity messages
window.addEventListener('unity-message', (e) => {
    const { type, payload } = e.detail;
    console.log('[Unity→JS]', type, payload);
});
```
