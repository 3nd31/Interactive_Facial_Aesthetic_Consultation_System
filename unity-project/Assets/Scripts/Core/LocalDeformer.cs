using UnityEngine;
using UnityEngine.Networking;
using System.Collections;

/// <summary>
/// LocalDeformer — Loads FLAME shapedirs.bin and deforms mesh locally.
/// No GPU server needed for deformation — pure CPU matrix multiply.
///
/// shapedirs.bin format: float32[5023 × 3 × 200]
///   - 5023 vertices
///   - 3 axes (x, y, z)
///   - 200 PCA shape dimensions
///
/// Memory layout: [v0_x_p0, v0_x_p1, ..., v0_x_p199, v0_y_p0, ..., v0_z_p199, v1_x_p0, ...]
/// </summary>
public class LocalDeformer : MonoBehaviour
{
    private const int N_VERTS = 5023;

    [Header("References")]
    public MeshFilter targetMeshFilter;

    private float[] shapedirs;       // float[5023 * 3 * nParams]
    private int nParams = 0;         // Auto-detected from file size (200 or 400)
    private Vector3[] baseVertices;   // Original mesh vertices (post-centering/scaling)
    private Vector3[] baseNormals;    // Original mesh normals (for surface-normal displacement)
    private bool shapedirsLoaded = false;
    private bool baseVerticesSaved = false;
    private bool debugLogged = false;

    // Normalization scale (applied by ParseOBJ) — shapedirs deltas need same scale
    private float meshScale = 1f;

    // Amplification for un-normalized PCA shapedirs (raw basis vectors are very small)
    // Typical shapedir max ~0.006, mean ~0.00006 — need ~300x to produce visible deformation
    private float deformAmplification = 300f;

    // Region isolation — per-vertex soft weights for each facial region
    private static readonly string[] REGION_NAMES = { "nose", "jaw", "chin", "eye", "lip", "forehead", "cheek" };
    private float[][] regionWeights; // regionWeights[regionIdx][flameVertIdx] = 0..1
    private bool regionWeightsComputed = false;

    // Face-only masking: prevents skull/neck from moving when adjusting face features
    private bool faceOnlyMode = false;
    private float[] maxFaceWeight; // maxFaceWeight[flameVertIdx] = max over all regions

    // === MediaPipe-based facial landmarks (from 478 face mesh points) ===
    private bool mpLandmarksReady = false;
    // Mapped to mesh coordinates (filled by SetMediaPipeLandmarks)
    private float mpNoseTipY, mpNoseTipZ;
    private float mpNoseBridgeY;
    private float mpEyeUpperY;     // average of left/right upper eyelid Y
    private float mpEyeInnerX;     // average |X| of inner eye corners from center
    private float mpEyeInnerY;     // average Y of inner eye corners (from MediaPipe via 4-anchor)
    private float mpEyeZ;          // average Z of eye area
    private float mpUpperLipY;
    private float mpLowerLipY;
    private float mpChinY, mpChinZ;
    private float mpJawY;          // average Y of jaw angles
    private float mpJawX;          // average |X| of jaw angles (half-width)

    /// <summary>
    /// Download and parse shapedirs.bin from the given URL.
    /// </summary>
    public void LoadShapedirs(string url)
    {
        StartCoroutine(DownloadShapedirs(url));
    }

