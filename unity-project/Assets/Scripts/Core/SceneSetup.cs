using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// Scene bootstrapper — creates all required components for FreeUV pipeline
/// Sets up camera, lighting, and UV-textured face mesh
/// </summary>
public class SceneSetup : MonoBehaviour
{
    [Header("Auto-Create")]
    public bool autoInit = true;

    [Header("Server")]
    public string serverUrl = "http://localhost:3001";

    private UVTextureLoader uvLoader;
    private HairGenerator hairGenerator;
    private LocalDeformer localDeformer;

    void Start()
    {
        if (autoInit) SetupScene();
    }

    void SetupScene()
    {
        // Main Camera
        Camera cam = Camera.main;
        if (cam == null)
        {
            var camGO = new GameObject("Main Camera");
            cam = camGO.AddComponent<Camera>();
            cam.tag = "MainCamera";
            cam.backgroundColor = new Color(0.102f, 0.102f, 0.180f, 1f); // 0x1a1a2e
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.nearClipPlane = 0.01f;
            cam.farClipPlane = 100f;
        }

        // Orbit Camera
        var orbit = cam.gameObject.GetComponent<OrbitCamera>();
        if (orbit == null)
        {
            orbit = cam.gameObject.AddComponent<OrbitCamera>();
            orbit.distance = 0.5f;
            orbit.target = new Vector3(0, 0, 0);
            orbit.rotateSpeed = 3f;
            orbit.minDistance = 0.1f;
            orbit.maxDistance = 5f;
        }

        // Face Mesh Object
        var faceMeshGO = new GameObject("FaceMesh");
        var meshFilter = faceMeshGO.AddComponent<MeshFilter>();
        var meshRenderer = faceMeshGO.AddComponent<MeshRenderer>();

        // UV Texture Loader
        uvLoader = faceMeshGO.AddComponent<UVTextureLoader>();
        uvLoader.serverUrl = serverUrl;
        uvLoader.targetRenderer = meshRenderer;
        uvLoader.targetMeshFilter = meshFilter;

        // MeshCollider — required for GestureSculptor raycast
        faceMeshGO.AddComponent<MeshCollider>();

        // Surgery Controller
        var surgeryCtrl = faceMeshGO.AddComponent<SurgeryController>();
        surgeryCtrl.serverUrl = serverUrl;
        surgeryCtrl.targetMeshFilter = meshFilter;

        // Gesture Sculptor — drag on face mesh → FLAME param changes
        var sculptor = faceMeshGO.AddComponent<GestureSculptor>();
        sculptor.mainCamera = cam;
        sculptor.surgeryController = surgeryCtrl;
        sculptor.targetMeshFilter = meshFilter;

        // Hair Generator — DISABLED (procedural hair not yet production-ready)
        // hairGenerator = faceMeshGO.AddComponent<HairGenerator>();
        // hairGenerator.faceMeshFilter = meshFilter;

        // Local Deformer — shapedirs-based vertex deformation (no GPU server needed)
        localDeformer = faceMeshGO.AddComponent<LocalDeformer>();
        localDeformer.targetMeshFilter = meshFilter;

        // Lighting — matches face_viewer.html for consistent skin rendering
        // Ambient (warm, soft fill everywhere)
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(1f, 0.97f, 0.92f) * 0.12f;

        // Key light (front-above, warm white, strongest)
        var keyLightGO = new GameObject("Key Light");
        var keyLight = keyLightGO.AddComponent<Light>();
        keyLight.type = LightType.Directional;
        keyLight.intensity = 0.7f;
        keyLight.color = new Color(1f, 0.97f, 0.94f); // warm white
        keyLightGO.transform.rotation = Quaternion.Euler(27, 17, 0); // position (0.3, 0.5, 1)

        // Fill light (left side, cool blue-white)
        var fillLightGO = new GameObject("Fill Light");
        var fillLight = fillLightGO.AddComponent<Light>();
        fillLight.type = LightType.Directional;
        fillLight.intensity = 0.22f;
        fillLight.color = new Color(1f, 0.98f, 0.95f); // warm neutral (NOT cool blue)
        fillLightGO.transform.rotation = Quaternion.Euler(12, -45, 0); // position (-0.5, 0.2, 0.5)

        // Rim light (backlight for edge definition)
        var rimLightGO = new GameObject("Rim Light");
        var rimLight = rimLightGO.AddComponent<Light>();
        rimLight.type = LightType.Directional;
        rimLight.intensity = 0.12f;
        rimLight.color = new Color(1f, 0.97f, 0.93f); // warm neutral (NOT cool blue)
        rimLightGO.transform.rotation = Quaternion.Euler(17, 180, 0); // behind

        // Bottom fill (subtle, reduces harsh shadows under chin/nose)
        var bottomLightGO = new GameObject("Bottom Fill");
        var bottomLight = bottomLightGO.AddComponent<Light>();
        bottomLight.type = LightType.Directional;
        bottomLight.intensity = 0.10f;
        bottomLight.color = new Color(1f, 0.93f, 0.87f); // warm 0xffeedd
        bottomLightGO.transform.rotation = Quaternion.Euler(-30, 0, 0); // from below



        // JSBridge — required for JS ↔ Unity communication via SendMessage
        // The GameObject MUST be named "JSBridge" to match SendMessage calls
        var bridgeGO = new GameObject("JSBridge");
        var bridge = bridgeGO.AddComponent<JSBridge>();
        bridge.sceneSetup = this;
        bridge.surgeryController = surgeryCtrl;
        // comparisonView left null until instantiated

        Debug.Log("[SceneSetup] FreeUV scene initialized — JSBridge ready, placeholder visible, waiting for model");
    }

