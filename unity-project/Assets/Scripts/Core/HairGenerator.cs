using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// HairGenerator V3 — Hair Card Strips from FLAME scalp vertices.
///
/// V1/V2 FAILURE: Shell offset = helmet, not hair.
/// V3 FIX: Generate individual "hair card strips" — chains of quads
///          that extend outward from scalp vertices, creating visible
///          strand-like geometry with gaps between them.
///
/// Each strip: 2-4 quads chained together, flowing along normal then
///             curving downward with gravity. Width gives each strip
///             some body, gaps between strips create hair-like appearance.
/// </summary>
public class HairGenerator : MonoBehaviour
{
    [Header("References")]
    public MeshFilter faceMeshFilter;

    [Header("Hair Parameters")]
    public Color hairColor = new Color(0.08f, 0.06f, 0.05f, 1f);

    // Strip generation parameters
    public int stripSegments = 3;    // Segments per strip
    public float stripLength = 0.025f; // Total length of each strip
    public float stripWidth = 0.004f;  // Width of each strip
    public float gravity = 0.3f;       // Gravity pull (0=straight out, 1=hang down)
    public float randomness = 0.15f;   // Direction randomness
    public int vertexSkip = 2;         // Use every Nth scalp vertex (density control)
    public float normalZMax = 0.2f;    // Exclude face-forward vertices (normal.z > this)
    public float minY = -0.01f;        // Minimum Y for scalp vertices

    private List<GameObject> hairObjects = new List<GameObject>();
    private Material hairMaterial;

    public enum HairStyle { Short, Medium, Fluffy }

    // (segments, length, width, gravity, randomness, skip, nzMax, minY)
    private static readonly Dictionary<HairStyle, (int seg, float len, float wid, float grav, float rand, int skip, float nz, float my)> PRESETS = new()
    {
        { HairStyle.Short,  (2, 0.015f, 0.003f, 0.2f, 0.10f, 3, 0.15f, 0.01f)  },
        { HairStyle.Medium, (3, 0.030f, 0.004f, 0.4f, 0.15f, 2, 0.20f, -0.01f)  },
        { HairStyle.Fluffy, (4, 0.035f, 0.005f, 0.2f, 0.30f, 2, 0.25f, -0.02f)  },
    };

    public void GenerateHair()
    {
        if (faceMeshFilter == null || faceMeshFilter.mesh == null)
        {
            Debug.LogWarning("[HairGenerator] No face mesh available");
            return;
        }

        // Lazy material from face renderer
        if (hairMaterial == null)
        {
            var faceRenderer = faceMeshFilter.GetComponent<MeshRenderer>();
            if (faceRenderer != null && faceRenderer.material != null)
            {
                hairMaterial = new Material(faceRenderer.material.shader);
            }
            else
            {
                Shader shader = Shader.Find("Unlit/Color")
                    ?? Shader.Find("UI/Default")
                    ?? Shader.Find("Sprites/Default");
                hairMaterial = new Material(shader);
            }
            hairMaterial.color = hairColor;
            hairMaterial.renderQueue = 3001;
            hairMaterial.mainTexture = null;
        }

        ClearHair();

        Mesh faceMesh = faceMeshFilter.mesh;
        Vector3[] verts = faceMesh.vertices;
        Vector3[] normals = faceMesh.normals;

        if (normals == null || normals.Length == 0)
        {
            faceMesh.RecalculateNormals();
            normals = faceMesh.normals;
        }

        // Compute mesh center to define front/back hemisphere
        Vector3 center = Vector3.zero;
        for (int i = 0; i < verts.Length; i++) center += verts[i];
        center /= verts.Length;

        // Find mesh bounds for relative positioning
        float maxY = float.MinValue;
        for (int i = 0; i < verts.Length; i++)
            if (verts[i].y > maxY) maxY = verts[i].y;

        // Scalp detection:
        // 1. Must be in the BACK hemisphere (Z < center.Z) — excludes entire face
        // 2. OR at the very top (Y > 80% of max) — includes crown even if slightly forward
        // 3. Must be above ear line (Y > center.Y)
        // 4. Normal must not point strongly forward (n.z < normalZMax)
        var scalpVertices = new List<int>();
        float topThreshold = center.y + (maxY - center.y) * 0.6f; // Top 40% of head

        for (int i = 0; i < verts.Length; i++)
        {
            Vector3 n = normals[i].normalized;
            Vector3 v = verts[i];

            bool isBack = v.z < center.z;           // Behind center = back of head
            bool isTop = v.y > topThreshold;         // Top portion of head
            bool isAboveEar = v.y > center.y;        // Above ear line
            bool notFaceForward = n.z < normalZMax;  // Normal not pointing at camera

            // Scalp = (back of head OR very top) AND above ears AND not face-forward
            if ((isBack || isTop) && isAboveEar && notFaceForward)
            {
                scalpVertices.Add(i);
            }
        }

        Debug.Log($"[HairGenerator] Center={center}, maxY={maxY}, topThresh={topThreshold}, scalp={scalpVertices.Count}/{verts.Length}");

        if (scalpVertices.Count == 0)
        {
            Debug.LogWarning("[HairGenerator] No scalp vertices found");
            return;
        }

        // Generate strip mesh
        var allVerts = new List<Vector3>();
        var allTris = new List<int>();
        var allNormals = new List<Vector3>();

        int stripCount = 0;
        // Deterministic random for consistent results
        System.Random rng = new System.Random(42);

        for (int si = 0; si < scalpVertices.Count; si += vertexSkip)
        {
            int vi = scalpVertices[si];
            Vector3 rootPos = verts[vi];
            Vector3 rootNormal = normals[vi].normalized;

            // Random lateral direction (perpendicular to normal)
            Vector3 tangent = GetTangent(rootNormal);

            // Small random offset for natural variation
            float rx = (float)(rng.NextDouble() - 0.5) * randomness;
            float ry = (float)(rng.NextDouble() - 0.5) * randomness;
            float rz = (float)(rng.NextDouble() - 0.5) * randomness;
            Vector3 randDir = new Vector3(rx, ry, rz);

            GenerateStrip(rootPos, rootNormal, tangent, randDir, allVerts, allTris, allNormals);
            stripCount++;
        }

        if (stripCount == 0) return;

        Debug.Log($"[HairGenerator] Generated {stripCount} hair strips, {allVerts.Count} verts, {allTris.Count / 3} tris");

        // Create mesh
        Mesh hairMesh = new Mesh();
        hairMesh.name = "HairStrips";
        if (allVerts.Count > 65535) hairMesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
        hairMesh.SetVertices(allVerts);
        hairMesh.SetNormals(allNormals);
        hairMesh.SetTriangles(allTris, 0);

        // Create GameObject
        GameObject hairObj = new GameObject("Hair_Strips");
        hairObj.transform.SetParent(faceMeshFilter.transform, false);
        hairObj.transform.localPosition = Vector3.zero;
        hairObj.transform.localRotation = Quaternion.identity;
        hairObj.transform.localScale = Vector3.one;

        var mf = hairObj.AddComponent<MeshFilter>();
        mf.mesh = hairMesh;

        var mr = hairObj.AddComponent<MeshRenderer>();
        Material mat = new Material(hairMaterial);
        mat.color = hairColor;
        // Double-sided rendering
        mat.SetFloat("_Cull", 0); // Off
        mr.material = mat;
        mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        mr.receiveShadows = false;

        hairObjects.Add(hairObj);
    }