    private IEnumerator DownloadShapedirs(string url)
    {
        Debug.Log($"[LocalDeformer] Downloading shapedirs: {url}");

        using (var request = UnityWebRequest.Get(url))
        {
            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                byte[] rawBytes = request.downloadHandler.data;

                // Auto-detect N_PARAMS from file size: size = N_VERTS * 3 * N_PARAMS * 4
                int totalFloats = rawBytes.Length / sizeof(float);
                int detectedParams = totalFloats / (N_VERTS * 3);

                if (totalFloats % (N_VERTS * 3) == 0 && detectedParams > 0)
                {
                    nParams = detectedParams;
                    shapedirs = new float[totalFloats];
                    System.Buffer.BlockCopy(rawBytes, 0, shapedirs, 0, rawBytes.Length);
                    shapedirsLoaded = true;
                    Debug.Log($"[LocalDeformer] Shapedirs loaded: {rawBytes.Length} bytes ({N_VERTS}×3×{nParams})");

                    // Try to save base vertices if mesh is already loaded
                    TrySaveBaseVertices();
                }
                else
                {
                    Debug.LogError($"[LocalDeformer] Invalid shapedirs size: {rawBytes.Length} bytes (not divisible by {N_VERTS * 3 * 4})");
                }
            }
            else
            {
                Debug.LogError($"[LocalDeformer] Shapedirs download failed: {request.error}");
            }
        }
    }

    /// <summary>
    /// Save base vertices from the current mesh as the deformation baseline.
    /// Must be called after mesh is loaded (ParseOBJ + subdivision).
    /// </summary>
    public void SaveBaseVertices()
    {
        TrySaveBaseVertices();
    }

    private void TrySaveBaseVertices()
    {
        if (targetMeshFilter == null || targetMeshFilter.mesh == null) return;

        var mesh = targetMeshFilter.mesh;
        if (mesh.vertexCount == 0) return;

        baseVertices = mesh.vertices;
        baseNormals = mesh.normals;   // Cache surface normals for normal-displacement
        baseVerticesSaved = true;

        // Pre-allocate reusable arrays for deformation (avoid GC every frame)
        cachedVerts = new Vector3[baseVertices.Length];
        cachedFlameDeltas = new Vector3[N_VERTS];

        // Pre-compute normal smoothing groups from base vertex positions
        // Topology never changes during deformation, so groups are reusable
        PrecomputeNormalGroups(baseVertices);

        // Auto-detect facial landmarks from mesh boundary edges
        // MediaPipe landmarks are set separately via SetMediaPipeLandmarks()

        Debug.Log($"[LocalDeformer] Base vertices saved: {baseVertices.Length} verts, meshScale={meshScale:F6}, amplification={deformAmplification:F0}, normalGroups={cachedNormalGroups.Length}");
    }

    // Cached arrays to avoid per-frame allocation
    private Vector3[] cachedVerts;
    private Vector3[] cachedFlameDeltas;
    private int[][] cachedNormalGroups;

    /// <summary>
    /// Pre-compute groups of vertices that share the same spatial position.
    /// These groups are used by SmoothNormals to average normals efficiently.
    /// </summary>
    private void PrecomputeNormalGroups(Vector3[] verts)
    {
        int count = verts.Length;
        var groups = new System.Collections.Generic.Dictionary<long,
            System.Collections.Generic.List<int>>();

        for (int i = 0; i < count; i++)
        {
            long qx = (long)(verts[i].x * 10000f);
            long qy = (long)(verts[i].y * 10000f);
            long qz = (long)(verts[i].z * 10000f);
            long key = qx * 73856093L ^ qy * 19349663L ^ qz * 83492791L;

            if (!groups.ContainsKey(key))
                groups[key] = new System.Collections.Generic.List<int>();
            groups[key].Add(i);
        }

        // Convert to array-of-arrays for fast iteration (no dictionary overhead)
        var result = new System.Collections.Generic.List<int[]>();
        foreach (var group in groups.Values)
        {
            if (group.Count > 1)
                result.Add(group.ToArray());
        }
        cachedNormalGroups = result.ToArray();
    }



    /// <summary>
    /// Set the mesh scale factor (from ParseOBJ normalization).
    /// Shapedirs deltas need to be scaled by the same factor.
    /// </summary>
    public void SetMeshScale(float scale)
    {
        meshScale = scale;
        Debug.Log($"[LocalDeformer] Mesh scale set: {scale:F6}");
    }

    // === JSON data classes for MediaPipe landmarks ===
    [System.Serializable]
    private class Vec3Data { public float x; public float y; public float z; }
    [System.Serializable]
    private class MediaPipeLandmarksData
    {
        public Vec3Data forehead;
        public Vec3Data noseTip;
        public Vec3Data noseBridge;
        public Vec3Data leftEyeUpper;
        public Vec3Data rightEyeUpper;
        public Vec3Data leftInnerEye;
        public Vec3Data rightInnerEye;
        public Vec3Data upperLip;
        public Vec3Data lowerLip;
        public Vec3Data chin;
        public Vec3Data leftJaw;
        public Vec3Data rightJaw;
    }

    // Cached inner eye position from mesh topology detection
    private float meshInnerEyeX = -1f;
    private float meshInnerEyeZ = float.MinValue;  // Z depth of inner eye corner
    private bool ecDebugDone = false;  // one-shot debug flag

    /// <summary>
    /// Find inner eye corners on FLAME mesh using known proportional positions.
    /// Offline analysis of FLAME 5023-vertex mesh confirmed:
    ///   Right inner canthus: v[1894] at X/h≈+0.057, Y/h≈+0.108
    ///   Left  inner canthus: v[2972] at X/h≈-0.062, Y/h≈+0.108
    ///   Average innerX/h = 0.060
    /// Eye boundaries are CLOSED (LAM fills eye openings), so boundary
    /// edge detection cannot work. Instead, we search for the vertex
    /// closest to the known proportional position.
    /// </summary>
    private float DetectInnerEyeCorners()
    {
        if (meshInnerEyeX > 0) return meshInnerEyeX;  // cached

        if (baseVertices == null || baseVertices.Length == 0) return -1f;

        // Compute mesh bounds
        Vector3 minV = baseVertices[0], maxV = baseVertices[0];
        for (int i = 1; i < baseVertices.Length; i++)
        {
            minV = Vector3.Min(minV, baseVertices[i]);
            maxV = Vector3.Max(maxV, baseVertices[i]);
        }
        Vector3 meshCenter = (minV + maxV) * 0.5f;
        Vector3 meshSize = maxV - minV;
        float h = meshSize.y;

        // Known FLAME inner eye proportions (from offline mesh analysis)
        float targetYRatio = 0.108f;   // Y/h above center
        float targetXRatio = 0.060f;   // |X|/h from center
        float targetY = meshCenter.y + h * targetYRatio;
        float targetXOff = h * targetXRatio;

        // Search zone: narrow band around known position
        float yBand = h * 0.04f;    // ±4% Y tolerance
        float xBand = h * 0.04f;    // ±4% X tolerance
        float zFrontLimit = minV.z + meshSize.z * 0.20f;  // front 20%

        float bestRightDist = float.MaxValue;
        float bestLeftDist = float.MaxValue;
        int bestRightI = -1, bestLeftI = -1;
        float bestRightXOff = 0, bestLeftXOff = 0;

        for (int i = 0; i < baseVertices.Length; i++)
        {
            Vector3 v = baseVertices[i];

            // Must be in front face
            if (v.z > zFrontLimit) continue;

            // Must be near eye level
            float dy = Mathf.Abs(v.y - targetY);
            if (dy > yBand) continue;

            float xOff = v.x - meshCenter.x;
            float absX = Mathf.Abs(xOff);

            // Must be near the target X offset
            float dx = Mathf.Abs(absX - targetXOff);
            if (dx > xBand) continue;

            // Distance metric: combined Y and X deviation from target
            float dist = dy + dx;

            if (xOff > 0 && dist < bestRightDist)
            {
                bestRightDist = dist;
                bestRightI = i;
                bestRightXOff = absX;
            }
            else if (xOff < 0 && dist < bestLeftDist)
            {
                bestLeftDist = dist;
                bestLeftI = i;
                bestLeftXOff = absX;
            }
        }

        if (bestRightI >= 0 && bestLeftI >= 0)
        {
            meshInnerEyeX = (bestRightXOff + bestLeftXOff) * 0.5f;
            meshInnerEyeZ = (baseVertices[bestRightI].z + baseVertices[bestLeftI].z) * 0.5f;
            Debug.Log($"[LocalDeformer] Inner eye corners found via FLAME geometric search:");
            Debug.Log($"[LocalDeformer]   Right: v[{bestRightI}] pos=({baseVertices[bestRightI].x:F4},{baseVertices[bestRightI].y:F4},{baseVertices[bestRightI].z:F4}) xOff={bestRightXOff:F4}");
            Debug.Log($"[LocalDeformer]   Left:  v[{bestLeftI}] pos=({baseVertices[bestLeftI].x:F4},{baseVertices[bestLeftI].y:F4},{baseVertices[bestLeftI].z:F4}) xOff={bestLeftXOff:F4}");
            Debug.Log($"[LocalDeformer]   → innerX = {meshInnerEyeX:F4} (X/h = {meshInnerEyeX / h:F3}), Z = {meshInnerEyeZ:F4}");
        }
        else
        {
            // Fallback to known FLAME proportion
            meshInnerEyeX = h * 0.060f;
            Debug.LogWarning($"[LocalDeformer] Inner eye search failed (R={bestRightI}, L={bestLeftI}), using X/h=0.060 fallback");
        }

        return meshInnerEyeX;
    }

    /// <summary>
    /// Receive MediaPipe face landmarks (normalized 0~1) and map to mesh coordinates.
    /// Strategy: PIECEWISE 4-ANCHOR Y mapping (bridge→noseTip→upperLip→chin) +
    /// FLAME geometric vertex search for inner eye X position.
    /// </summary>
    public void SetMediaPipeLandmarks(string json)
    {
        if (baseVertices == null || baseVertices.Length == 0)
        {
            Debug.LogWarning("[LocalDeformer] Cannot set landmarks before base vertices are saved");
            return;
        }

        var data = JsonUtility.FromJson<MediaPipeLandmarksData>(json);
        if (data == null || data.noseTip == null)
        {
            Debug.LogWarning("[LocalDeformer] Invalid MediaPipe landmarks JSON");
            return;
        }

        // Compute mesh bounds
        Vector3 minV = baseVertices[0], maxV = baseVertices[0];
        for (int i = 1; i < baseVertices.Length; i++)
        {
            minV = Vector3.Min(minV, baseVertices[i]);
            maxV = Vector3.Max(maxV, baseVertices[i]);
        }
        Vector3 meshCenter = (minV + maxV) * 0.5f;
        Vector3 meshSize = maxV - minV;
        float h = meshSize.y;

        // ================================================================
        // PIECEWISE 4-ANCHOR MAPPING
        // Four calibration anchors for accurate face-proportion mapping:
        //   noseBridge → Y/h = +0.110  (above center)
        //   noseTip    → Y/h = +0.067  (upper mid)
        //   upperLip   → Y/h = -0.042  (lower mid)  ← NEW 4th anchor
        //   chin       → Y/h = -0.100  (bottom)
        // MediaPipe and FLAME have different proportions in each zone.
        // Adding upperLip as anchor fixes the +0.050h lip bias that
        // existed in the 3-anchor version (nose-to-lip proportion
        // differs: 43% in MP vs 65% in FLAME).
        // ================================================================
        float mpBridge = data.noseBridge.y;  // MP Y of nose bridge
        float mpNose   = data.noseTip.y;     // MP Y of nose tip
        float mpLip    = data.upperLip.y;    // MP Y of upper lip ← 4th anchor
        float mpChin   = data.chin.y;        // MP Y of chin

        float rBridge = 0.110f;   // mesh Y/h for nose bridge
        float rNose   = 0.067f;   // mesh Y/h for nose tip
        float rLip    = -0.042f;  // mesh Y/h for upper lip
        float rChin   = -0.100f;  // mesh Y/h for chin

        // Three segments in MP space
        float mpSpan1 = mpNose - mpBridge;   // bridge→noseTip
        float mpSpan2 = mpLip  - mpNose;     // noseTip→upperLip
        float mpSpan3 = mpChin - mpLip;      // upperLip→chin
        if (Mathf.Abs(mpSpan1) < 0.001f) mpSpan1 = 0.05f;
        if (Mathf.Abs(mpSpan2) < 0.001f) mpSpan2 = 0.05f;
        if (Mathf.Abs(mpSpan3) < 0.001f) mpSpan3 = 0.05f;

        // Piecewise linear map: MP Y → mesh Y
        float ToMeshY(float mpy)
        {
            float ratio;
            if (mpy <= mpNose)
            {
                // Segment 1: bridge → noseTip (eyes, brows)
                float t = (mpy - mpBridge) / mpSpan1;
                ratio = rBridge + t * (rNose - rBridge);
            }
            else if (mpy <= mpLip)
            {
                // Segment 2: noseTip → upperLip (philtrum)
                float t = (mpy - mpNose) / mpSpan2;
                ratio = rNose + t * (rLip - rNose);
            }
            else
            {
                // Segment 3: upperLip → chin (lower face)
                float t = (mpy - mpLip) / mpSpan3;
                ratio = rLip + t * (rChin - rLip);
            }
            return meshCenter.y + h * ratio;
        }

        // For X: use face width from forehead→chin landmarks as reference
        // The jaw half-width should be ~0.50 * meshSize.x
        float mpFaceCenterX = (data.leftJaw.x + data.rightJaw.x) * 0.5f;
        float mpFaceW = Mathf.Abs(data.rightJaw.x - data.leftJaw.x);
        if (mpFaceW < 0.01f) mpFaceW = 0.3f;
        float ToMeshXOffset(float mpx) => ((mpx - mpFaceCenterX) / mpFaceW) * meshSize.x;

        // ================================================================
        // Map each landmark
        // ================================================================
        mpNoseTipY    = ToMeshY(data.noseTip.y);
        mpNoseTipZ    = minV.z;
        mpNoseBridgeY = ToMeshY(data.noseBridge.y);  // should be meshCenter.y + 0.110*h

        float leftEyeY  = ToMeshY(data.leftEyeUpper.y);
        float rightEyeY = ToMeshY(data.rightEyeUpper.y);
        mpEyeUpperY = (leftEyeY + rightEyeY) * 0.5f;

        // Inner eye X: detect from FLAME mesh geometry
        float detectedInnerX = DetectInnerEyeCorners();
        if (detectedInnerX > 0)
            mpEyeInnerX = detectedInnerX;
        else
            mpEyeInnerX = h * 0.06f;  // fallback: FLAME-verified ratio

        // Inner eye Y: from MediaPipe via 4-anchor mapping
        float leftInnerEyeY  = ToMeshY(data.leftInnerEye.y);
        float rightInnerEyeY = ToMeshY(data.rightInnerEye.y);
        mpEyeInnerY = (leftInnerEyeY + rightInnerEyeY) * 0.5f;

        mpEyeZ = minV.z + meshSize.z * 0.10f;

        mpUpperLipY = ToMeshY(data.upperLip.y);
        mpLowerLipY = ToMeshY(data.lowerLip.y);

        mpChinY = ToMeshY(data.chin.y);  // should be meshCenter.y - 0.100*h
        mpChinZ = minV.z + meshSize.z * 0.10f;

        float leftJawY  = ToMeshY(data.leftJaw.y);
        float rightJawY = ToMeshY(data.rightJaw.y);
        mpJawY = (leftJawY + rightJawY) * 0.5f;

        float leftJawXOff  = Mathf.Abs(ToMeshXOffset(data.leftJaw.x));
        float rightJawXOff = Mathf.Abs(ToMeshXOffset(data.rightJaw.x));
        mpJawX = (leftJawXOff + rightJawXOff) * 0.5f;

        mpLandmarksReady = true;

        // Log for calibration
        Debug.Log($"[LocalDeformer] === MEDIAPIPE LANDMARKS MAPPED (4-anchor) ===");
        Debug.Log($"[LocalDeformer] Anchors: bridge={mpBridge:F3}→+0.110, nose={mpNose:F3}→+0.067, lip={mpLip:F3}→-0.042, chin={mpChin:F3}→-0.100");
        Debug.Log($"[LocalDeformer] NoseTip: Y={mpNoseTipY:F4} (Y/h={(mpNoseTipY-meshCenter.y)/h:F3}) [ref +0.067]");
        Debug.Log($"[LocalDeformer] NoseBridge: Y={mpNoseBridgeY:F4} (Y/h={(mpNoseBridgeY-meshCenter.y)/h:F3}) [ref +0.110]");
        Debug.Log($"[LocalDeformer] EyeUpper: Y={mpEyeUpperY:F4} (Y/h={(mpEyeUpperY-meshCenter.y)/h:F3}) [ref +0.080]");
        Debug.Log($"[LocalDeformer] EyeInnerX: {mpEyeInnerX:F4} (X/h={mpEyeInnerX/h:F3}) [ref 0.060]");
        Debug.Log($"[LocalDeformer] EyeInnerY: {mpEyeInnerY:F4} (Y/h={(mpEyeInnerY-meshCenter.y)/h:F3}) [ref +0.108]");
        Debug.Log($"[LocalDeformer] UpperLip: Y={mpUpperLipY:F4} (Y/h={(mpUpperLipY-meshCenter.y)/h:F3}) [ref -0.042]");
        Debug.Log($"[LocalDeformer] LowerLip: Y={mpLowerLipY:F4} (Y/h={(mpLowerLipY-meshCenter.y)/h:F3}) [ref -0.051]");
        Debug.Log($"[LocalDeformer] Chin: Y={mpChinY:F4} (Y/h={(mpChinY-meshCenter.y)/h:F3}) [ref -0.100]");
        Debug.Log($"[LocalDeformer] Jaw: Y={mpJawY:F4} (Y/h={(mpJawY-meshCenter.y)/h:F3}) [ref -0.170], halfW={mpJawX:F4}");
    }

    /// <summary>
    /// Apply deformation with slider values.
    /// Called from JSBridge with JSON: { "params": [0.5, -0.3, ...] }
    /// </summary>
    public void ApplyDeformation(string json)
    {
        if (!shapedirsLoaded)
        {
            Debug.LogWarning("[LocalDeformer] Shapedirs not loaded yet");
            return;
        }
        if (!baseVerticesSaved)
        {
            Debug.LogWarning("[LocalDeformer] Base vertices not saved yet");
            return;
        }

        var data = JsonUtility.FromJson<DeformData>(json);
        if (data == null || data.@params == null) return;

        ApplyDeformationFromParams(data.@params);
    }

    /// <summary>
    /// Core deformation — optimized for real-time gesture interaction.
    /// Uses pre-allocated arrays and cached normal groups.
    /// </summary>
    private void ApplyDeformationFromParams(float[] sliders)
    {
        var mesh = targetMeshFilter.mesh;
        if (mesh == null) return;

        // Reuse cached arrays (no GC allocation)
        var flameDeltas = cachedFlameDeltas;
        int paramCount = Mathf.Min(sliders.Length, nParams);

        for (int i = 0; i < N_VERTS; i++)
        {
            float dx = 0, dy = 0, dz = 0;
            int baseIdx = i * 3 * nParams;

            for (int k = 0; k < paramCount; k++)
            {
                dx += shapedirs[baseIdx + k] * sliders[k];
                dy += shapedirs[baseIdx + nParams + k] * sliders[k];
                dz += shapedirs[baseIdx + 2 * nParams + k] * sliders[k];
            }

            flameDeltas[i] = new Vector3(dx, dy, -dz) * meshScale * deformAmplification;
        }

        // Face-only masking: zero out deltas for non-face vertices (skull, neck)
        if (faceOnlyMode)
        {
            EnsureFaceWeights();
            if (maxFaceWeight != null)
            {
                // Check if any face vertices were detected
                int faceVerts = 0;
                for (int i = 0; i < N_VERTS; i++)
                    if (maxFaceWeight[i] > 0.01f) faceVerts++;

                if (faceVerts > 0)
                {
                    for (int i = 0; i < N_VERTS; i++)
                    {
                        flameDeltas[i] *= maxFaceWeight[i];
                    }
                }
                else
                {
                    // No face vertices detected — skip masking to avoid zeroing everything
                    Debug.LogWarning("[LocalDeformer] Face-only mode: 0 face vertices, skipping mask");
                }
            }
        }

        // Apply deltas to mesh vertices using the vertex-to-FLAME mapping
        System.Array.Copy(baseVertices, cachedVerts, baseVertices.Length);

        if (vertexToFlameMap != null && vertexToFlameMap.Length == cachedVerts.Length)
        {
            for (int i = 0; i < cachedVerts.Length; i++)
            {
                int flameIdx = vertexToFlameMap[i];
                int flameIdx2 = (vertexToFlameMap2 != null && i < vertexToFlameMap2.Length)
                    ? vertexToFlameMap2[i] : -1;

                if (flameIdx >= 0 && flameIdx < N_VERTS)
                {
                    if (flameIdx2 >= 0 && flameIdx2 < N_VERTS)
                    {
                        cachedVerts[i] += (flameDeltas[flameIdx] + flameDeltas[flameIdx2]) * 0.5f;
                    }
                    else
                    {
                        cachedVerts[i] += flameDeltas[flameIdx];
                    }
                }
            }
        }

        mesh.vertices = cachedVerts;
        mesh.RecalculateNormals();
        SmoothNormalsCached(mesh);
        mesh.RecalculateBounds();

        // Update collider
        var collider = targetMeshFilter.GetComponent<MeshCollider>();
        if (collider != null) collider.sharedMesh = mesh;
    }

    // === Direct vertex displacement (no PCA) ===

    [System.Serializable]
    private class SurgeryData
    {
        public float noseBridgeHeight;
        public float noseBridgeWidth;
        public float noseTipAngle;
        public float noseWingWidth;
        public float jawWidth;
        public float jawAngle;
        public float chinLength;
        public float chinProjection;
        public float eyeLidWidth;
        public float eyeCorner;
        public float lipVolume;
        public float lipArch;
    }

    /// <summary>
    /// Direct vertex displacement — no PCA. Each slider moves specific region vertices
    /// in a specific direction. Region membership uses vertex coordinate position.
    /// </summary>
    public void ApplyDirectDeformation(string json)
    {
        if (!baseVerticesSaved)
        {
            Debug.LogWarning("[LocalDeformer] Base vertices not saved yet");
            return;
        }

        var data = JsonUtility.FromJson<SurgeryData>(json);
        if (data == null) return;

        var mesh = targetMeshFilter.mesh;
        if (mesh == null) return;

        // Compute mesh bounds from base vertices (post-normalization coordinates)
        Vector3 minV = baseVertices[0], maxV = baseVertices[0];
        for (int i = 1; i < baseVertices.Length; i++)
        {
            minV = Vector3.Min(minV, baseVertices[i]);
            maxV = Vector3.Max(maxV, baseVertices[i]);
        }
        Vector3 meshCenter = (minV + maxV) * 0.5f;
        Vector3 meshSize = maxV - minV;
        float h = meshSize.y;  // face height for proportional sizing

        // One-shot debug: log actual mesh coordinates for calibration
        if (!debugLogged)
        {
            debugLogged = true;
            Debug.Log($"[LocalDeformer] === MESH BOUNDS (runtime) ===");
            Debug.Log($"[LocalDeformer] minV=({minV.x:F5},{minV.y:F5},{minV.z:F5})");
            Debug.Log($"[LocalDeformer] maxV=({maxV.x:F5},{maxV.y:F5},{maxV.z:F5})");
            Debug.Log($"[LocalDeformer] center=({meshCenter.x:F5},{meshCenter.y:F5},{meshCenter.z:F5})");
            Debug.Log($"[LocalDeformer] size=({meshSize.x:F5},{meshSize.y:F5},{meshSize.z:F5})");
            Debug.Log($"[LocalDeformer] h={h:F5}");

            // Find key landmarks
            int totalVerts = baseVertices.Length;
            // Most forward (min Z in Unity LH)
            float bestZ = float.MaxValue; int noseTipI = 0;
            float bestTopY = float.MinValue; int topI = 0;
            float bestBotY = float.MaxValue; int chinI = 0;
            for (int i = 0; i < totalVerts; i++)
            {
                if (baseVertices[i].z < bestZ) { bestZ = baseVertices[i].z; noseTipI = i; }
                if (baseVertices[i].y > bestTopY) { bestTopY = baseVertices[i].y; topI = i; }
                if (baseVertices[i].y < bestBotY) { bestBotY = baseVertices[i].y; chinI = i; }
            }
            Debug.Log($"[LocalDeformer] NoseTip[{noseTipI}]=({baseVertices[noseTipI].x:F5},{baseVertices[noseTipI].y:F5},{baseVertices[noseTipI].z:F5})");
            Debug.Log($"[LocalDeformer] Top[{topI}]=({baseVertices[topI].x:F5},{baseVertices[topI].y:F5},{baseVertices[topI].z:F5})");
            Debug.Log($"[LocalDeformer] Chin[{chinI}]=({baseVertices[chinI].x:F5},{baseVertices[chinI].y:F5},{baseVertices[chinI].z:F5})");
            Debug.Log($"[LocalDeformer] TotalVerts={totalVerts}");

            // Print proportional positions
            float nty = (baseVertices[noseTipI].y - meshCenter.y) / h;
            float ntz = (baseVertices[noseTipI].z - minV.z) / meshSize.z;
            Debug.Log($"[LocalDeformer] NoseTip: Y=center+h*{nty:F3}, Z=minZ+size.z*{ntz:F3}");
        }

        // Convert slider mm values to mesh units
        // Slider sends mm (0–6), mesh is normalized (~0.25 units = ~230mm real head)
        float mmToUnit = h / 230f;

        // Start from base vertices
        System.Array.Copy(baseVertices, cachedVerts, baseVertices.Length);

        // Scale all params from mm to mesh units
        float nbh = data.noseBridgeHeight * mmToUnit;
        float nbw = data.noseBridgeWidth * mmToUnit;
        float nta = data.noseTipAngle * mmToUnit;
        float nww = data.noseWingWidth * mmToUnit;
        float jw = data.jawWidth * mmToUnit;
        float ja = data.jawAngle * mmToUnit;
        float cl = data.chinLength * mmToUnit;
        float cp = data.chinProjection * mmToUnit;
        float elw = data.eyeLidWidth * mmToUnit;
        float ec = data.eyeCorner * mmToUnit;
        float lv = data.lipVolume * mmToUnit;
        float la = data.lipArch * mmToUnit;

        // ====================================================================
        // Positions: blend MediaPipe landmarks with hardcoded fallbacks.
        // MediaPipe provides face-specific adjustments; hardcoded values are
        // the safe baseline. We clamp deviations to avoid extreme positioning.
        // ====================================================================

        // Hardcoded reference values (proven to work)
        float hcNoseY   = meshCenter.y + h * 0.067f;
        float hcNoseZ   = minV.z + meshSize.z * 0.05f;
        float hcBridgeY = meshCenter.y + h * 0.11f;
        float hcEyeY    = meshCenter.y + h * 0.08f;
        float hcEyeZ    = minV.z + meshSize.z * 0.10f;
        float hcInnerX  = h * 0.06f;   // verified from FLAME mesh analysis (v[1894]/v[2972])
        float hcLipY    = meshCenter.y - h * 0.042f;
        float hcLipTopY = meshCenter.y - h * 0.033f;
        float hcChinY   = meshCenter.y - h * 0.10f;
        float hcJawY    = meshCenter.y - h * 0.17f;

        // Use hardcoded values with MediaPipe corrections when available
        float noseY, noseZ, bridgeY, eyeY, eyeZ, innerX, lipY, lipTopY, chinY, jawY;

        if (mpLandmarksReady)
        {
            // With 4-anchor piecewise mapping, all Y positions are MediaPipe-driven
            float maxDev = h * 0.03f;  // for features that still need clamping

            noseY   = mpNoseTipY;       // anchor point, always accurate
            noseZ   = hcNoseZ;
            bridgeY = mpNoseBridgeY;    // anchor point, always accurate
            eyeY    = Mathf.Clamp(mpEyeUpperY, hcEyeY - maxDev, hcEyeY + maxDev);
            eyeZ    = hcEyeZ;
            innerX  = meshInnerEyeX > 0 ? meshInnerEyeX : hcInnerX;  // mesh topology detected
            lipY    = (mpUpperLipY + mpLowerLipY) * 0.5f;  // lip center from MediaPipe
            lipTopY = mpUpperLipY;        // upper lip edge from MediaPipe
            chinY   = mpChinY;          // anchor point, always accurate
            jawY    = hcJawY;           // MediaPipe jaw indices are at ear
        }
        else
        {
            noseY   = hcNoseY;
            noseZ   = hcNoseZ;
            bridgeY = hcBridgeY;
            eyeY    = hcEyeY;
            eyeZ    = hcEyeZ;
            innerX  = hcInnerX;
            lipY    = hcLipY;
            lipTopY = hcLipTopY;
            chinY   = hcChinY;
            jawY    = hcJawY;
        }

        // Neck protection: jaw_angle is at Y/h=-0.363
        float neckFloorY = meshCenter.y - h * 0.38f;

        // --- NOSE ---
        // bridge HEIGHT: push forward (0,0,-1) to raise bridge profile.
        // Fixed direction preserves nose shape; wider hx + low sharpness = smooth ridge.
        ApplyRegionDisplacement(cachedVerts, nbh,
            new Vector3(0, 0, -1),
            meshCenter.x,
            bridgeY,
            noseZ,
            h * 0.025f, h * 0.06f, h * 0.05f,
            2.5f);

        // nose bridge width: narrow region centered on nose bridge
        ApplySymmetricXDisplacement(cachedVerts, nbw,
            meshCenter.x,
            noseY,
            minV.z + meshSize.z * 0.002f,
            h * 0.04f, h * 0.06f, h * 0.06f,
            3.0f);

        // nose tip angle: ROTATE around bridge root (pivot at Y/h=0.075)
        {
            float pivotY = meshCenter.y + h * 0.075f;
            float pivotZ = minV.z + meshSize.z * 0.002f;
            float tipCy = meshCenter.y + h * 0.065f;
            float tipCz = minV.z + meshSize.z * 0.000f;
            float tipHx = h * 0.04f, tipHy = h * 0.04f, tipHz = h * 0.04f;
            float tipSharp = 2.5f;
            float angle = nta * 8.0f;

            if (Mathf.Abs(angle) > 0.001f)
            {
                float cosA = Mathf.Cos(angle);
                float sinA = Mathf.Sin(angle);
                for (int i = 0; i < cachedVerts.Length; i++)
                {
                    float dx = Mathf.Abs(baseVertices[i].x - meshCenter.x) / tipHx;
                    float dy = Mathf.Abs(baseVertices[i].y - tipCy) / tipHy;
                    float dz = Mathf.Abs(baseVertices[i].z - tipCz) / tipHz;
                    float normDist = Mathf.Max(dx, Mathf.Max(dy, dz));
                    float weight;
                    if (normDist <= 1.0f) weight = 1.0f;
                    else weight = Mathf.Exp(-((normDist - 1f) * (normDist - 1f)) * tipSharp * tipSharp);
                    if (weight > 0.01f)
                    {
                        float ry = cachedVerts[i].y - pivotY;
                        float rz = cachedVerts[i].z - pivotZ;
                        float newY = ry * cosA - rz * sinA;
                        float newZ = ry * sinA + rz * cosA;
                        cachedVerts[i].y = pivotY + ry + (newY - ry) * weight;
                        cachedVerts[i].z = pivotZ + rz + (newZ - rz) * weight;
                    }
                }
            }
        }

        // nose wing width: nostril level
        float nostrilY = mpLandmarksReady ? (noseY + lipTopY) * 0.5f : meshCenter.y + h * 0.025f;
        ApplySymmetricXDisplacement(cachedVerts, nww,
            meshCenter.x,
            nostrilY,
            minV.z + meshSize.z * 0.03f,
            h * 0.08f, h * 0.04f, h * 0.06f,
            2.0f);

        // --- JAW ---
        float jawNeckFloor = meshCenter.y - h * 0.30f;
        ApplySymmetricXDisplacement(cachedVerts, jw,
            meshCenter.x,
            jawY - cl * 0.5f,
            minV.z + meshSize.z * 0.35f,
            h * 0.15f, h * 0.06f, h * 0.25f,
            1.5f, jawNeckFloor);

        // jaw angle: PIVOT ROTATION
        {
            float pivotY = meshCenter.y - h * 0.08f;
            float pivotZ = minV.z + meshSize.z * 0.20f;
            float jawCy2 = meshCenter.y - h * 0.17f;
            float jawCz2 = minV.z + meshSize.z * 0.25f;
            float jawHx2 = h * 0.12f, jawHy2 = h * 0.06f, jawHz2 = h * 0.10f;
            float jawSharp2 = 3.0f;
            float jawAngle = ja * 6.0f;

            if (Mathf.Abs(jawAngle) > 0.001f)
            {
                float cosA = Mathf.Cos(jawAngle);
                float sinA = Mathf.Sin(jawAngle);
                for (int i = 0; i < cachedVerts.Length; i++)
                {
                    if (baseVertices[i].y < jawNeckFloor) continue;

                    float ddx = Mathf.Abs(baseVertices[i].x - meshCenter.x) / jawHx2;
                    float ddy = Mathf.Abs(baseVertices[i].y - jawCy2) / jawHy2;
                    float ddz = Mathf.Abs(baseVertices[i].z - jawCz2) / jawHz2;
                    float normDist = Mathf.Max(ddx, Mathf.Max(ddy, ddz));
                    float weight;
                    if (normDist <= 1.0f) weight = 1.0f;
                    else weight = Mathf.Exp(-((normDist - 1f) * (normDist - 1f)) * jawSharp2 * jawSharp2);
                    if (weight > 0.01f)
                    {
                        float ry = cachedVerts[i].y - pivotY;
                        float rz = cachedVerts[i].z - pivotZ;
                        float newY = ry * cosA - rz * sinA;
                        float newZ = ry * sinA + rz * cosA;
                        cachedVerts[i].y = pivotY + ry + (newY - ry) * weight;
                        cachedVerts[i].z = pivotZ + rz + (newZ - rz) * weight;
                    }
                }
            }
        }

        // --- CHIN ---
        float chinNeckFloor = meshCenter.y - h * 0.26f;
        float chinLipCeiling = mpLandmarksReady ? mpLowerLipY - h * 0.02f : meshCenter.y - h * 0.07f;
        ApplyRegionDisplacement(cachedVerts, cl,
            new Vector3(0, -1, 0),
            meshCenter.x,
            chinY,
            minV.z + meshSize.z * 0.10f,
            h * 0.05f, h * 0.06f, h * 0.10f,
            2.0f, chinNeckFloor, float.MaxValue, chinLipCeiling);

        // chin projection: targets LENGTHENED chin position
        ApplyRegionDisplacement(cachedVerts, cp,
            new Vector3(0, 0, -1),
            meshCenter.x,
            chinY - cl,
            minV.z + meshSize.z * 0.10f,
            h * 0.05f, h * 0.06f, h * 0.10f,
            2.0f, chinNeckFloor - cl, float.MaxValue, chinLipCeiling);

        // --- EYES ---
        // Eyelid (双眼皮): crease positioned ABOVE the upper eyelid opening
        // Surgical double eyelid crease is ~6-8mm above lash line → ~0.03h
        float eyelidCreaseY = eyeY + h * 0.03f;
        ApplyRegionDisplacement(cachedVerts, elw,
            new Vector3(0, 1, 0),
            meshCenter.x,
            eyelidCreaseY,
            eyeZ,
            h * 0.15f, h * 0.025f, h * 0.05f,
            2.5f);

        // eye corner: 开眼角 = open INNER canthus (epicanthoplasty)
        // Custom loop: ONLY moves vertices on the EYE side of center toward
        // the nose. Nose-side vertices are skipped entirely to prevent
        // nose bridge compression.
        if (Mathf.Abs(ec) > 0.001f)
        {
            float ecY = (mpLandmarksReady ? mpEyeUpperY : (meshCenter.y + h * 0.108f)) + h * 0.02f;
            float ecZ = meshInnerEyeZ > float.MinValue ? meshInnerEyeZ : (minV.z + meshSize.z * 0.16f);
            float ecHx = h * 0.02f, ecHy = h * 0.015f, ecHz = h * 0.02f;
            float ecCxR = meshCenter.x + innerX * 0.7f;
            float ecCxL = meshCenter.x - innerX * 0.7f;
            float ecSharp = 2.5f;

            for (int i = 0; i < cachedVerts.Length; i++)
            {
                float vx = baseVertices[i].x;
                float vy = baseVertices[i].y;
                float vz = baseVertices[i].z;

                // --- Right eye: only affect vertices with X > ecCxR (eye side) ---
                if (vx > ecCxR)
                {
                    float dx = (vx - ecCxR) / ecHx;
                    float dy = Mathf.Abs(vy - ecY) / ecHy;
                    float dz = Mathf.Abs(vz - ecZ) / ecHz;
                    float nd = Mathf.Max(dx, Mathf.Max(dy, dz));
                    float w = nd <= 1f ? 1f : Mathf.Exp(-((nd - 1f) * (nd - 1f)) * ecSharp * ecSharp);
                    // Proportional: closer to center moves less, prevents bunching
                    float ratio = Mathf.Clamp01(dx * 0.5f);
                    if (w > 0.01f)
                        cachedVerts[i].x -= ec * w * ratio;
                }

                // --- Left eye: only affect vertices with X < ecCxL (eye side) ---
                if (vx < ecCxL)
                {
                    float dx = (ecCxL - vx) / ecHx;
                    float dy = Mathf.Abs(vy - ecY) / ecHy;
                    float dz = Mathf.Abs(vz - ecZ) / ecHz;
                    float nd = Mathf.Max(dx, Mathf.Max(dy, dz));
                    float w = nd <= 1f ? 1f : Mathf.Exp(-((nd - 1f) * (nd - 1f)) * ecSharp * ecSharp);
                    float ratio = Mathf.Clamp01(dx * 0.5f);
                    if (w > 0.01f)
                        cachedVerts[i].x += ec * w * ratio;
                }
            }
        }

        // --- LIPS ---
        // lip volume: push forward at lip center
        // yCeiling protects mid-face (nasolabial area) from being affected
        float lipZ = minV.z + meshSize.z * 0.015f;  // front of lip surface
        float lipCeiling = noseY - h * 0.02f;  // don't affect anything above nose base
        ApplyRegionDisplacement(cachedVerts, lv,
            new Vector3(0, 0, -1),
            meshCenter.x,
            lipY,
            lipZ,
            h * 0.05f, h * 0.02f, h * 0.04f,
            3.5f, float.MinValue, float.MaxValue, lipCeiling);

        // lip arch: upper lip cupid's bow
        ApplyRegionDisplacement(cachedVerts, la,
            new Vector3(0, 1, -0.3f).normalized,
            meshCenter.x,
            lipTopY,
            minV.z + meshSize.z * 0.015f,
            h * 0.04f, h * 0.015f, h * 0.03f,
            3.5f, float.MinValue, float.MaxValue, lipCeiling);

        mesh.vertices = cachedVerts;
        mesh.RecalculateNormals();
        SmoothNormalsCached(mesh);
        mesh.RecalculateBounds();

        var collider = targetMeshFilter.GetComponent<MeshCollider>();
        if (collider != null) collider.sharedMesh = mesh;

        // Send completion signal
        // Completion signal sent by JSBridge.ApplyDirectDeformation
    }

    /// <summary>
    /// Displace vertices in a region along a given direction, with Gaussian falloff.
    /// Optional yFloor: skip vertices below this Y to protect neck.
    /// </summary>
    private void ApplyRegionDisplacement(Vector3[] verts, float amount,
        Vector3 direction, float cx, float cy, float cz,
        float hx, float hy, float hz, float sharpness,
        float yFloor = float.MinValue, float zMax = float.MaxValue,
        float yCeiling = float.MaxValue)
    {
        if (Mathf.Abs(amount) < 0.001f) return;

        for (int i = 0; i < verts.Length; i++)
        {
            // Smooth yFloor: blend weight near floor instead of hard cut
            float floorFade = 1.0f;
            if (yFloor > float.MinValue && baseVertices[i].y < yFloor + hy * 0.5f)
            {
                if (baseVertices[i].y < yFloor) continue;
                floorFade = (baseVertices[i].y - yFloor) / (hy * 0.5f);
                floorFade = floorFade * floorFade;  // quadratic ease
            }
            // Smooth yCeiling: blend weight to zero over h*0.02 zone
            float ceilingFade = 1.0f;
            if (yCeiling < float.MaxValue && baseVertices[i].y > yCeiling - hy * 0.5f)
            {
                if (baseVertices[i].y > yCeiling) continue;
                ceilingFade = (yCeiling - baseVertices[i].y) / (hy * 0.5f);
                ceilingFade = ceilingFade * ceilingFade;  // quadratic ease
            }
            if (baseVertices[i].z > zMax) continue;       // back-of-head Z protection

            float dx = Mathf.Abs(verts[i].x - cx) / hx;
            float dy = Mathf.Abs(verts[i].y - cy) / hy;
            float dz = Mathf.Abs(verts[i].z - cz) / hz;
            float normDist = Mathf.Max(dx, Mathf.Max(dy, dz));

            float weight;
            if (normDist <= 1.0f)
                weight = 1.0f;
            else
                weight = Mathf.Exp(-((normDist - 1f) * (normDist - 1f)) * sharpness * sharpness);

            if (weight > 0.01f)
                verts[i] += direction * amount * weight * ceilingFade * floorFade;
        }
    }

    /// <summary>
    /// Displace vertices along their SURFACE NORMAL direction, with Gaussian falloff.
    /// Positive amount = push outward (augment), Negative = push inward (reduce).
    /// This naturally follows surface curvature — ideal for nose bridge/tip.
    /// </summary>
    private void ApplyNormalDisplacement(Vector3[] verts, float amount,
        float cx, float cy, float cz,
        float hx, float hy, float hz, float sharpness)
    {
        if (Mathf.Abs(amount) < 0.001f) return;
        if (baseNormals == null || baseNormals.Length != verts.Length) return;

        for (int i = 0; i < verts.Length; i++)
        {
            float dx = Mathf.Abs(baseVertices[i].x - cx) / hx;
            float dy = Mathf.Abs(baseVertices[i].y - cy) / hy;
            float dz = Mathf.Abs(baseVertices[i].z - cz) / hz;
            float normDist = Mathf.Max(dx, Mathf.Max(dy, dz));

            float weight;
            if (normDist <= 1.0f)
                weight = 1.0f;
            else
                weight = Mathf.Exp(-((normDist - 1f) * (normDist - 1f)) * sharpness * sharpness);

            if (weight > 0.01f)
                verts[i] += baseNormals[i] * amount * weight;
        }
    }

    /// <summary>
    /// Symmetric width displacement with anti-clipping protection.
    /// Uses baseVertices for sign detection (prevents wrong-sign after displacement).
    /// Displacement proportional to distance from center (center verts don't move).
    /// Optional yFloor to protect neck.
    /// </summary>
    private void ApplySymmetricXDisplacement(Vector3[] verts, float amount,
        float cx, float cy, float cz, float hx, float hy, float hz,
        float sharpness, float yFloor = float.MinValue, float zMax = float.MaxValue)
    {
        if (Mathf.Abs(amount) < 0.001f) return;

        // Find max X distance from center in the region for normalization
        float maxXDist = 0.001f;
        for (int i = 0; i < baseVertices.Length; i++)
        {
            if (baseVertices[i].y < yFloor) continue;
            if (baseVertices[i].z > zMax) continue;
            float dy2 = Mathf.Abs(baseVertices[i].y - cy) / hy;
            float dz2 = Mathf.Abs(baseVertices[i].z - cz) / hz;
            if (dy2 < 1.5f && dz2 < 1.5f)
            {
                float d = Mathf.Abs(baseVertices[i].x - cx);
                if (d > maxXDist) maxXDist = d;
            }
        }

        for (int i = 0; i < verts.Length; i++)
        {
            if (baseVertices[i].y < yFloor) continue; // neck Y protection
            if (baseVertices[i].z > zMax) continue;    // back-of-head Z protection

            // Use BASE vertex position for sign — prevents wrong-sign from prior displacements
            float baseX = baseVertices[i].x;
            float baseDist = Mathf.Abs(baseX - cx);

            float dx = baseDist / hx;
            float dy = Mathf.Abs(baseVertices[i].y - cy) / hy;
            float dz = Mathf.Abs(baseVertices[i].z - cz) / hz;
            float normDist = Mathf.Max(dx, Mathf.Max(dy, dz));

            float weight;
            if (normDist <= 1.0f)
                weight = 1.0f;
            else
                weight = Mathf.Exp(-((normDist - 1f) * (normDist - 1f)) * sharpness * sharpness);

            if (weight > 0.01f)
            {
                // Proportional to base distance from center
                float lateralRatio = baseDist / maxXDist;
                // Sign from BASE position (stable, never flips)
                float sign = (baseX > cx) ? 1f : ((baseX < cx) ? -1f : 0f);
                float displacement = sign * amount * weight * lateralRatio;

                // Anti-clipping: only clamp when NARROWING (amount < 0)
                float newX = verts[i].x + displacement;
                if (amount < 0)
                {
                    float minKeep = baseDist * 0.15f; // keep at least 15% of original distance
                    if (sign > 0 && newX < cx + minKeep) newX = cx + minKeep;
                    else if (sign < 0 && newX > cx - minKeep) newX = cx - minKeep;
                }
                verts[i].x = newX;
            }
        }
    }

    /// <summary>
    /// Fast smooth normals using pre-computed vertex groups.
    /// Only iterates cached groups (skip spatial hashing entirely).
    /// </summary>
    private void SmoothNormalsCached(Mesh mesh)
    {
        if (cachedNormalGroups == null || cachedNormalGroups.Length == 0) return;

        Vector3[] normals = mesh.normals;

        for (int g = 0; g < cachedNormalGroups.Length; g++)
        {
            int[] group = cachedNormalGroups[g];
            Vector3 avg = Vector3.zero;
            for (int i = 0; i < group.Length; i++)
                avg += normals[group[i]];
            avg.Normalize();
            for (int i = 0; i < group.Length; i++)
                normals[group[i]] = avg;
        }

        mesh.normals = normals;
    }

    // Mapping: mesh vertex index → FLAME vertex index (0..5022)
    private int[] vertexToFlameMap;
    // Secondary parent for subdivision midpoints (-1 if original vertex)
    private int[] vertexToFlameMap2;

    /// <summary>
    /// Build vertex-to-FLAME mapping from OBJ parse data.
    /// Called by UVTextureLoader after ParseOBJ creates per-face vertices.
    /// </summary>
    public void SetVertexMapping(int[] mapping, int[] mapping2 = null)
    {
        vertexToFlameMap = mapping;
        vertexToFlameMap2 = mapping2;
        Debug.Log($"[LocalDeformer] Vertex mapping set: {mapping.Length} entries, dual={mapping2 != null}");
    }

    public bool IsReady()
    {
        return shapedirsLoaded && baseVerticesSaved;
    }

    /// <summary>
    /// Enable/disable face-only masking mode.
    /// When enabled, skull/neck vertices don't move during deformation.
    /// </summary>
    public void SetFaceOnlyMode(string json)
    {
        var data = JsonUtility.FromJson<FaceOnlyData>(json);
        if (data != null)
        {
            faceOnlyMode = data.enabled;
            Debug.Log($"[LocalDeformer] Face-only mode: {faceOnlyMode}");
        }
    }

    [System.Serializable]
    private class FaceOnlyData
    {
        public bool enabled;
    }

    /// <summary>
    /// Lazy-compute maxFaceWeight from region weights.
    /// maxFaceWeight[v] = max across all regions of regionWeights[r][v].
    /// Face vertices ≈ 1.0, skull/neck vertices ≈ 0.0.
    /// </summary>
    private void EnsureFaceWeights()
    {
        if (maxFaceWeight != null) return;

        if (!shapedirsLoaded || shapedirs == null)
        {
            Debug.LogWarning("[LocalDeformer] Cannot compute face weights: shapedirs not loaded");
            return;
        }

        // Use shapedirs magnitude to identify face vertices:
        // Face vertices have large shapedir values (they respond to shape params),
        // skull/scalp vertices have near-zero shapedirs (they don't move).
        maxFaceWeight = new float[N_VERTS];
        float[] magnitude = new float[N_VERTS];
        float maxMag = 0f;

        for (int v = 0; v < N_VERTS; v++)
        {
            float sum = 0f;
            int baseIdx = v * 3 * nParams;
            // Sum absolute values of all shapedir components for this vertex
            for (int k = 0; k < nParams * 3; k++)
            {
                sum += Mathf.Abs(shapedirs[baseIdx + k]);
            }
            magnitude[v] = sum;
            if (sum > maxMag) maxMag = sum;
        }

        if (maxMag < 1e-6f)
        {
            // All shapedirs are zero — can't determine face mask
            Debug.LogWarning("[LocalDeformer] Shapedirs all zero, skipping face mask");
            for (int v = 0; v < N_VERTS; v++) maxFaceWeight[v] = 1f;
            return;
        }

        // Normalize to [0,1] and apply threshold sigmoid
        // Vertices above 15% of max magnitude = face, below = skull
        float threshold = maxMag * 0.15f;
        float sharpness = 10f; // Controls smoothness of transition

        int faceCount = 0;
        for (int v = 0; v < N_VERTS; v++)
        {
            float x = (magnitude[v] - threshold) / (maxMag * 0.05f); // Normalize around threshold
            maxFaceWeight[v] = 1f / (1f + Mathf.Exp(-sharpness * x)); // Sigmoid
            if (maxFaceWeight[v] > 0.5f) faceCount++;
        }

        Debug.Log($"[LocalDeformer] Face weights (shapedirs-based): {faceCount}/{N_VERTS} face vertices (threshold={threshold:F4})");
    }

    [System.Serializable]
    private class DeformData
    {
        public float[] @params;
    }

    // === Region-isolated deformation ===

    /// <summary>
    /// Pre-compute per-vertex soft weights for each facial region.
    /// Uses FLAME coordinate-space bounding boxes with Gaussian falloff.
    /// Must be called after base vertices are saved AND before mesh normalization.
    /// We use the shapedirs base mesh (FLAME coords) for region classification.
    /// </summary>
    public void PrecomputeRegionWeights()
    {
        if (!shapedirsLoaded || shapedirs == null) return;

        // Extract base FLAME vertex positions from shapedirs at zero params
        // Actually we need the un-scaled, un-centered FLAME positions.
        // We'll use the baseVertices with inverse scale and assume centered around origin.
        // For region classification, we can use the scaled positions since
        // the bounding boxes will be scaled accordingly.

        regionWeights = new float[REGION_NAMES.Length][];

        // Region bounding boxes in FLAME coordinate space (pre-normalization)
        // Format: centerX, centerY, centerZ, halfExtentX, halfExtentY, halfExtentZ
        float[][] regionBoxes = new float[][] {
            // nose: X[-0.03,0.03] Y[-0.06,0.00] Z[-0.16,-0.10]
            new float[] { 0f, -0.03f, -0.13f, 0.03f, 0.04f, 0.04f },
            // jaw: X[-0.08,0.08] Y[-0.18,-0.06] Z[-0.15,0.08]
            new float[] { 0f, -0.12f, -0.035f, 0.08f, 0.07f, 0.12f },
            // chin: subset of jaw, lower center
            new float[] { 0f, -0.16f, -0.10f, 0.04f, 0.04f, 0.06f },
            // eyes: both left+right combined X[-0.06,0.06] Y[0.00,0.04] Z[-0.14,-0.06]
            new float[] { 0f, 0.02f, -0.10f, 0.06f, 0.03f, 0.05f },
            // lips: X[-0.03,0.03] Y[-0.10,-0.04] Z[-0.16,-0.08]
            new float[] { 0f, -0.07f, -0.12f, 0.04f, 0.04f, 0.05f },
            // forehead: X[-0.06,0.06] Y[0.04,0.10] Z[-0.14,-0.02]
            new float[] { 0f, 0.07f, -0.08f, 0.06f, 0.04f, 0.07f },
            // cheek: X[-0.08,0.08] Y[-0.04,0.04] Z[-0.14,0.02]
            new float[] { 0f, 0.00f, -0.06f, 0.08f, 0.05f, 0.09f },
        };

        // Sigma for Gaussian falloff (larger = softer transition)
        float sigma = 1.5f;

        for (int r = 0; r < REGION_NAMES.Length; r++)
        {
            regionWeights[r] = new float[N_VERTS];
            float cx = regionBoxes[r][0], cy = regionBoxes[r][1], cz = regionBoxes[r][2];
            float hx = regionBoxes[r][3], hy = regionBoxes[r][4], hz = regionBoxes[r][5];

            for (int v = 0; v < N_VERTS; v++)
            {
                // Get FLAME vertex position from shapedirs base
                // shapedirs layout: [v0_x_p0..p199, v0_y_p0..p199, v0_z_p0..p199, v1_x_p0..p199, ...]
                // Base position at zero params is all zeros, but we need the actual FLAME template position.
                // Since we don't have it directly, use baseVertices with inverse mesh scale.
                // Actually the base positions are stored in baseVertices (after centering+scaling).
                // For region classification, we need to un-scale them.
                float px, py, pz;
                if (baseVerticesSaved && vertexToFlameMap != null)
                {
                    // Find a mesh vertex that maps to this FLAME vertex
                    int meshIdx = -1;
                    for (int m = 0; m < vertexToFlameMap.Length; m++)
                    {
                        if (vertexToFlameMap[m] == v) { meshIdx = m; break; }
                    }
                    if (meshIdx >= 0 && meshIdx < baseVertices.Length)
                    {
                        // Un-scale to FLAME coordinate space
                        px = baseVertices[meshIdx].x / meshScale;
                        py = baseVertices[meshIdx].y / meshScale;
                        pz = -baseVertices[meshIdx].z / meshScale; // Undo RH→LH Z flip
                    }
                    else
                    {
                        regionWeights[r][v] = 0f;
                        continue;
                    }
                }
                else
                {
                    regionWeights[r][v] = 0f;
                    continue;
                }

                // Normalized distance from box center (0 = at center, 1 = at edge)
                float dx = Mathf.Abs(px - cx) / hx;
                float dy = Mathf.Abs(py - cy) / hy;
                float dz = Mathf.Abs(pz - cz) / hz;
                float normDist = Mathf.Max(dx, Mathf.Max(dy, dz));

                // Gaussian falloff: 1.0 inside box, smooth decay outside
                if (normDist <= 1.0f)
                    regionWeights[r][v] = 1.0f;
                else
                    regionWeights[r][v] = Mathf.Exp(-((normDist - 1f) * (normDist - 1f)) * sigma * sigma);
            }
        }

        regionWeightsComputed = true;
        Debug.Log($"[LocalDeformer] Region weights computed for {REGION_NAMES.Length} regions");
    }

    /// <summary>
    /// Apply region-isolated deformation. Each region has its own PCA shape array.
    /// Deltas are masked by per-vertex region weights to prevent cross-feature coupling.
    /// </summary>
    public void ApplyRegionDeformation(string json)
    {
        if (!shapedirsLoaded || !baseVerticesSaved) return;

        var data = JsonUtility.FromJson<RegionDeformData>(json);
        if (data == null) return;

        // Compute region weights on first call if not done yet
        if (!regionWeightsComputed) PrecomputeRegionWeights();

        var mesh = targetMeshFilter.mesh;
        if (mesh == null) return;

        // Start from base vertices
        System.Array.Copy(baseVertices, cachedVerts, baseVertices.Length);

        // Accumulate masked deltas from each region
        float[][] allRegionSliders = {
            data.nose, data.jaw, data.chin, data.eye, data.lip, data.forehead, data.cheek
        };

        var flameDeltas = cachedFlameDeltas;

        for (int r = 0; r < REGION_NAMES.Length; r++)
        {
            float[] sliders = allRegionSliders[r];
            if (sliders == null || sliders.Length == 0) continue;

            // Check if all zeros (skip for performance)
            bool allZero = true;
            for (int k = 0; k < sliders.Length; k++)
                if (sliders[k] != 0f) { allZero = false; break; }
            if (allZero) continue;

            float[] weights = regionWeightsComputed ? regionWeights[r] : null;
            int paramCount = Mathf.Min(sliders.Length, nParams);

            // Compute PCA deltas for this region's shape array
            for (int i = 0; i < N_VERTS; i++)
            {
                float w = (weights != null) ? weights[i] : 1f;
                if (w < 0.001f) continue; // Skip vertices with no influence

                float dx = 0, dy = 0, dz = 0;
                int baseIdx = i * 3 * nParams;

                for (int k = 0; k < paramCount; k++)
                {
                    dx += shapedirs[baseIdx + k] * sliders[k];
                    dy += shapedirs[baseIdx + nParams + k] * sliders[k];
                    dz += shapedirs[baseIdx + 2 * nParams + k] * sliders[k];
                }

                Vector3 delta = new Vector3(dx, dy, -dz) * meshScale * deformAmplification * w;

                // Apply to mesh vertices through mapping
                // (We need to apply directly here since we're accumulating per-region)
                flameDeltas[i] = delta;
            }

            // Apply this region's masked deltas through vertex mapping
            if (vertexToFlameMap != null)
            {
                for (int i = 0; i < cachedVerts.Length; i++)
                {
                    int flameIdx = vertexToFlameMap[i];
                    int flameIdx2 = (vertexToFlameMap2 != null && i < vertexToFlameMap2.Length)
                        ? vertexToFlameMap2[i] : -1;

                    if (flameIdx >= 0 && flameIdx < N_VERTS)
                    {
                        if (flameIdx2 >= 0 && flameIdx2 < N_VERTS)
                            cachedVerts[i] += (flameDeltas[flameIdx] + flameDeltas[flameIdx2]) * 0.5f;
                        else
                            cachedVerts[i] += flameDeltas[flameIdx];
                    }
                }
            }

            // Clear flameDeltas for next region
            System.Array.Clear(flameDeltas, 0, N_VERTS);
        }

        mesh.vertices = cachedVerts;
        mesh.RecalculateNormals();
        SmoothNormalsCached(mesh);
        mesh.RecalculateBounds();

        var collider = targetMeshFilter.GetComponent<MeshCollider>();
        if (collider != null) collider.sharedMesh = mesh;
    }

    [System.Serializable]
    private class RegionDeformData
    {
        public float[] nose;
        public float[] jaw;
        public float[] chin;
        public float[] eye;
        public float[] lip;
        public float[] forehead;
        public float[] cheek;
    }
}