    /// <summary>
    /// Called from JS bridge to load a face model
    /// </summary>
    public void LoadFaceModel(string uvUrl, string meshUrl)
    {
        LoadFaceModel(uvUrl, meshUrl, null);
    }

    /// <summary>
    /// Called from JS bridge to load a face model with optional shapedirs.
    /// </summary>
    public void LoadFaceModel(string uvUrl, string meshUrl, string shapedirsUrl)
    {
        // Remove placeholder
        var placeholder = GameObject.Find("PlaceholderSphere");
        if (placeholder != null) Destroy(placeholder);

        if (uvLoader != null)
        {
            uvLoader.LoadMesh(meshUrl);
            uvLoader.LoadUVTexture(uvUrl);

            // Start shapedirs download if URL provided
            if (!string.IsNullOrEmpty(shapedirsUrl) && localDeformer != null)
            {
                localDeformer.LoadShapedirs(shapedirsUrl);
                // Set up LocalDeformer after mesh loads
                StartCoroutine(InitLocalDeformerAfterMesh());
            }
        }
    }

    private System.Collections.IEnumerator InitLocalDeformerAfterMesh()
    {
        // Wait for mesh to load
        float waited = 0f;
        while (waited < 15f)
        {
            yield return new WaitForSeconds(0.3f);
            waited += 0.3f;
            if (uvLoader.targetMeshFilter != null &&
                uvLoader.targetMeshFilter.mesh != null &&
                uvLoader.targetMeshFilter.mesh.vertexCount > 0)
            {
                break;
            }
        }

        // Feed vertex mapping and scale to LocalDeformer
        if (localDeformer != null && uvLoader != null)
        {
            if (uvLoader.lastVertexMapping != null)
            {
                localDeformer.SetVertexMapping(uvLoader.lastVertexMapping, uvLoader.lastVertexMapping2);
            }
            localDeformer.SaveBaseVertices();
            localDeformer.SetMeshScale(uvLoader.lastMeshScale);
            Debug.Log("[SceneSetup] LocalDeformer initialized with mesh data");
        }

        // Paint iris/pupil onto dark eye regions in UV texture (auto-detect)
        if (uvLoader != null && uvLoader.targetMeshFilter != null)
        {
            PaintEyeTextures(uvLoader.targetMeshFilter);
        }
    }