    /// <summary>
    /// Generate one hair card strip: a chain of quads from root along direction.
    /// </summary>
    private void GenerateStrip(
        Vector3 rootPos, Vector3 normal, Vector3 tangent, Vector3 randOffset,
        List<Vector3> verts, List<int> tris, List<Vector3> norms)
    {
        float segLen = stripLength / stripSegments;
        Vector3 dir = normal; // Start direction = outward from head
        Vector3 halfWidth = tangent * (stripWidth * 0.5f);

        Vector3 pos = rootPos;

        // Bottom edge of first segment
        int baseIdx = verts.Count;

        // Add initial edge (2 vertices)
        verts.Add(pos - halfWidth);
        verts.Add(pos + halfWidth);
        norms.Add(normal);
        norms.Add(normal);

        for (int seg = 0; seg < stripSegments; seg++)
        {
            float t = (float)(seg + 1) / stripSegments;

            // Blend direction from normal toward gravity as strip extends
            Vector3 gravityDir = Vector3.down;
            dir = Vector3.Lerp(normal, gravityDir, gravity * t).normalized;

            // Add randomness
            dir = (dir + randOffset * t).normalized;

            // Advance position
            pos += dir * segLen;

            // Taper width slightly at the tip
            float taper = 1.0f - t * 0.3f;
            Vector3 hw = halfWidth * taper;

            // Top edge of segment (2 vertices)
            int idx = verts.Count;
            verts.Add(pos - hw);
            verts.Add(pos + hw);
            norms.Add(dir);
            norms.Add(dir);

            // Two triangles for this quad segment
            // Previous edge: idx-2, idx-1
            // Current edge:  idx, idx+1
            tris.Add(idx - 2); tris.Add(idx);     tris.Add(idx + 1);
            tris.Add(idx - 2); tris.Add(idx + 1); tris.Add(idx - 1);

            // Also add back-face triangles for visibility from both sides
            tris.Add(idx - 2); tris.Add(idx + 1); tris.Add(idx);
            tris.Add(idx - 2); tris.Add(idx - 1); tris.Add(idx + 1);
        }
    }

    /// <summary>
    /// Get a tangent vector perpendicular to the given normal.
    /// </summary>
    private Vector3 GetTangent(Vector3 normal)
    {
        // Choose a reference that isn't parallel to normal
        Vector3 reference = Mathf.Abs(Vector3.Dot(normal, Vector3.up)) < 0.9f
            ? Vector3.up
            : Vector3.right;
        return Vector3.Cross(normal, reference).normalized;
    }

    public void SetHairStyle(HairStyle style)
    {
        if (PRESETS.TryGetValue(style, out var p))
        {
            stripSegments = p.seg;
            stripLength = p.len;
            stripWidth = p.wid;
            gravity = p.grav;
            randomness = p.rand;
            vertexSkip = p.skip;
            normalZMax = p.nz;
            minY = p.my;
            GenerateHair();
            Debug.Log($"[HairGenerator] Applied style: {style}");
        }
    }

    public void SetHairStyleByName(string name)
    {
        switch (name.ToLower())
        {
            case "short": SetHairStyle(HairStyle.Short); break;
            case "medium": SetHairStyle(HairStyle.Medium); break;
            case "fluffy": SetHairStyle(HairStyle.Fluffy); break;
            default:
                Debug.LogWarning($"[HairGenerator] Unknown style: {name}");
                break;
        }
    }

    public void UpdateHairFromMesh()
    {
        hairMaterial = null;
        GenerateHair();
    }

    public void ClearHair()
    {
        foreach (var obj in hairObjects)
        {
            if (obj != null) Destroy(obj);
        }
        hairObjects.Clear();
    }

    void OnDestroy()
    {
        ClearHair();
        if (hairMaterial != null) Destroy(hairMaterial);
    }
}
