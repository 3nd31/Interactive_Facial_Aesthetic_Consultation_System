using UnityEngine;
using UnityEngine.Networking;
using System.Collections;

/// <summary>
/// UVTextureLoader — Downloads and applies UV texture maps from FreeUV server.
/// Replaces the old PLYImporter + GaussianRenderer pipeline.
/// </summary>
public class UVTextureLoader : MonoBehaviour
{
    [Header("Server Settings")]
    public string serverUrl = "http://localhost:3001";

    [Header("References")]
    public MeshRenderer targetRenderer;
    public MeshFilter targetMeshFilter;

    private Material faceMaterial;
    private Material eyeMaterial;

    // Exposed for LocalDeformer integration
    /// <summary>Mesh vertex → FLAME vertex index mapping (primary parent, from last ParseOBJ call)</summary>
    public int[] lastVertexMapping { get; private set; }
    /// <summary>Secondary parent FLAME index for subdivision midpoints (-1 if not a midpoint)</summary>
    public int[] lastVertexMapping2 { get; private set; }
    /// <summary>Scale factor applied by ParseOBJ normalization</summary>
    public float lastMeshScale { get; private set; } = 1f;

    void Start()
    {
        // Try shaders in order: URP Lit → Standard → Diffuse (fallback)
        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        if (shader == null) shader = Shader.Find("Diffuse");

        if (shader != null)
        {
            faceMaterial = new Material(shader);
            faceMaterial.SetFloat("_Smoothness", 0.35f);  // roughness 0.65 (matches face_viewer.html)
            faceMaterial.SetFloat("_Metallic", 0.0f);
            // DoubleSide rendering — matches face_viewer.html (THREE.DoubleSide)
            faceMaterial.SetInt("_Cull", (int)UnityEngine.Rendering.CullMode.Off);

            // Eyeball material — Sprites/Default supports vertex colors for pupil
            eyeMaterial = new Material(Shader.Find("Sprites/Default"));
            eyeMaterial.color = Color.white;
        }
        else
        {
            faceMaterial = new Material(Shader.Find("Sprites/Default"));
            eyeMaterial = new Material(Shader.Find("Sprites/Default"));
            eyeMaterial.color = new Color(0.92f, 0.90f, 0.88f, 1f);
            Debug.LogWarning("[UVTextureLoader] No suitable shader found, using Sprites/Default");
        }

        if (targetRenderer != null)
        {
            targetRenderer.sharedMaterials = new Material[] { faceMaterial, eyeMaterial };
        }
    }

    /// <summary>
    /// Load UV texture from URL and apply to the face mesh.
    /// </summary>
    public void LoadUVTexture(string uvUrl)
    {
        StartCoroutine(DownloadAndApplyTexture(uvUrl));
    }

    /// <summary>
    /// Load UV texture from a local file path.
    /// </summary>
    public void LoadUVTextureFromFile(string filePath)
    {
        if (System.IO.File.Exists(filePath))
        {
            byte[] bytes = System.IO.File.ReadAllBytes(filePath);
            Texture2D tex = new Texture2D(1024, 1024, TextureFormat.RGBA32, true); // true = mipmaps ON (matches Three.js face_viewer)
            tex.LoadImage(bytes);
            tex.Apply();
            ApplyTexture(tex);
        }
        else
        {
            Debug.LogError($"[UVTextureLoader] File not found: {filePath}");
        }
    }

