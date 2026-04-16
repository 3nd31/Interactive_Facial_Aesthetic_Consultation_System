using UnityEngine;
using UnityEngine.Networking;
using System.Collections;
using System.Collections.Generic;

/// <summary>
/// SurgeryController — Maps semantic surgery operations to FLAME shape parameters.
/// Sends deform requests to GPU server and updates mesh in real-time.
/// 
/// Flow: User drags slider → SetParam() → POST /api/deform (22ms) → update mesh vertices
/// </summary>
public class SurgeryController : MonoBehaviour
{
    [Header("Server")]
    public string serverUrl = "http://localhost:3001";

    [Header("References")]
    public MeshFilter targetMeshFilter;

    // FLAME 200-dim shape parameters
    private float[] shapeParams = new float[200];
    private float[] baseShapeParams = new float[200];

    // Undo/redo
    private List<float[]> undoStack = new List<float[]>();
    private List<float[]> redoStack = new List<float[]>();
    private const int MaxUndo = 50;

    // Deform throttle
    private float lastDeformTime = 0;
    private const float DeformCooldown = 0.03f; // 30ms min between requests
    private bool deformPending = false;

    /// <summary>
    /// Set a FLAME shape parameter to an absolute value.
    /// </summary>
    public void SetParam(int index, float value)
    {
        if (index < 0 || index >= 200) return;
        shapeParams[index] = value;
        RequestDeform();
    }

    /// <summary>
    /// Add a delta to a FLAME shape parameter (for gesture sculpting).
    /// </summary>
    public void AddParam(int index, float delta)
    {
        if (index < 0 || index >= 200) return;
        shapeParams[index] += delta;
        RequestDeform();
    }

    /// <summary>
    /// Set multiple parameters at once (e.g., from preset)
    /// </summary>
    public void SetParams(string json)
    {
        var data = JsonUtility.FromJson<ParamBatch>(json);
        if (data != null && data.indices != null)
        {
            PushUndo();
            for (int i = 0; i < data.indices.Length && i < data.values.Length; i++)
            {
                int idx = data.indices[i];
                if (idx >= 0 && idx < 200)
                    shapeParams[idx] = data.values[i];
            }
            RequestDeform();
        }
    }

    /// <summary>
    /// Set base parameters from initial face reconstruction
    /// </summary>
    public void SetBaseParams(string json)
    {
        var data = JsonUtility.FromJson<FloatArray>(json);
        if (data?.data != null && data.data.Length == 200)
        {
            System.Array.Copy(data.data, baseShapeParams, 200);
            System.Array.Copy(data.data, shapeParams, 200);
        }
    }

    /// <summary>
    /// Apply a surgery preset by name
    /// </summary>
    public void ApplyPreset(string presetName)
    {
        PushUndo();
        // Reset to base first
        System.Array.Copy(baseShapeParams, shapeParams, 200);

        switch (presetName)
        {
            case "korean-nose":
                shapeParams[0] += 1.2f * 0.8f; shapeParams[5] += 1.2f * 0.3f; // bridge
                shapeParams[1] += 0.6f * 0.6f; shapeParams[12] += 0.6f * 0.4f; // tip
                shapeParams[3] += -0.8f * 0.7f; shapeParams[8] += -0.8f * 0.3f; // width
                break;
            case "v-line":
                shapeParams[4] += -1.5f * 0.9f; // jaw width
                shapeParams[9] += 1.0f * 0.6f; // jaw sharpness
                shapeParams[13] += -0.8f * 0.6f; // chin width
                break;
            case "baby-face":
                shapeParams[17] += 0.8f * 0.6f; // cheek fullness
                shapeParams[10] += -0.5f * 0.8f; // chin length
                shapeParams[4] += -0.6f * 0.9f; // jaw width
                shapeParams[23] += 0.7f * 0.6f; // eye size
                break;
        }

        RequestDeform();
    }

    /// <summary>
    /// Reset all parameters to base values
    /// </summary>
    public void ResetAll()
    {
        PushUndo();
        System.Array.Copy(baseShapeParams, shapeParams, 200);
        RequestDeform();
    }

    public void Undo()
    {
        if (undoStack.Count == 0) return;
        redoStack.Add((float[])shapeParams.Clone());
        shapeParams = undoStack[undoStack.Count - 1];
        undoStack.RemoveAt(undoStack.Count - 1);
        RequestDeform();
    }

    public void Redo()
    {
        if (redoStack.Count == 0) return;
        undoStack.Add((float[])shapeParams.Clone());
        shapeParams = redoStack[redoStack.Count - 1];
        redoStack.RemoveAt(redoStack.Count - 1);
        RequestDeform();
    }

    private void PushUndo()
    {
        undoStack.Add((float[])shapeParams.Clone());
        if (undoStack.Count > MaxUndo) undoStack.RemoveAt(0);
        redoStack.Clear();
    }

    private void RequestDeform()
    {
        if (Time.time - lastDeformTime < DeformCooldown)
        {
            deformPending = true;
            return;
        }
        StartCoroutine(SendDeformRequest());
    }

    void Update()
    {
        if (deformPending && Time.time - lastDeformTime >= DeformCooldown)
        {
            deformPending = false;
            StartCoroutine(SendDeformRequest());
        }
    }

    private IEnumerator SendDeformRequest()
    {
        lastDeformTime = Time.time;

        string json = "{\"shape_params\":[" + string.Join(",", shapeParams) + "]}";
        byte[] bodyRaw = System.Text.Encoding.UTF8.GetBytes(json);

        using (var req = new UnityWebRequest($"{serverUrl}/api/deform", "POST"))
        {
            req.uploadHandler = new UploadHandlerRaw(bodyRaw);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");

            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.Success)
            {
                var result = JsonUtility.FromJson<DeformResult>(req.downloadHandler.text);
                if (result?.vertices != null && targetMeshFilter?.mesh != null)
                {
                    ApplyVertices(result.vertices);
                    Debug.Log($"[Surgery] Deform OK: {result.inference_time_ms}ms");
                }
            }
            else
            {
                Debug.LogWarning($"[Surgery] Deform failed: {req.error}");
            }
        }
    }

    private void ApplyVertices(float[] verts)
    {
        var mesh = targetMeshFilter.mesh;
        var vertices = new Vector3[verts.Length / 3];
        for (int i = 0; i < vertices.Length; i++)
        {
            vertices[i] = new Vector3(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
        }
        mesh.vertices = vertices;
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
    }

    [System.Serializable]
    private class FloatArray { public float[] data; }
    [System.Serializable]
    private class ParamBatch { public int[] indices; public float[] values; }
    [System.Serializable]
    private class DeformResult { public float[] vertices; public float inference_time_ms; }
}