    /// <summary>
    /// Set the skin color tint on the face material.
    /// Multiplied with the UV texture — use near-white for lighter, warmer tones.
    /// </summary>
    public void SetSkinColor(float r, float g, float b)
    {
        if (uvLoader != null && uvLoader.targetMeshFilter != null)
        {
            var renderer = uvLoader.targetMeshFilter.GetComponent<Renderer>();
            if (renderer != null && renderer.material != null)
            {
                renderer.material.SetColor("_Color", new Color(r, g, b, 1f));
                // URP uses _BaseColor
                renderer.material.SetColor("_BaseColor", new Color(r, g, b, 1f));
                Debug.Log($"[SceneSetup] Skin color set: ({r:F2}, {g:F2}, {b:F2})");
            }
        }
    }

    /// <summary>
    /// Paint iris/pupil onto eyeball vertices in the UV texture.
    /// FLAME eyeball vertices: 3931-5022 (face is 0-3930).
    /// Groups into left/right by UV clustering, paints at each center.
    /// </summary>
    private void PaintEyeTextures(MeshFilter faceMesh)
    {
        var renderer = faceMesh.GetComponent<Renderer>();
        if (renderer == null || renderer.material == null) return;

        int[] mapping = uvLoader.lastVertexMapping;
        if (mapping == null) return;

        Vector2[] uvs = faceMesh.mesh.uv;
        if (uvs == null || uvs.Length == 0) return;

        // Diagnostic: check what FLAME indices exist in the mapping
        int maxIdx = 0;
        for (int i = 0; i < mapping.Length; i++)
            if (mapping[i] > maxIdx) maxIdx = mapping[i];
        Debug.Log($"[SceneSetup] PaintEyeTextures: mapping.Length={mapping.Length}, maxFlameIdx={maxIdx}, uvs.Length={uvs.Length}");
#if UNITY_WEBGL && !UNITY_EDITOR
        Application.ExternalEval($"console.log('[Unity] EyeDiag: mappingLen={mapping.Length}, maxFlameIdx={maxIdx}, uvsLen={uvs.Length}')");
#endif

        // Collect UV coordinates of all eyeball vertices (FLAME 3931-5022)
        var eyeUVs = new System.Collections.Generic.List<Vector2>();
        for (int i = 0; i < mapping.Length && i < uvs.Length; i++)
        {
            if (mapping[i] >= 3931 && mapping[i] <= 5022)
            {
                eyeUVs.Add(uvs[i]);
            }
        }

        if (eyeUVs.Count < 10)
        {
            Debug.LogWarning($"[SceneSetup] PaintEyeTextures: only {eyeUVs.Count} eyeball vertices found (need >=10). maxFlameIdx={maxIdx}. Skipping.");
#if UNITY_WEBGL && !UNITY_EDITOR
            Application.ExternalEval($"console.warn('[Unity] EyeDiag: only {eyeUVs.Count} eyeball verts found, maxFlameIdx={maxIdx}, SKIPPING')");
#endif
            return;
        }

        // Split into left/right eyes by UV X coordinate (simple K-means with k=2)
        var leftUVs = new System.Collections.Generic.List<Vector2>();
        var rightUVs = new System.Collections.Generic.List<Vector2>();
        
        // Find min/max X to split
        float midX = 0;
        for (int i = 0; i < eyeUVs.Count; i++) midX += eyeUVs[i].x;
        midX /= eyeUVs.Count;

        for (int i = 0; i < eyeUVs.Count; i++)
        {
            if (eyeUVs[i].x < midX)
                leftUVs.Add(eyeUVs[i]);
            else
                rightUVs.Add(eyeUVs[i]);
        }

        if (leftUVs.Count < 5 || rightUVs.Count < 5)
        {
            Debug.LogWarning("[SceneSetup] PaintEyeTextures: could not split eyeball UVs into L/R.");
            return;
        }

        // Compute centers and radii
        Vector2 leftCenter = AverageUV(leftUVs);
        Vector2 rightCenter = AverageUV(rightUVs);
        float leftRadius = MaxUVDistance(leftUVs, leftCenter);
        float rightRadius = MaxUVDistance(rightUVs, rightCenter);

        Debug.Log($"[SceneSetup] Eye UVs: L=({leftCenter.x:F3},{leftCenter.y:F3}) r={leftRadius:F3} n={leftUVs.Count}, R=({rightCenter.x:F3},{rightCenter.y:F3}) r={rightRadius:F3} n={rightUVs.Count}");

        // Get writable texture
        Texture2D srcTex = renderer.material.mainTexture as Texture2D;
        if (srcTex == null) return;

        Texture2D tex;
        try { srcTex.GetPixel(0, 0); tex = srcTex; }
        catch
        {
            RenderTexture rt = RenderTexture.GetTemporary(srcTex.width, srcTex.height);
            Graphics.Blit(srcTex, rt);
            RenderTexture prev = RenderTexture.active;
            RenderTexture.active = rt;
            tex = new Texture2D(srcTex.width, srcTex.height, TextureFormat.RGBA32, false);
            tex.ReadPixels(new Rect(0, 0, srcTex.width, srcTex.height), 0, 0);
            tex.Apply();
            RenderTexture.active = prev;
            RenderTexture.ReleaseTemporary(rt);
        }

        int w = tex.width, h = tex.height;

        // Paint both eyes at UV coordinates
        PaintEyeAtUV(tex, leftCenter, leftRadius, w, h);
        PaintEyeAtUV(tex, rightCenter, rightRadius, w, h);

        tex.Apply();
        tex.filterMode = FilterMode.Bilinear;
        renderer.material.mainTexture = tex;
    }