    private IEnumerator DownloadAndApplyTexture(string uvUrl)
    {
        string fullUrl = uvUrl.StartsWith("http") ? uvUrl : serverUrl + uvUrl;
        Debug.Log($"[UVTextureLoader] Downloading: {fullUrl}");

        using (var request = UnityWebRequestTexture.GetTexture(fullUrl))
        {
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                Texture2D dlTex = DownloadHandlerTexture.GetContent(request);
                // Re-create WITH mipmaps to match Three.js face_viewer.html
                Texture2D tex = new Texture2D(dlTex.width, dlTex.height, dlTex.format, true);
                tex.SetPixels(dlTex.GetPixels());
                tex.Apply(true); // true = update mipmaps
                ApplyTexture(tex);
                Debug.Log($"[UVTextureLoader] Texture loaded: {tex.width}x{tex.height}");
            }
            else
            {
                Debug.LogError($"[UVTextureLoader] Download failed: {request.error}");
            }
        }
    }

    private void ApplyTexture(Texture2D tex)
    {
        if (faceMaterial != null)
        {
            // === TEXTURE PROCESSING MODE ===
            // 0 = Compositing + skin fill (causes edge bleeding on non-face areas)
            // 1 = Plain skin (uniform color, no face photo)
            // 2 = Raw photo (no processing — matches Three.js face_viewer.html exactly)
            int DEBUG_MODE = 2; // Raw: matches Three.js (no MakeSkinBaseTexture, no PadTextureEdges)

            if (DEBUG_MODE == 1)
            {
                Color skinColor = SampleSkinColor(tex.GetPixels(), tex.width, tex.height);
                Color[] uniformPixels = new Color[tex.width * tex.height];
                for (int i = 0; i < uniformPixels.Length; i++) uniformPixels[i] = skinColor;
                tex.SetPixels(uniformPixels);
                tex.Apply();
                Debug.Log($"[UVTextureLoader] DEBUG MODE 1: Plain skin");
            }
            else if (DEBUG_MODE == 0)
            {
                MakeSkinBaseTexture(tex);
            }
            // DEBUG_MODE == 2: raw photo — zero texture processing (like Three.js)
            Debug.Log($"[UVTextureLoader] Texture mode: {DEBUG_MODE} (0=composited, 1=plain, 2=raw)");

            // PadTextureEdges disabled — it inpaints skin color into texture edges,
            // which causes horizontal streaks on back of head when seam vertices
            // (UV clamped to 0/1) sample these skin-colored edge pixels.
            // Three.js face_viewer.html has no texture padding and looks correct.
            // PadTextureEdges(tex, 200);

            // No color correction — use raw texture like Three.js
            // Lighting handles the visual look, texture stays pristine

            faceMaterial.mainTexture = tex;

            // Match Three.js face_viewer.html texture settings EXACTLY:
            // tex.generateMipmaps = true (done in constructor)
            // tex.minFilter = LinearMipmapLinearFilter → Unity Trilinear
            // tex.magFilter = LinearFilter → Unity Bilinear (auto with Trilinear)
            // tex.anisotropy = max → Unity max anisoLevel
            // Default wrapS/wrapT = RepeatWrapping → Unity Repeat
            tex.wrapMode = TextureWrapMode.Clamp; // CRITICAL: FLAME UV has coords outside [0,1], Repeat wraps them to face content!
            tex.anisoLevel = 16; // max anisotropy (matches Three.js getMaxAnisotropy)
            tex.filterMode = FilterMode.Trilinear; // matches LinearMipmapLinearFilter

            // Normal map disabled — vertex normals are sufficient (matches face_viewer.html)
            // Generating normal from albedo causes patchy artifacts on non-face areas
            // Texture2D normalMap = NormalMapGenerator.GenerateFromAlbedo(tex, 1.5f);
            // faceMaterial.EnableKeyword("_NORMALMAP");
            // faceMaterial.SetTexture("_BumpMap", normalMap);
            // faceMaterial.SetFloat("_BumpScale", 0.3f);
            // Debug.Log($"[UVTextureLoader] Normal map generated: {normalMap.width}x{normalMap.height}");
        }

        if (targetRenderer != null)
        {
            // Use sharedMaterials (not .materials) to avoid copies — texture updates reflect immediately
            targetRenderer.sharedMaterials = new Material[] { faceMaterial, eyeMaterial };
        }
    }

    /// <summary>
    /// Inpaint UV texture background using center-outward face detection.
    /// The UV texture center is always face content. BFS from center finds the
    /// face region, everything outside is background → fill with nearest skin color.
    /// </summary>
    private void PadTextureEdges(Texture2D tex, int inpaintPasses)
    {
        int w = tex.width;
        int h = tex.height;
        Color[] pixels = tex.GetPixels();
        float blackThreshold = 0.02f;

        // Step 1: BFS from center to find face region (connected non-black pixels)
        bool[] isFace = new bool[w * h];
        var queue = new System.Collections.Generic.Queue<int>();

        // Seed: center of texture
        int cx = w / 2, cy = h / 2;
        int seedIdx = cy * w + cx;
        isFace[seedIdx] = true;
        queue.Enqueue(seedIdx);

        int[] d4x = { -1, 1, 0, 0 };
        int[] d4y = { 0, 0, -1, 1 };

        while (queue.Count > 0)
        {
            int idx = queue.Dequeue();
            int px = idx % w, py = idx / w;
            for (int d = 0; d < 4; d++)
            {
                int nx = px + d4x[d], ny = py + d4y[d];
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                int ni = ny * w + nx;
                if (isFace[ni]) continue;

                // Check if this neighbor is non-black (face content)
                Color c = pixels[ni];
                float lum = c.r * 0.299f + c.g * 0.587f + c.b * 0.114f;
                if (lum >= blackThreshold)
                {
                    isFace[ni] = true;
                    queue.Enqueue(ni);
                }
            }
        }

        // isBg = NOT face
        bool[] isBg = new bool[w * h];
        int bgCount = 0;
        for (int i = 0; i < isBg.Length; i++)
        {
            isBg[i] = !isFace[i];
            if (isBg[i]) bgCount++;
        }
        Debug.Log($"[UVTextureLoader] Face mask: {w * h - bgCount} face, {bgCount} background");

        // Step 2: Multi-pass inpaint — expand face skin into background
        int[] d8x = { -1, 1, 0, 0, -1, -1, 1, 1 };
        int[] d8y = { 0, 0, -1, 1, -1, 1, -1, 1 };
        int totalFilled = 0;

        for (int pass = 0; pass < inpaintPasses; pass++)
        {
            Color[] newPixels = (Color[])pixels.Clone();
            bool[] newBg = (bool[])isBg.Clone();
            int filled = 0;

            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    int idx = y * w + x;
                    if (!isBg[idx]) continue;

                    float r = 0, g = 0, b = 0;
                    int count = 0;
                    for (int d = 0; d < 8; d++)
                    {
                        int nx = x + d8x[d], ny = y + d8y[d];
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        int ni = ny * w + nx;
                        if (!isBg[ni])
                        {
                            r += pixels[ni].r;
                            g += pixels[ni].g;
                            b += pixels[ni].b;
                            count++;
                        }
                    }

                    if (count > 0)
                    {
                        newPixels[idx] = new Color(r / count, g / count, b / count, 1f);
                        newBg[idx] = false;
                        filled++;
                    }
                }
            }

            pixels = newPixels;
            isBg = newBg;
            totalFilled += filled;
            if (filled == 0) break;
        }

        tex.SetPixels(pixels);
        tex.Apply();
        Debug.Log($"[UVTextureLoader] Inpainted {totalFilled} bg pixels ({inpaintPasses} max passes)");
    }

    /// <summary>
    /// Create a simple procedural eyeball texture: white sclera + black iris/pupil center.
    /// </summary>
    private Texture2D CreateEyeTexture()
    {
        int size = 64;
        Texture2D tex = new Texture2D(size, size, TextureFormat.RGBA32, true);
        Color[] pixels = new Color[size * size];

        float cx = size * 0.5f;
        float cy = size * 0.5f;
        float irisRadius = size * 0.35f;  // Iris circle
        float pupilRadius = size * 0.15f; // Inner pupil

        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float dx = x - cx;
                float dy = y - cy;
                float dist = Mathf.Sqrt(dx * dx + dy * dy);

                if (dist < pupilRadius)
                {
                    // Black pupil
                    pixels[y * size + x] = Color.black;
                }
                else if (dist < irisRadius)
                {
                    // Dark brown iris
                    float t = (dist - pupilRadius) / (irisRadius - pupilRadius);
                    Color irisColor = new Color(0.25f, 0.15f, 0.08f, 1f);
                    Color irisEdge = new Color(0.35f, 0.22f, 0.12f, 1f);
                    pixels[y * size + x] = Color.Lerp(irisColor, irisEdge, t);
                }
                else
                {
                    // White sclera
                    pixels[y * size + x] = new Color(0.95f, 0.93f, 0.92f, 1f);
                }
            }
        }

        tex.SetPixels(pixels);
        tex.Apply(true);
        tex.filterMode = FilterMode.Bilinear;
        tex.wrapMode = TextureWrapMode.Clamp;
        Debug.Log("[UVTextureLoader] Procedural eye texture created (64x64)");
        return tex;
    }

    /// <summary>
    /// Minimal processing: replace BLUE-toned UV background with skinColor.
    /// Eyebrows (warm/brown, R > B) are preserved.
    /// UV background (cool/blue, B > R) → skinColor.
    /// No ellipse, no position detection.
    /// </summary>
    private void MakeSkinBaseTexture(Texture2D tex)
    {
        int w = tex.width;
        int h = tex.height;
        Color[] pixels = tex.GetPixels();

        Color skinColor = SampleSkinColor(pixels, w, h);
        Debug.Log($"[UVTextureLoader] Skin base: R={skinColor.r:F2} G={skinColor.g:F2} B={skinColor.b:F2}");

        int replaced = 0;
        for (int i = 0; i < pixels.Length; i++)
        {
            Color c = pixels[i];
            float brightness = c.r * 0.299f + c.g * 0.587f + c.b * 0.114f;

            bool isBackground = false;

            // Pure black or very dark (UV gaps + dark edge content on back-of-head)
            if (brightness < 0.08f)
                isBackground = true;
            // Dark AND blue-dominant (slightly brighter UV background that is blue-tinted)
            else if (brightness < 0.15f && c.b > c.r && c.b > c.g)
                isBackground = true;

            if (isBackground)
            {
                pixels[i] = skinColor;
                replaced++;
            }
        }

        tex.SetPixels(pixels);
        tex.Apply(true);
        Debug.Log($"[UVTextureLoader] Background fill: {replaced}/{pixels.Length} px → skinColor");
    }

    /// <summary>
    /// Repair UV seam by directly painting the texture at seam locations.
    /// Finds co-located vertices with different UVs (UV seam), samples both sides,
    /// paints averaged color back at both UV positions + surrounding pixels.
    /// No shader change needed — works with any shader.
    /// </summary>
    private void RepairSeamInTexture(Mesh mesh, Texture2D tex)
    {
        var verts = mesh.vertices;
        var uvs = new System.Collections.Generic.List<Vector2>();
        mesh.GetUVs(0, uvs);

        if (uvs.Count != verts.Length || !tex.isReadable) return;

        int w = tex.width;
        int h = tex.height;
        Color[] pixels = tex.GetPixels();

        // Spatial hash: find co-located vertices
        var posGroups = new System.Collections.Generic.Dictionary<long, System.Collections.Generic.List<int>>();
        float quantize = 10000f;

        for (int i = 0; i < verts.Length; i++)
        {
            long key = ((long)(verts[i].x * quantize)) * 73856093L
                      ^ ((long)(verts[i].y * quantize)) * 19349663L
                      ^ ((long)(verts[i].z * quantize)) * 83492791L;

            if (!posGroups.ContainsKey(key))
                posGroups[key] = new System.Collections.Generic.List<int>();
            posGroups[key].Add(i);
        }

        int seamVerts = 0;
        int pixelsPainted = 0;
        int brushRadius = 3; // Small precise brush — just enough for bilinear coverage

        foreach (var group in posGroups.Values)
        {
            if (group.Count <= 1) continue;

            // Collect unique UV positions at this 3D position
            var uniqueUVs = new System.Collections.Generic.List<Vector2>();
            foreach (int idx in group)
            {
                bool found = false;
                foreach (var existing in uniqueUVs)
                {
                    if (Vector2.Distance(uvs[idx], existing) < 0.002f) { found = true; break; }
                }
                if (!found) uniqueUVs.Add(uvs[idx]);
            }

            if (uniqueUVs.Count <= 1) continue;
            seamVerts++;

            // Sample color at the FIRST UV position (canonical color)
            Vector2 canonicalUV = uniqueUVs[0];
            int cpx = Mathf.Clamp(Mathf.RoundToInt(canonicalUV.x * (w - 1)), 0, w - 1);
            int cpy = Mathf.Clamp(Mathf.RoundToInt(canonicalUV.y * (h - 1)), 0, h - 1);
            Color canonicalColor = pixels[cpy * w + cpx];

            // If canonical is too dark, try the other UV
            float brightness = canonicalColor.r * 0.299f + canonicalColor.g * 0.587f + canonicalColor.b * 0.114f;
            if (brightness < 0.10f && uniqueUVs.Count > 1)
            {
                Vector2 altUV = uniqueUVs[1];
                int apx = Mathf.Clamp(Mathf.RoundToInt(altUV.x * (w - 1)), 0, w - 1);
                int apy = Mathf.Clamp(Mathf.RoundToInt(altUV.y * (h - 1)), 0, h - 1);
                canonicalColor = pixels[apy * w + apx];
            }

            // Paint this SAME color at ALL UV positions — ensures both sides match
            foreach (var uv in uniqueUVs)
            {
                pixelsPainted += PaintBrush(pixels, w, h, uv, canonicalColor, brushRadius);
            }
        }

        tex.SetPixels(pixels);
        tex.Apply();
        Debug.Log($"[UVTextureLoader] Seam repair: {seamVerts} seam verts, {pixelsPainted} px matched");
    }

    /// <summary>Paint a soft circular brush onto the pixel array at a UV position.</summary>
    private int PaintBrush(Color[] pixels, int w, int h, Vector2 uv, Color color, int radius)
    {
        int cx = Mathf.Clamp(Mathf.RoundToInt(uv.x * (w - 1)), 0, w - 1);
        int cy = Mathf.Clamp(Mathf.RoundToInt(uv.y * (h - 1)), 0, h - 1);
        int count = 0;

        for (int dy = -radius; dy <= radius; dy++)
        {
            for (int dx = -radius; dx <= radius; dx++)
            {
                int px = Mathf.Clamp(cx + dx, 0, w - 1);
                int py = Mathf.Clamp(cy + dy, 0, h - 1);
                float dist = Mathf.Sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;

                float blend = 1f - (dist / (radius + 1f));
                blend = blend * blend;

                int idx = py * w + px;
                pixels[idx] = Color.Lerp(pixels[idx], color, blend);
                count++;
            }
        }
        return count;
    }

    /// <summary>
    /// Apply soft elliptical fade mask to UV texture:
    /// - Face center: 100% original texture
    /// - Edges: smooth gradient fade to sampled skin color
    /// - Outside face: 100% skin color
    /// This eliminates UV seams entirely — only the face region shows texture.
    /// </summary>
    private void FillEmptyUVRegions(Texture2D tex)
    {
        int w = tex.width;
        int h = tex.height;
        Color[] pixels = tex.GetPixels();

        // Sample skin color from face center
        Color skinColor = SampleSkinColor(pixels, w, h);
        Debug.Log($"[UVTextureLoader] Skin color: R={skinColor.r:F2} G={skinColor.g:F2} B={skinColor.b:F2}");

        // FLAME UV layout: face centered roughly at (0.5, 0.55) in UV space
        float cx = w * 0.50f;
        float cy = h * 0.55f;
        float rx = w * 0.36f;   // Face radius X
        float ry = h * 0.42f;   // Face radius Y

        // Wider fade zone (0.75..1.0): ensures texture fades to skin color
        // well before hitting the UV override boundary at nZ=0.35
        float fadeStart = 0.75f;
        float fadeEnd = 1.0f;

        int replaced = 0;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int idx = y * w + x;
                float ddx = (x - cx) / rx;
                float ddy = (y - cy) / ry;
                float dist = Mathf.Sqrt(ddx * ddx + ddy * ddy);

                if (dist > fadeEnd)
                {
                    // Outside face: solid skin color
                    pixels[idx] = skinColor;
                    replaced++;
                }
                else if (dist > fadeStart)
                {
                    // Narrow fade zone: blend texture → skin color
                    float t = (dist - fadeStart) / (fadeEnd - fadeStart);
                    t = t * t * (3f - 2f * t); // smoothstep
                    pixels[idx] = Color.Lerp(pixels[idx], skinColor, t);
                    replaced++;
                }
                // else: inside face ellipse → 100% original texture (UNTOUCHED)
            }
        }

        tex.SetPixels(pixels);
        tex.Apply();
        Debug.Log($"[UVTextureLoader] UV fill: {replaced} non-face pixels → skin color");
    }

    /// <summary>
    /// Apply contrast and saturation correction to compensate for
    /// Unity Gamma space vs Three.js ACES filmic tone mapping.
    /// </summary>
    private void ApplyColorCorrection(Texture2D tex, float contrast, float saturation)
    {
        Color[] pixels = tex.GetPixels();

        for (int i = 0; i < pixels.Length; i++)
        {
            Color c = pixels[i];

            // Contrast boost (pivot at 0.5 midtone)
            c.r = Mathf.Clamp01((c.r - 0.5f) * contrast + 0.5f);
            c.g = Mathf.Clamp01((c.g - 0.5f) * contrast + 0.5f);
            c.b = Mathf.Clamp01((c.b - 0.5f) * contrast + 0.5f);

            // Saturation boost
            float gray = c.r * 0.299f + c.g * 0.587f + c.b * 0.114f;
            c.r = Mathf.Clamp01(gray + (c.r - gray) * saturation);
            c.g = Mathf.Clamp01(gray + (c.g - gray) * saturation);
            c.b = Mathf.Clamp01(gray + (c.b - gray) * saturation);

            // Warm tint: compensate for Unity's cooler rendering vs Three.js ACES
            c.r = Mathf.Clamp01(c.r + 0.02f);
            c.b = Mathf.Clamp01(c.b - 0.03f);

            pixels[i] = c;
        }

        tex.SetPixels(pixels);
        tex.Apply();
        Debug.Log($"[UVTextureLoader] Color correction: contrast={contrast:F2} saturation={saturation:F2}");
    }

    /// <summary>
    /// Sample average skin color from CHEEK areas (avoiding eyes, nose, mouth).
    /// Uses a narrow brightness range to exclude dark features and highlights.
    /// </summary>
    private Color SampleSkinColor(Color[] pixels, int w, int h)
    {
        // Sample from left cheek and right cheek regions in UV space
        // These regions avoid eyes, nose, mouth, and give pure skin tone
        int[][] regions = new int[][] {
            new int[] { (int)(w * 0.28f), (int)(w * 0.40f), (int)(h * 0.45f), (int)(h * 0.60f) }, // left cheek
            new int[] { (int)(w * 0.60f), (int)(w * 0.72f), (int)(h * 0.45f), (int)(h * 0.60f) }, // right cheek
        };

        float r = 0, g = 0, b = 0;
        int count = 0;

        foreach (var region in regions)
        {
            int step = Mathf.Max(1, (region[1] - region[0]) / 15);
            for (int x = region[0]; x < region[1]; x += step)
            {
                for (int y = region[2]; y < region[3]; y += step)
                {
                    Color c = pixels[y * w + x];
                    float brightness = c.r * 0.299f + c.g * 0.587f + c.b * 0.114f;
                    // Narrow range: skip dark shadows and bright highlights
                    if (brightness > 0.35f && brightness < 0.85f)
                    {
                        r += c.r;
                        g += c.g;
                        b += c.b;
                        count++;
                    }
                }
            }
        }

        if (count > 0)
        {
            return new Color(r / count, g / count, b / count, 1f);
        }

        // Fallback: generic skin tone
        return new Color(0.85f, 0.72f, 0.62f, 1f);
    }

    /// <summary>
    /// Load OBJ mesh from URL.
    /// </summary>
    public void LoadMesh(string meshUrl)
    {
        StartCoroutine(DownloadAndApplyMesh(meshUrl));
    }

    /// <summary>
    /// Load mesh from raw OBJ text (for live deformation updates).
    /// Keeps existing UV texture. Skips subdivision for real-time performance.
    /// Only parses vertices/faces and applies smooth normals.
    /// </summary>
    public void LoadMeshFromText(string objText)
    {
        Mesh mesh = ParseOBJ(objText);
        // NOTE: No SubdivideMesh here — subdivision is too slow for real-time slider drag.
        // The raw 5K mesh with smooth normals is adequate for interactive preview.
        if (mesh != null)
        {
            SmoothNormals(mesh);
        }
        if (mesh != null && targetMeshFilter != null)
        {
            targetMeshFilter.mesh = mesh;
            var collider = targetMeshFilter.GetComponent<MeshCollider>();
            if (collider != null) collider.sharedMesh = mesh;
        }
    }

    private IEnumerator DownloadAndApplyMesh(string meshUrl)
    {
        string fullUrl = meshUrl.StartsWith("http") ? meshUrl : serverUrl + meshUrl;
        Debug.Log($"[UVTextureLoader] Downloading mesh: {fullUrl}");

        using (var request = UnityWebRequest.Get(fullUrl))
        {
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                string objText = request.downloadHandler.text;
                Mesh mesh = ParseOBJ(objText);
                if (mesh != null)
                {
                    // Loop subdivision: 5K→20K vertices for smoother geometry
                    mesh = SubdivideMesh(mesh);
                    Debug.Log($"[UVTextureLoader] After subdivision: {mesh.vertexCount} verts, {mesh.triangles.Length / 3} tris");
                    // Split eyeball into submesh 1 AFTER subdivision
                    SplitEyeSubmesh(mesh);
                }
                if (mesh != null && targetMeshFilter != null)
                {
                    targetMeshFilter.mesh = mesh;
                    var collider = targetMeshFilter.GetComponent<MeshCollider>();
                    if (collider != null) collider.sharedMesh = mesh;
                    Debug.Log($"[UVTextureLoader] Mesh loaded: {mesh.vertexCount} verts, {mesh.triangles.Length / 3} tris");
                }
            }
            else
            {
                Debug.LogError($"[UVTextureLoader] Mesh download failed: {request.error}");
            }
        }
    }

    /// <summary>
    /// OBJ parser with RH→LH coordinate conversion for Unity.
    /// OBJ format is right-handed (Z forward), Unity is left-handed (Z backward).
    /// Key fixes vs raw parsing:
    ///   1. Negate Z for vertices (RH → LH)
    ///   2. Reverse face winding order (CW → CCW for Unity front-face)
    ///   3. UV Y stays as-is (OBJ vt origin = bottom-left = same as Unity)
    /// </summary>
    private Mesh ParseOBJ(string objText)
    {
        var vertices = new System.Collections.Generic.List<Vector3>();
        var uvs = new System.Collections.Generic.List<Vector2>();
        var meshVerts = new System.Collections.Generic.List<Vector3>();
        var meshUVs = new System.Collections.Generic.List<Vector2>();
        var triangles = new System.Collections.Generic.List<int>();
        var vertexMapping = new System.Collections.Generic.List<int>(); // mesh vert → FLAME vert idx
        var vertexCache = new System.Collections.Generic.Dictionary<long, int>(); // (vIdx << 20 | tIdx) → meshIndex

        string[] lines = objText.Split('\n');

        foreach (string line in lines)
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("v "))
            {
                string[] parts = trimmed.Split(' ', System.StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 4)
                {
                    float x = float.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
                    float y = float.Parse(parts[2], System.Globalization.CultureInfo.InvariantCulture);
                    float z = float.Parse(parts[3], System.Globalization.CultureInfo.InvariantCulture);
                    // RH → LH: negate Z
                    vertices.Add(new Vector3(x, y, -z));
                }
            }
            else if (trimmed.StartsWith("vt "))
            {
                string[] parts = trimmed.Split(' ', System.StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3)
                {
                    float u = float.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
                    float v = float.Parse(parts[2], System.Globalization.CultureInfo.InvariantCulture);
                    // Pass raw UV values — matches Three.js OBJLoader behavior.
                    // GPU TextureWrapMode.Clamp handles out-of-range coords at sampling time.
                    uvs.Add(new Vector2(u, v));
                }
            }
            else if (trimmed.StartsWith("f "))
            {
                string[] parts = trimmed.Split(' ', System.StringSplitOptions.RemoveEmptyEntries);
                int[] vIdx = new int[parts.Length - 1];
                int[] tIdx = new int[parts.Length - 1];

                for (int i = 1; i < parts.Length; i++)
                {
                    string[] sub = parts[i].Split('/');
                    vIdx[i - 1] = int.Parse(sub[0]) - 1;
                    tIdx[i - 1] = sub.Length > 1 && sub[1].Length > 0 ? int.Parse(sub[1]) - 1 : vIdx[i - 1];
                }

                // Triangulate fan, reversed winding for LH (swap v1 and v2)
                for (int i = 1; i < vIdx.Length - 1; i++)
                {
                    int idx0 = GetOrCreateVertex(vIdx[0], tIdx[0], vertices, uvs, meshVerts, meshUVs, vertexMapping, vertexCache);
                    int idx1 = GetOrCreateVertex(vIdx[i + 1], tIdx[i + 1], vertices, uvs, meshVerts, meshUVs, vertexMapping, vertexCache);
                    int idx2 = GetOrCreateVertex(vIdx[i], tIdx[i], vertices, uvs, meshVerts, meshUVs, vertexMapping, vertexCache);

                    triangles.Add(idx0);
                    triangles.Add(idx1);
                    triangles.Add(idx2);
                }
            }
        }

        Debug.Log($"[UVTextureLoader] ParseOBJ: {vertices.Count} v, {uvs.Count} vt → {meshVerts.Count} shared mesh verts (cache: {vertexCache.Count})");
        if (meshVerts.Count == 0) return null;

        Mesh mesh = new Mesh();
        if (meshVerts.Count > 65535)
            mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;

        mesh.SetVertices(meshVerts);
        mesh.SetUVs(0, meshUVs);
        mesh.SetTriangles(triangles, 0);
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();

        // Center the mesh (like Three.js viewer does)
        var bounds = mesh.bounds;
        var center = bounds.center;
        var verts = mesh.vertices;
        for (int i = 0; i < verts.Length; i++)
        {
            verts[i] -= center;
        }

        // Per-triangle UV override removed — broke mesh connectivity/surface smoothness.
        // MakeSkinBaseTexture handles non-face areas in texture space instead.

        // Auto-scale normalization: make mesh fit a target size
        // regardless of input coordinate system (mm vs m vs cm)
        float maxExtent = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
        float targetSize = 0.25f; // Target: head is ~0.25 Unity units tall
        if (maxExtent > 0.001f)
        {
            float scale = targetSize / maxExtent;
            for (int i = 0; i < verts.Length; i++)
            {
                verts[i] *= scale;
            }
            lastMeshScale = scale;
            Debug.Log($"[UVTextureLoader] Mesh scale: {maxExtent} → {targetSize} (factor: {scale:F6})");
        }

        mesh.vertices = verts;
        mesh.RecalculateBounds();

        // Store vertex mapping for LocalDeformer
        lastVertexMapping = vertexMapping.ToArray();
        // Original OBJ vertices have no secondary parent
        lastVertexMapping2 = new int[lastVertexMapping.Length];
        for (int i = 0; i < lastVertexMapping2.Length; i++) lastVertexMapping2[i] = -1;

        // Weld normals at UV seam vertices to eliminate lighting discontinuity
        WeldSeamNormals(mesh);

        return mesh;
    }

    /// <summary>
    /// Split eyeball triangles into submesh 1 (solid color material).
    /// Must run AFTER SubdivideMesh since subdivision merges all submeshes.
    /// Uses lastVertexMapping to identify which vertices are from FLAME eyeball region.
    /// </summary>
    private void SplitEyeSubmesh(Mesh mesh)
    {
        if (lastVertexMapping == null || lastVertexMapping.Length != mesh.vertexCount)
        {
            Debug.LogWarning("[UVTextureLoader] SplitEyeSubmesh: vertexMapping mismatch, skipping");
            return;
        }

        const int FLAME_EYE_START = 3931;
        int[] allTris = mesh.triangles;
        var faceTris = new System.Collections.Generic.List<int>();
        var eyeTris = new System.Collections.Generic.List<int>();

        for (int t = 0; t < allTris.Length; t += 3)
        {
            int i0 = allTris[t], i1 = allTris[t + 1], i2 = allTris[t + 2];
            // Map to FLAME index — subdivided midpoints use primary parent
            int f0 = lastVertexMapping[i0];
            int f1 = lastVertexMapping[i1];
            int f2 = lastVertexMapping[i2];

            // ALL three must be eye vertices (>= 3931 and valid)
            bool isEye = f0 >= FLAME_EYE_START && f1 >= FLAME_EYE_START && f2 >= FLAME_EYE_START
                      && f0 >= 0 && f1 >= 0 && f2 >= 0;

            if (isEye)
            {
                eyeTris.Add(i0); eyeTris.Add(i1); eyeTris.Add(i2);
            }
            else
            {
                faceTris.Add(i0); faceTris.Add(i1); faceTris.Add(i2);
            }
        }

        mesh.subMeshCount = 2;
        mesh.SetTriangles(faceTris, 0);
        mesh.SetTriangles(eyeTris, 1);

        // UV coordinates are used as-is from the OBJ (matching face_viewer.html / Three.js behavior).
        // Non-face areas (scalp, neck) may not have ideal UV coverage — this is by design.

        // Compute vertex colors for pupil/iris
        Vector3[] verts = mesh.vertices;
        Color[] colors = new Color[verts.Length];
        // Default: white (face vertices — ignored by face shader)
        for (int i = 0; i < colors.Length; i++) colors[i] = Color.white;

        if (eyeTris.Count > 0)
        {
            // Collect eye vertex indices
            var eyeVertSet = new System.Collections.Generic.HashSet<int>();
            for (int t = 0; t < eyeTris.Count; t++) eyeVertSet.Add(eyeTris[t]);

            // Split left/right eye by X position
            float avgX = 0;
            foreach (int vi in eyeVertSet) avgX += verts[vi].x;
            avgX /= eyeVertSet.Count;

            var leftEye = new System.Collections.Generic.List<int>();
            var rightEye = new System.Collections.Generic.List<int>();
            foreach (int vi in eyeVertSet)
            {
                if (verts[vi].x < avgX) leftEye.Add(vi);
                else rightEye.Add(vi);
            }

            // Color each eye
            ColorEyeVertices(verts, colors, leftEye);
            ColorEyeVertices(verts, colors, rightEye);
        }

        mesh.colors = colors;
        Debug.Log($"[UVTextureLoader] SplitEyeSubmesh: face={faceTris.Count/3} tris, eyes={eyeTris.Count/3} tris");
    }

    /// <summary>
    /// Color eye vertices: forward-facing = dark pupil/iris, side = white sclera.
    /// </summary>
    private void ColorEyeVertices(Vector3[] verts, Color[] colors, System.Collections.Generic.List<int> eyeIndices)
    {
        if (eyeIndices.Count == 0) return;

        // Compute eye center
        Vector3 center = Vector3.zero;
        foreach (int vi in eyeIndices) center += verts[vi];
        center /= eyeIndices.Count;

        // Colors
        Color sclera = new Color(0.95f, 0.93f, 0.91f); // Off-white
        Color iris = new Color(0.25f, 0.15f, 0.08f);    // Dark brown
        Color pupil = new Color(0.02f, 0.02f, 0.02f);   // Near black

        foreach (int vi in eyeIndices)
        {
            Vector3 dir = (verts[vi] - center).normalized;
            // Forward factor: how much this vertex faces forward (-Z direction)
            float forwardDot = Vector3.Dot(dir, Vector3.back); // -Z = forward in Unity

            if (forwardDot > 0.95f)
            {
                // Pupil center
                colors[vi] = pupil;
            }
            else if (forwardDot > 0.80f)
            {
                // Iris ring: blend from pupil to iris
                float t = (forwardDot - 0.80f) / 0.15f;
                colors[vi] = Color.Lerp(iris, pupil, t);
            }
            else if (forwardDot > 0.55f)
            {
                // Iris to sclera transition
                float t = (forwardDot - 0.55f) / 0.25f;
                colors[vi] = Color.Lerp(sclera, iris, t);
            }
            else
            {
                colors[vi] = sclera;
            }
        }
    }

    /// <summary>
    /// Remap eye vertex UVs using spherical projection from 3D geometry.
    /// Front-facing direction (negative Z) → UV center (0.5, 0.5) = pupil.
    /// </summary>
    private void RemapEyeUVs(
        System.Collections.Generic.List<Vector3> verts,
        System.Collections.Generic.List<Vector2> uvs,
        System.Collections.Generic.List<int> eyeIndices)
    {
        if (eyeIndices.Count == 0) return;

        // Compute eye center
        Vector3 center = Vector3.zero;
        foreach (int vi in eyeIndices) center += verts[vi];
        center /= eyeIndices.Count;

        // Spherical projection: direction from center → UV
        foreach (int vi in eyeIndices)
        {
            Vector3 dir = (verts[vi] - center).normalized;
            // Forward = negative Z (Unity LH) → UV center
            // atan2(x, -z) gives angle from forward, mapped to U
            // asin(y) gives elevation, mapped to V
            float u = 0.5f + Mathf.Atan2(dir.x, -dir.z) / (2f * Mathf.PI);
            float v = 0.5f + Mathf.Asin(Mathf.Clamp(dir.y, -1f, 1f)) / Mathf.PI;
            uvs[vi] = new Vector2(u, v);
        }
    }

    /// <summary>
    /// Get or create a mesh vertex for the given OBJ (v, vt) index pair.
    /// Reuses existing mesh vertex if this combination was seen before.
    /// </summary>
    private int GetOrCreateVertex(
        int vIdx, int tIdx,
        System.Collections.Generic.List<Vector3> vertices,
        System.Collections.Generic.List<Vector2> uvs,
        System.Collections.Generic.List<Vector3> meshVerts,
        System.Collections.Generic.List<Vector2> meshUVs,
        System.Collections.Generic.List<int> vertexMapping,
        System.Collections.Generic.Dictionary<long, int> cache)
    {
        long key = ((long)vIdx << 20) | (long)(tIdx & 0xFFFFF);

        if (cache.TryGetValue(key, out int meshIdx))
            return meshIdx;

        meshIdx = meshVerts.Count;
        meshVerts.Add(vIdx < vertices.Count ? vertices[vIdx] : Vector3.zero);
        meshUVs.Add(tIdx < uvs.Count ? uvs[tIdx] : Vector2.zero);
        vertexMapping.Add(vIdx);
        cache[key] = meshIdx;

        return meshIdx;
    }

    /// <summary>
    /// Find vertices sharing the same 3D position (UV seam duplicates)
    /// and average their normals. This eliminates lighting discontinuity at UV seams.
    /// Uses spatial hashing for O(n) performance.
    /// </summary>
    private void WeldSeamNormals(Mesh mesh)
    {
        var verts = mesh.vertices;
        var normals = mesh.normals;

        if (normals == null || normals.Length != verts.Length) return;

        // Spatial hash: quantize position → list of vertex indices
        var positionGroups = new System.Collections.Generic.Dictionary<long, System.Collections.Generic.List<int>>();
        float quantize = 10000f; // precision: 0.0001 units

        for (int i = 0; i < verts.Length; i++)
        {
            long key = ((long)(verts[i].x * quantize)) * 73856093L
                      ^ ((long)(verts[i].y * quantize)) * 19349663L
                      ^ ((long)(verts[i].z * quantize)) * 83492791L;

            if (!positionGroups.ContainsKey(key))
                positionGroups[key] = new System.Collections.Generic.List<int>();
            positionGroups[key].Add(i);
        }

        int weldedCount = 0;
        foreach (var group in positionGroups.Values)
        {
            if (group.Count <= 1) continue;

            // Average normals for co-located vertices
            Vector3 avgNormal = Vector3.zero;
            for (int i = 0; i < group.Count; i++)
                avgNormal += normals[group[i]];
            avgNormal = avgNormal.normalized;

            for (int i = 0; i < group.Count; i++)
                normals[group[i]] = avgNormal;

            weldedCount += group.Count;
        }

        mesh.normals = normals;
        Debug.Log($"[UVTextureLoader] Normal weld: {weldedCount} verts across {positionGroups.Count} unique positions");
    }

    /// <summary>
    /// Fix UV seam: for vertices at the same 3D position with different UVs,
    /// force ALL to use the average UV. This makes both sides of the seam
    /// sample the same texture pixel, eliminating visible seam cracks.
    /// Must be called BEFORE SubdivideMesh so midpoints inherit correct UVs.
    /// </summary>
    private void FixSeamUVs(Mesh mesh)
    {
        Vector3[] verts = mesh.vertices;
        var uvList = new System.Collections.Generic.List<Vector2>();
        mesh.GetUVs(0, uvList);
        if (uvList.Count != verts.Length) return;

        Vector2[] uvs = uvList.ToArray();
        float quantize = 10000f;

        // Group vertices by 3D position (spatial hash)
        var posGroups = new System.Collections.Generic.Dictionary<long, System.Collections.Generic.List<int>>();
        for (int i = 0; i < verts.Length; i++)
        {
            long key = ((long)(verts[i].x * quantize)) * 73856093L
                      ^ ((long)(verts[i].y * quantize)) * 19349663L
                      ^ ((long)(verts[i].z * quantize)) * 83492791L;

            if (!posGroups.ContainsKey(key))
                posGroups[key] = new System.Collections.Generic.List<int>();
            posGroups[key].Add(i);
        }

        int fixedCount = 0;
        foreach (var group in posGroups.Values)
        {
            if (group.Count <= 1) continue;

            // Check if UVs differ in this group
            bool hasDifferentUVs = false;
            for (int i = 1; i < group.Count; i++)
            {
                if (Vector2.Distance(uvs[group[0]], uvs[group[i]]) > 0.001f)
                {
                    hasDifferentUVs = true;
                    break;
                }
            }
            if (!hasDifferentUVs) continue;

            // Average all UVs in this group
            Vector2 avgUV = Vector2.zero;
            foreach (int idx in group) avgUV += uvs[idx];
            avgUV /= group.Count;

            // Assign averaged UV to all vertices
            foreach (int idx in group) uvs[idx] = avgUV;
            fixedCount++;
        }

        mesh.uv = uvs;
        Debug.Log($"[UVTextureLoader] FixSeamUVs: {fixedCount} seam vertex groups → averaged UVs");
    }

    /// <summary>
    /// For UV seam vertices (co-located with different UVs), sample the texture
    /// at each vertex's UV, compute the group average color, and store it in
    /// vertex colors. Alpha = blend strength (1.0 for seam verts, 0.0 for non-seam).
    /// </summary>
    private void BlendSeamVertexColors(Mesh mesh, Texture2D tex)
    {
        if (tex == null) return;

        var verts = mesh.vertices;
        var uvs = new System.Collections.Generic.List<Vector2>();
        mesh.GetUVs(0, uvs);

        if (uvs.Count != verts.Length) return;

        // Make texture readable
        var readableTex = tex;
        if (!tex.isReadable)
        {
            Debug.LogWarning("[UVTextureLoader] Texture not readable, skipping seam vertex color blend");
            return;
        }

        // Spatial hash to find co-located vertices
        var positionGroups = new System.Collections.Generic.Dictionary<long, System.Collections.Generic.List<int>>();
        float quantize = 10000f;

        for (int i = 0; i < verts.Length; i++)
        {
            long key = ((long)(verts[i].x * quantize)) * 73856093L
                      ^ ((long)(verts[i].y * quantize)) * 19349663L
                      ^ ((long)(verts[i].z * quantize)) * 83492791L;

            if (!positionGroups.ContainsKey(key))
                positionGroups[key] = new System.Collections.Generic.List<int>();
            positionGroups[key].Add(i);
        }

        // Initialize vertex colors: all transparent (no blend)
        var colors = new Color[verts.Length];
        for (int i = 0; i < colors.Length; i++)
            colors[i] = new Color(0, 0, 0, 0);

        int seamVerts = 0;
        int texW = readableTex.width;
        int texH = readableTex.height;
        Color[] pixels = readableTex.GetPixels();

        foreach (var group in positionGroups.Values)
        {
            if (group.Count <= 1) continue;

            // Check if UVs differ (true seam, not just shared vertex)
            bool hasUVDifference = false;
            Vector2 firstUV = uvs[group[0]];
            for (int i = 1; i < group.Count; i++)
            {
                if (Vector2.Distance(uvs[group[i]], firstUV) > 0.001f)
                {
                    hasUVDifference = true;
                    break;
                }
            }

            if (!hasUVDifference) continue;

            // Sample texture at each vertex UV and compute average
            Color avgColor = Color.black;
            int validSamples = 0;

            for (int i = 0; i < group.Count; i++)
            {
                Vector2 uv = uvs[group[i]];
                int px = Mathf.Clamp((int)(uv.x * texW), 0, texW - 1);
                int py = Mathf.Clamp((int)(uv.y * texH), 0, texH - 1);
                Color sampled = pixels[py * texW + px];
                float brightness = sampled.r * 0.299f + sampled.g * 0.587f + sampled.b * 0.114f;

                if (brightness > 0.05f) // Skip black/invalid pixels
                {
                    avgColor += sampled;
                    validSamples++;
                }
            }

            if (validSamples > 0)
            {
                avgColor /= validSamples;
                avgColor.a = 1f; // Mark as seam vertex

                for (int i = 0; i < group.Count; i++)
                {
                    colors[group[i]] = avgColor;
                }
                seamVerts += group.Count;
            }
        }

        mesh.colors = colors;
        Debug.Log($"[UVTextureLoader] Seam vertex colors: {seamVerts} seam vertices blended");
    }

    /// <summary>
    /// Midpoint subdivision: each triangle → 4 triangles.
    /// Interpolates vertices and UVs at edge midpoints.
    /// Result: 4× triangle count, ~2× vertex count (shared edges).
    /// Also propagates lastVertexMapping for LocalDeformer.
    /// </summary>
    private Mesh SubdivideMesh(Mesh source)
    {
        Vector3[] srcVerts = source.vertices;
        Vector2[] srcUVs = source.uv;
        int[] srcTris = source.triangles;
        int triCount = srcTris.Length / 3;

        if (srcVerts.Length == 0 || srcTris.Length == 0) return source;

        // Edge → midpoint index cache (for vertex sharing across adjacent faces)
        // Key: packed edge (min*vertCount + max), Value: new vertex index
        var edgeMidpointCache = new System.Collections.Generic.Dictionary<long, int>();
        var newVerts = new System.Collections.Generic.List<Vector3>(srcVerts);
        var newUVs = new System.Collections.Generic.List<Vector2>(srcUVs.Length > 0 ? srcUVs : new Vector2[srcVerts.Length]);
        var newTris = new System.Collections.Generic.List<int>(srcTris.Length * 4);

        // Propagate vertex mapping: start with existing, expand for midpoints
        var newMapping = new System.Collections.Generic.List<int>();
        var newMapping2 = new System.Collections.Generic.List<int>();
        if (lastVertexMapping != null && lastVertexMapping.Length == srcVerts.Length)
        {
            newMapping.AddRange(lastVertexMapping);
            if (lastVertexMapping2 != null && lastVertexMapping2.Length == srcVerts.Length)
                newMapping2.AddRange(lastVertexMapping2);
            else
            {
                for (int i = 0; i < srcVerts.Length; i++) newMapping2.Add(-1);
            }
        }
        else
        {
            // Fallback: identity mapping (vertex i → FLAME i)
            for (int i = 0; i < srcVerts.Length; i++)
            {
                newMapping.Add(i < 5023 ? i : -1);
                newMapping2.Add(-1);
            }
        }

        // Ensure UV array matches vertex array
        while (newUVs.Count < newVerts.Count)
            newUVs.Add(Vector2.zero);

        for (int t = 0; t < triCount; t++)
        {
            int i0 = srcTris[t * 3];
            int i1 = srcTris[t * 3 + 1];
            int i2 = srcTris[t * 3 + 2];

            // Get or create midpoint for each edge
            int m01 = GetOrCreateMidpoint(i0, i1, newVerts, newUVs, newMapping, newMapping2, edgeMidpointCache);
            int m12 = GetOrCreateMidpoint(i1, i2, newVerts, newUVs, newMapping, newMapping2, edgeMidpointCache);
            int m20 = GetOrCreateMidpoint(i2, i0, newVerts, newUVs, newMapping, newMapping2, edgeMidpointCache);

            // Original triangle → 4 sub-triangles
            //       i0
            //      / \
            //    m01--m20
            //    / \ / \
            //  i1--m12--i2

            newTris.Add(i0);  newTris.Add(m01); newTris.Add(m20);
            newTris.Add(m01); newTris.Add(i1);  newTris.Add(m12);
            newTris.Add(m20); newTris.Add(m12); newTris.Add(i2);
            newTris.Add(m01); newTris.Add(m12); newTris.Add(m20);
        }

        // Update vertex mapping after subdivision
        lastVertexMapping = newMapping.ToArray();
        lastVertexMapping2 = newMapping2.ToArray();

        Mesh result = new Mesh();
        if (newVerts.Count > 65535)
            result.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;

        result.SetVertices(newVerts);
        result.SetUVs(0, newUVs);
        result.SetTriangles(newTris, 0);
        result.RecalculateNormals();
        result.RecalculateBounds();

        // Smooth normals: per-face vertices have flat normals after RecalculateNormals.
        // We need to average normals across vertices at the same geometric position.
        SmoothNormals(result);

        return result;
    }

    /// <summary>
    /// Get or create a midpoint vertex for an edge.
    /// Also propagates FLAME vertex mapping for the new midpoint.
    /// Stores BOTH parent FLAME indices so deformation can average them.
    /// </summary>
    private int GetOrCreateMidpoint(
        int a, int b,
        System.Collections.Generic.List<Vector3> verts,
        System.Collections.Generic.List<Vector2> uvs,
        System.Collections.Generic.List<int> mapping,
        System.Collections.Generic.List<int> mapping2,
        System.Collections.Generic.Dictionary<long, int> cache)
    {
        // Canonical edge key (order-independent)
        if (a > b) { int tmp = a; a = b; b = tmp; }
        long key = (long)a * 1000000L + b;

        if (cache.TryGetValue(key, out int existing))
            return existing;

        // Create midpoint
        int idx = verts.Count;
        verts.Add((verts[a] + verts[b]) * 0.5f);
        uvs.Add((uvs[a] + uvs[b]) * 0.5f);

        // Store BOTH parent FLAME indices for this midpoint
        // Primary: FLAME index of parent a
        // Secondary: FLAME index of parent b
        // LocalDeformer will average delta from both parents
        int flameA = (a < mapping.Count) ? mapping[a] : -1;
        int flameB = (b < mapping.Count) ? mapping[b] : -1;
        mapping.Add(flameA);
        mapping2.Add(flameB);

        cache[key] = idx;
        return idx;
    }

    /// <summary>
    /// Laplacian smoothing: iteratively move each vertex toward
    /// the average of its connected neighbors.
    /// Preserves UVs (only smooths positions).
    /// </summary>
    private System.Collections.Generic.List<Vector3> LaplacianSmooth(
        System.Collections.Generic.List<Vector3> verts,
        System.Collections.Generic.List<int> tris,
        int iterations, float weight)
    {
        int vertCount = verts.Count;
        var result = new Vector3[vertCount];
        verts.CopyTo(result);

        // Build adjacency: for each vertex, collect connected neighbor indices
        var neighbors = new System.Collections.Generic.HashSet<int>[vertCount];
        for (int i = 0; i < vertCount; i++)
            neighbors[i] = new System.Collections.Generic.HashSet<int>();

        for (int t = 0; t < tris.Count; t += 3)
        {
            int a = tris[t], b = tris[t + 1], c = tris[t + 2];
            neighbors[a].Add(b); neighbors[a].Add(c);
            neighbors[b].Add(a); neighbors[b].Add(c);
            neighbors[c].Add(a); neighbors[c].Add(b);
        }

        // Iterative smoothing
        for (int iter = 0; iter < iterations; iter++)
        {
            var smoothed = new Vector3[vertCount];
            for (int i = 0; i < vertCount; i++)
            {
                if (neighbors[i].Count == 0)
                {
                    smoothed[i] = result[i];
                    continue;
                }

                // Average of neighbor positions
                Vector3 avg = Vector3.zero;
                foreach (int n in neighbors[i])
                    avg += result[n];
                avg /= neighbors[i].Count;

                // Blend: original position ↔ neighbor average
                smoothed[i] = Vector3.Lerp(result[i], avg, weight);
            }
            result = smoothed;
        }

        var list = new System.Collections.Generic.List<Vector3>(result);
        return list;
    }

    /// <summary>
    /// Smooth normals for a flat (non-shared vertex) mesh.
    /// Groups vertices by spatial position, averages their normals,
    /// and assigns the smooth normal back to all coincident vertices.
    /// This gives Gouraud/Phong smooth shading on per-face-vertex meshes.
    /// </summary>
    private void SmoothNormals(Mesh mesh)
    {
        Vector3[] verts = mesh.vertices;
        Vector3[] normals = mesh.normals;
        int count = verts.Length;

        if (normals.Length != count) return;

        // Spatial hash: quantize position → list of vertex indices at that position
        // Using 0.0001 epsilon for floating point matching
        var positionGroups = new System.Collections.Generic.Dictionary<long, System.Collections.Generic.List<int>>();

        for (int i = 0; i < count; i++)
        {
            // Quantize to 0.0001 precision
            long qx = (long)(verts[i].x * 10000f);
            long qy = (long)(verts[i].y * 10000f);
            long qz = (long)(verts[i].z * 10000f);
            // Pack into single hash
            long key = qx * 73856093L ^ qy * 19349663L ^ qz * 83492791L;

            if (!positionGroups.ContainsKey(key))
                positionGroups[key] = new System.Collections.Generic.List<int>();
            positionGroups[key].Add(i);
        }

        // Average normals within each group
        foreach (var group in positionGroups.Values)
        {
            if (group.Count <= 1) continue;

            // Sum all normals in this spatial group
            Vector3 avgNormal = Vector3.zero;
            for (int i = 0; i < group.Count; i++)
                avgNormal += normals[group[i]];
            avgNormal.Normalize();

            // Assign averaged normal back
            for (int i = 0; i < group.Count; i++)
                normals[group[i]] = avgNormal;
        }

        mesh.normals = normals;
        Debug.Log($"[UVTextureLoader] SmoothNormals: {count} verts, {positionGroups.Count} unique positions");
    }
}
