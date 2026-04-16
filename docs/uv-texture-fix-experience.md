# 🎯 UV 纹理修复工程经验总结

## 问题描述

Unity WebGL 渲染的 FLAME 3D 头部模型，脖子和后脑区域出现**垂直/水平肤色条纹**，
而 Three.js `face_viewer.html` 用同样的 OBJ + UV texture 渲染正常。

## 根因分析

### OBJ 文件的 UV 特征

通过 Python 分析脚本 (`check_verts.py`) 发现 FLAME OBJ 的关键数据：

| 区域 | UV 特征 | 示例 |
|------|---------|------|
| 面部 | U,V ∈ [0,1] 正常范围 | (0.50, 0.60) |
| 脖子 | **V < 0** | (0.497, **-0.284**) |
| 后脑中线 seam | **U = -0.284 或 1.278** | (**-0.284**, 0.391) ↔ (**1.278**, 0.391) |
| 头顶 seam | U 跨度逐渐收窄 | (-0.083, 1.119) ↔ (1.077, 1.119) |

- **95/5023** 顶点有多个 UV 索引（seam 顶点）
- **96 个**脖子顶点（Y < -h×0.35），全部 V = -0.284

### Three.js 为什么正常

Three.js `face_viewer.html` 的做法极其简单：

```javascript
// 1. 加载原始纹理，不做任何处理
tex.colorSpace = THREE.SRGBColorSpace;
tex.flipY = true;
// wrapS/wrapT 默认 = ClampToEdgeWrapping

// 2. OBJ UV 原样传入 GPU
// 3. GPU 在逐像素采样时自动 clamp 到 [0,1]
```

**GPU 级 Clamp**：UV=-0.284 的像素采样时被 GPU 钳制到 0，采到纹理边缘的**暗色像素** → 脖子/后脑保持暗色 ✓

### Unity `UVTextureLoader.cs` 的三个致命操作

> ⚠️ 以下三个操作叠加导致了条纹，单独修任何一个都不够。

#### 1. `MakeSkinBaseTexture()` — 把暗色像素替换为肤色

```csharp
// brightness < 0.08 的像素全部替换为 skinColor
if (brightness < 0.08f) pixels[i] = skinColor;
```

纹理边缘（UV=0/1 行列）本是暗色/黑色，被替换为肤色 → GPU Clamp 采样到边缘就是肤色。

#### 2. `PadTextureEdges(tex, 200)` — 200-pass BFS 扩展肤色

从面部 BFS 向外扩展 200 passes，把所有背景像素替换为邻近肤色 → 纹理完全没有暗色边缘了。

#### 3. ParseOBJ 内的 UV 修改（后续修复中引入）

各种 UV clamp/remap 尝试打破了 GPU 级 Clamp 的正确行为。

## 失败的修复尝试

| 尝试 | 方法 | 结果 | 原因 |
|------|------|------|------|
| ① Y 坐标阈值 | Y < -h×0.35 的顶点 UV → (0.5, 0.5) | 头顶变肤色 | `isEdgeUV` 条件误覆盖头顶 |
| ② UV distortion ratio | 计算每三角面 UV/3D 面积比 | 后脑条纹不变 | 检测正确但纹理本身已被 skin fill 污染 |
| ③ Clamp01 | ParseOBJ 中 UV clamp 到 [0,1] | 脖子仍有条纹 | 不同顶点 clamp 到边缘的不同 U → 采样不同颜色 |
| ④ V<0 定点重映射 | V<0 → (0.497, 0.5)；U 做 Clamp01 | 脖子肤色、头顶锯齿 | Per-vertex remap 和 GPU Clamp 行为不一致 |

## 最终修复（正确方案）

> 💡 **核心原则：和 Three.js 保持 100% 一致 — 不做任何纹理/UV 处理**

### 改动清单

#### `UVTextureLoader.cs`

1. **`DEBUG_MODE = 2`**（raw texture）— 跳过 `MakeSkinBaseTexture` 和所有纹理后处理
2. **禁用 `PadTextureEdges`** — 注释掉调用
3. **ParseOBJ UV 原样传入** — `uvs.Add(new Vector2(u, v))` 不做任何 clamp/remap
4. **`tex.wrapMode = TextureWrapMode.Clamp`** — 等价于 Three.js `ClampToEdgeWrapping`

### 有效的配置组合

```
纹理处理: 无 (raw)           ← 匹配 Three.js
UV 坐标: 原样传入             ← 匹配 Three.js OBJLoader
Wrap 模式: Clamp             ← 匹配 Three.js ClampToEdgeWrapping
Mipmap: ON + Trilinear       ← 匹配 Three.js LinearMipmapLinearFilter
Anisotropy: 16               ← 匹配 Three.js getMaxAnisotropy()
```

## 关键经验教训

### 1. GPU Clamp ≠ CPU Clamp

GPU 的 `ClampToEdge` 是**逐像素**在片段着色器采样时执行，正确处理三角形内的 UV 插值。
CPU 端的 `Clamp01` 是**逐顶点**的，破坏了 GPU 插值的连续性。

### 2. 纹理后处理与 UV 处理是耦合的

`MakeSkinBaseTexture` 把暗色边缘替换为肤色后，任何 UV 修复都无法还原 —
因为纹理本身已经没有暗色边缘了。必须从纹理处理和 UV 处理**同时**修正。

### 3. 参考实现是黄金标准

有 `face_viewer.html` 作为正确参考，应该**第一时间**完整对比两个渲染管线的每一步差异
（纹理加载 → 纹理处理 → UV 传递 → Wrap 模式），而不是猜测性地修补 UV。

### 4. 分析数据驱动决策

Python UV 分析脚本 (`check_verts.py`, `analyze_uv.py`) 提供了关键数据：
- 95 个 seam 顶点的精确 UV 坐标和分布
- 96 个脖子顶点全部 V = -0.284
- UV distortion ratio 分布揭示了问题集中在耳朵/太阳穴区域

## 同时修复的其他问题

### Dev Mode 竞态条件

`app/src/main.ts` 中 `autoLoadCachedJob` 在 Unity JSBridge 未初始化时就调用
`loadFaceModel` → `SendMessage: object JSBridge not found!`

**修复**：新增 `waitForUnityScene(8000)` — 等待 Unity 发出第一条 `unity-message` 事件
（证明 JSBridge 已就绪），最多等 8 秒。

### Dev Mode 自动加载

- 服务端新增 `/api/jobs/latest` 端点，返回最近的 job
- 前端检测 `?dev` 参数，跳过 landing page 直接进入 editor