    private Vector2 AverageUV(System.Collections.Generic.List<Vector2> uvs)
    {
        Vector2 sum = Vector2.zero;
        for (int i = 0; i < uvs.Count; i++) sum += uvs[i];
        return sum / uvs.Count;
    }

    private float MaxUVDistance(System.Collections.Generic.List<Vector2> uvs, Vector2 center)
    {
        float max = 0;
        for (int i = 0; i < uvs.Count; i++)
        {
            float d = Vector2.Distance(uvs[i], center);
            if (d > max) max = d;
        }
        return max;
    }

    /// <summary>
    /// Paint iris + pupil + sclera at UV coordinates on the texture
    /// </summary>
    private void PaintEyeAtUV(Texture2D tex, Vector2 centerUV, float radiusUV, int texW, int texH)
    {
        float cx = centerUV.x * texW;
        float cy = centerUV.y * texH;
        float radius = radiusUV * Mathf.Max(texW, texH) * 0.6f; // Scale down to iris size
        float irisR = radius * 0.75f;
        float pupilR = radius * 0.3f;

        int minX = Mathf.Max(0, (int)(cx - radius - 2));
        int maxX = Mathf.Min(texW - 1, (int)(cx + radius + 2));
        int minY = Mathf.Max(0, (int)(cy - radius - 2));
        int maxY = Mathf.Min(texH - 1, (int)(cy + radius + 2));

        for (int y = minY; y <= maxY; y++)
        {
            for (int x = minX; x <= maxX; x++)
            {
                float dx = x - cx;
                float dy = y - cy;
                float dist = Mathf.Sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;

                Color c;
                if (dist < pupilR)
                {
                    c = Color.black;
                }
                else if (dist < irisR)
                {
                    float t = (dist - pupilR) / (irisR - pupilR);
                    c = Color.Lerp(
                        new Color(0.20f, 0.12f, 0.06f),
                        new Color(0.35f, 0.22f, 0.10f), t);
                }
                else
                {
                    // Sclera with edge blend
                    float edge = (dist - irisR) / (radius - irisR);
                    Color sclera = new Color(0.95f, 0.93f, 0.92f);
                    Color existing = tex.GetPixel(x, y);
                    c = Color.Lerp(sclera, existing, edge * edge);
                }

                tex.SetPixel(x, y, c);
            }
        }
    }

