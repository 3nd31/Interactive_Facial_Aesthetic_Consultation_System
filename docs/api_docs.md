# FreeUV 3D 面部重建 API 接口文档

**基础 URL**: `http://198.18.0.44:47389`
**协议**: HTTP
**请求格式**: 详见各接口说明

本服务基于 FastAPI 构建，提供照片到 3D 模型的端到端生成及变形能力。
> **💡 提示**: 服务启动后，您也可以直接在浏览器中访问 `http://<服务器IP>:47389/docs` 查看可交互的 Swagger UI API 文档并进行在线测试。

---

## 1. 健康检查

**接口:** `GET /api/health`
**描述:** 获取服务器当前状态及 GPU 显存加载情况。

**请求头:** 无
**请求参数:** 无

**响应内容:**
```json
{
  "status": "ok",
  "service": "freeuv",
  "version": "1.0.0",
  "cuda": true,
  "gpu": "NVIDIA GeForce RTX 4090",
  "model_loaded": true
}
```

---

## 2. 照片转生成 3D 模型与纹理 (核心接口)

**接口:** `POST /api/face`
**描述:** 上传单张人脸照片，服务器进行人脸检测、FLAME 参数拟合，并应用高级处理管线生成包含真实眼睛和毛发的高清皮肤纹理贴图，最后打包成 ZIP 模型库返回。

**请求头:** `Content-Type: multipart/form-data`
**表单参数 (Form Data):**
*   `photo` (File, 必填): 用户上传的照片文件 (推荐 `.jpg` 或 `.png`)，最大支持 15MB。

**响应头:**
*   `Content-Disposition: attachment; filename=face_result.zip`
*   `X-Processing-Time-Ms`: 处理耗时（毫秒）

**响应内容:** 二进制 ZIP 文件数据 (`application/zip`)
ZIP 压缩包内部包含以下 4 个文件结构：
1.  `face.obj`: FLAME 网格文件（已包含与贴图对应的完整 UV 坐标）
2.  `uv_texture.png`: 512x512 高清完整面部纹理贴图（即完美处理带有原生眼球和发际线贴图的成品）
3.  `params.json`: 从照片中拟合提取的全部 FLAME 参数，包括 200 维 shape，100 维 expression 等。
4.  `flaw_uv.jpg`: （可选留存）带有黑色阴影的原生缺陷投影矩阵对比图。

---

## 3. 同步修改 FLAME 参数获取最新网格 (捏脸变形)

**接口:** `POST /api/deform`
**描述:** 接受由前端（如 Unity 端滑杆操作）动态传递的 FLAME 面部参数，后台在 20ms 的极低延迟下计算并返回形变后的最新 3D 网络顶点文件。

**请求头:** `Content-Type: application/json`
**请求体 (JSON):**
```json
{
  "shape": [0.0, 0.0, ..., 0.0],       // 必填。长度必须为刚好 200 维的浮点数组
  "expression": [0.0, 0.0, ..., 0.0]  // 可选。长度必须为刚好 100 维的浮点数组，缺省默认为全 0
}
```

**响应头:**
*   `Content-Disposition: attachment; filename=deformed.obj`
*   `X-Processing-Time-Ms`: 变形计算处理耗时（毫秒）

**响应内容:** OBJ 格式的文本字符串 (`text/plain`)
返回修改了物理顶点 (vertices `v`) 但保留原始展开坐标 (texture `vt`) 的 `deformed.obj` 内容。前端直接应用替换当前网格或渲染。

---

## 4. 获取控制端滑杆 Schema 配置

**接口:** `GET /api/schema`
**描述:** 返回一份标准化的参数配置说明，定义了返回字典，Unity 等前端可解析该字典自动渲染构建出结构化的调节滑杆组件。

**请求参数:** 无

**响应内容:**
```json
{
  "shape": {
    "dim": 200,
    "description": "FLAME shape PCA 参数 (面部骨骼形状)",
    "range": [
      -3.0,
      3.0
    ],
    "semantic_groups": {
      "face_width": {
        "indices": [0, 1, 2],
        "label": "脸型宽窄"
      },
      "face_length": {
        "indices": [3, 4, 5],
        "label": "脸型长短"
      },
      "jaw": { ... },
      "nose": { ... },
      // ... 等十数个预分类器官参数部位组合
    }
  },
  "expression": {
    "dim": 100,
    "description": "FLAME expression PCA 参数 (面部表情)",
    "range": [
      -2.0,
      2.0
    ]
  }
}
```
