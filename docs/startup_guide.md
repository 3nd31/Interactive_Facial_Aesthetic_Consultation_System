# FaceVR 项目启动指南

## 系统架构概览

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Vite 前端      │────▶│  Express 中间层   │────▶│  FreeUV GPU 服务  │
│  :5173           │     │  :3001            │     │  :18897           │
│  (Three.js)      │     │  (API + WebSocket)│     │  (FastAPI/Python) │
└────────┬─────────┘     └──────────────────┘     └──────────────────┘
         │
         ▼
┌──────────────────┐
│  Unity WebGL     │
│  (iframe 嵌入)    │
└──────────────────┘
```

---

## 1. 前端 (Vite + Three.js)

| 项目 | 值 |
|------|-----|
| 目录 | `app/` |
| 端口 | `5173` |
| 技术栈 | Vite + TypeScript + Three.js + MediaPipe |

### 安装依赖
```powershell
cd e:\xb_all\3deditor\app
npm install
```

### 启动开发服务器
```powershell
cd e:\xb_all\3deditor\app
npm run dev
```

### 生产构建
```powershell
cd e:\xb_all\3deditor\app
npm run build       # tsc && vite build
npm run preview     # 预览生产构建
```

> **配置**: `vite.config.ts` — 端口 5173，自动打开浏览器，支持 `.wgsl` / `.ply` / `.spz` 资产。

---

## 2. 后端中间层 (Express + WebSocket)

| 项目 | 值 |
|------|-----|
| 目录 | `server/` |
| 端口 | `3001` |
| 技术栈 | Express + WebSocket + tsx |

### 安装依赖
```powershell
cd e:\xb_all\3deditor\server
npm install
```

### 启动开发服务器（热重载）
```powershell
cd e:\xb_all\3deditor\server
npm run dev         # tsx watch index.ts
```

### 启动生产服务器
```powershell
cd e:\xb_all\3deditor\server
npm start           # tsx index.ts
```

### 环境变量
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FREEUV_GPU_URL` | `http://localhost:18897` | FreeUV GPU 服务地址 |
| `WS_TOKEN_SECRET` | `facevr-dev-secret` | WebSocket 认证密钥 |
| `NODE_ENV` | - | 设为 `production` 时启用 Token 认证 |

### API 端点一览
| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/face` | 上传照片 → GPU 生成 3D 模型 (ZIP) |
| `POST` | `/api/deform` | FLAME shape 参数 → 返回变形 OBJ |
| `GET`  | `/api/schema` | 获取滑块参数配置 |
| `GET`  | `/api/health` | 服务健康检查 |
| `GET`  | `/api/jobs/latest` | 获取最新 Job |
| `GET`  | `/api/job/:jobId` | 查询 Job 状态 |
| `WS`   | `/ws` | WebSocket 实时通信 |

---

## 3. Unity WebGL 构建

| 项目 | 值 |
|------|-----|
| 目录 | `unity-project/` |
| Unity 版本 | `6000.3.2f1` |
| 编辑器路径 | `E:\unity_editor\6000.3.2f1\Editor\Unity.exe` |
| 输出目录 | `app/public/unity-build/` |

### 命令行构建（开发版）
```powershell
& "E:\unity_editor\6000.3.2f1\Editor\Unity.exe" `
    -batchmode -nographics `
    -projectPath "E:\xb_all\3deditor\unity-project" `
    -executeMethod BuildScript.BuildWebGLDev `
    -logFile - -quit
```

### 回退构建（无自定义脚本）
```powershell
& "E:\unity_editor\6000.3.2f1\Editor\Unity.exe" `
    -batchmode -nographics `
    -projectPath "E:\xb_all\3deditor\unity-project" `
    -buildTarget WebGL `
    -logFile - -quit
```

> **构建脚本**: `Assets/Editor/BuildScript.cs`，输出到 `app/public/unity-build/`，前端 Vite 自动提供静态服务。

---

## 4. 完整启动流程

### 日常开发（推荐顺序）

```
# 终端 1 — 后端服务
cd e:\xb_all\3deditor\server
npm run dev

# 终端 2 — 前端服务
cd e:\xb_all\3deditor\app
npm run dev

# (仅需要时) 终端 3 — Unity 重构建
# 构建完成后前端自动加载新 WebGL 产物
```

### 首次环境搭建

1. **安装 Node.js** (≥18)
2. **安装前端依赖**: `cd app && npm install`
3. **安装后端依赖**: `cd server && npm install`
4. **Unity Hub** 安装编辑器 `6000.3.2f1`，参考 `unity-project/SETUP_GUIDE.md`
5. **首次 Unity 构建**: 执行上方命令行构建命令
6. **启动后端**: `cd server && npm run dev`
7. **启动前端**: `cd app && npm run dev`
8. **访问**: `http://localhost:5173`

### 访问地址汇总
| 服务 | 地址 |
|------|------|
| 前端页面 | `http://localhost:5173` |
| 前端 Dev 模式 | `http://localhost:5173/?dev` |
| 后端 API | `http://localhost:3001` |
| WebSocket | `ws://localhost:3001/ws` |
| 健康检查 | `http://localhost:3001/api/health` |
| GPU 服务 | `http://localhost:18897` (外部) |