    private System.Collections.IEnumerator GenerateHairDelayed()
    {
        // Wait until mesh is actually loaded (poll every 0.5s, timeout 10s)
        float waited = 0f;
        while (waited < 10f)
        {
            yield return new WaitForSeconds(0.5f);
            waited += 0.5f;
            if (uvLoader != null && uvLoader.targetMeshFilter != null &&
                uvLoader.targetMeshFilter.mesh != null &&
                uvLoader.targetMeshFilter.mesh.vertexCount > 0)
            {
                break;
            }
        }
        if (hairGenerator != null)
        {
            hairGenerator.SetHairStyle(HairGenerator.HairStyle.Medium);
        }
    }

    /// <summary>
    /// [DEPRECATED] Update mesh from raw OBJ text (from /api/deform).
    /// Kept for backward compatibility. Prefer ApplyLocalDeformation.
    /// </summary>
    public void UpdateMeshFromOBJ(string objText)
    {
        if (uvLoader != null)
        {
            uvLoader.LoadMeshFromText(objText);
        }
    }

    /// <summary>
    /// Apply local deformation from slider values (no server needed).
    /// Called from JSBridge with FLAME shape params.
    /// </summary>
    public void ApplyLocalDeformation(string json)
    {
        if (localDeformer != null)
        {
            localDeformer.ApplyDeformation(json);
        }
    }

    /// <summary>
    /// Apply region-isolated deformation (per-region shape arrays).
    /// </summary>
    public void ApplyRegionDeformation(string json)
    {
        if (localDeformer != null)
        {
            localDeformer.ApplyRegionDeformation(json);
        }
    }

    /// <summary>
    /// Apply direct vertex displacement (no PCA, region-isolated surgery params).
    /// </summary>
    public void ApplyDirectDeformation(string json)
    {
        if (localDeformer != null)
        {
            localDeformer.ApplyDirectDeformation(json);
        }
    }

    /// <summary>
    /// Enable/disable face-only masking mode.
    /// </summary>
    public void SetFaceOnlyMode(string json)
    {
        if (localDeformer != null)
        {
            localDeformer.SetFaceOnlyMode(json);
        }
    }

    /// <summary>
    /// Set MediaPipe face landmarks for adaptive deformation targeting.
    /// </summary>
    public void SetFaceLandmarks(string json)
    {
        if (localDeformer != null)
        {
            localDeformer.SetMediaPipeLandmarks(json);
        }
    }

    public LocalDeformer GetLocalDeformer()
    {
        return localDeformer;
    }

    /// <summary>
    /// Set hair style from JS bridge.
    /// </summary>
    public void SetHairStyle(string styleName)
    {
        if (hairGenerator != null) hairGenerator.SetHairStyleByName(styleName);
    }

    /// <summary>
    /// Called from JS bridge to update mesh vertices after FLAME deform
    /// </summary>
    public void UpdateMeshVertices(string verticesJson)
    {
        // Parse flat vertex array [x,y,z, x,y,z, ...]
        // and update mesh in real-time for slider preview
        if (uvLoader != null && uvLoader.targetMeshFilter != null)
        {
            var mesh = uvLoader.targetMeshFilter.mesh;
            if (mesh == null) return;

            float[] verts = JsonUtility.FromJson<FloatArray>(verticesJson).data;
            var vertices = new Vector3[verts.Length / 3];
            for (int i = 0; i < vertices.Length; i++)
            {
                vertices[i] = new Vector3(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
            }

            mesh.vertices = vertices;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
        }
    }

    [System.Serializable]
    private class FloatArray { public float[] data; }
}
