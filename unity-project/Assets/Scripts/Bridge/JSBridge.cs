using UnityEngine;

/// <summary>
/// JSBridge — Bidirectional communication between JavaScript (Web Shell) and Unity (WebGL)
/// 
/// Web Shell → Unity:
///   SendMessage('JSBridge', 'LoadFaceModel', json)
///   SendMessage('JSBridge', 'SetSurgeryParam', json)
///   SendMessage('JSBridge', 'ApplyPreset', presetName)
///   SendMessage('JSBridge', 'Undo')
///   SendMessage('JSBridge', 'CaptureScreenshot')
///
/// Unity → Web Shell:
///   CustomEvent('unity-message', {type, payload})
/// </summary>
public class JSBridge : MonoBehaviour
{
    public static JSBridge Instance { get; private set; }

    [Header("References")]
    public SceneSetup sceneSetup;
    public SurgeryController surgeryController;
    public ComparisonView comparisonView;

    void Awake()
    {
        Instance = this;
    }

    // === JS → Unity Methods ===

    /// <summary>
    /// Load face model: { uvUrl, meshUrl }
    /// </summary>
    public void LoadFaceModel(string json)
    {
        var data = JsonUtility.FromJson<FaceModelData>(json);
        if (data != null && sceneSetup != null)
        {
            sceneSetup.LoadFaceModel(data.uvUrl, data.meshUrl, data.shapedirsUrl);
            SendToJS("model-loaded", "{}");
        }
    }

    /// <summary>
    /// Update mesh with deformed OBJ text (from /api/deform).
    /// Keeps existing UV texture, only updates geometry.
    /// </summary>
    public void UpdateDeformedMesh(string objText)
    {
        if (sceneSetup != null)
        {
            sceneSetup.UpdateMeshFromOBJ(objText);
            SendToJS("deform-complete", "{}");
        }
    }

    /// <summary>
    /// Apply local deformation from FLAME shape params (no server needed).
    /// JSON: { "params": [0.5, -0.3, 1.2, ...] }
    /// </summary>
    public void ApplyLocalDeformation(string json)
    {
        if (sceneSetup != null)
        {
            sceneSetup.ApplyLocalDeformation(json);
            SendToJS("deform-complete", "{}");
        }
    }

    /// <summary>
    /// Apply direct vertex displacement (no PCA). Surgery params as named fields.
    /// JSON: { "noseBridgeHeight": 5.0, "jawWidth": -3.0, ... }
    /// </summary>
    public void ApplyDirectDeformation(string json)
    {
        if (sceneSetup != null)
        {
            sceneSetup.ApplyDirectDeformation(json);
            SendToJS("deform-complete", "{}");
        }
    }

    /// <summary>
    /// Apply region-isolated deformation from per-region FLAME shape params.
    /// JSON: { "nose": [...], "jaw": [...], "chin": [...], "eyes": [...], "lips": [...] }
    /// </summary>
    public void ApplyRegionDeformation(string json)
    {
        if (sceneSetup != null)
        {
            sceneSetup.ApplyRegionDeformation(json);
            SendToJS("deform-complete", "{}");
        }
    }

    /// <summary>
    /// Enable/disable face-only masking mode (skull/neck won't move).
    /// JSON: { "enabled": true }
    /// </summary>
    public void SetFaceOnlyMode(string json)
    {
        if (sceneSetup != null)
        {
            sceneSetup.SetFaceOnlyMode(json);
        }
    }

    /// <summary>
    /// Set hair style: "short", "medium", "fluffy"
    /// </summary>
    public void SetHairStyle(string styleName)
    {
        if (sceneSetup != null)
        {
            sceneSetup.SetHairStyle(styleName);
        }
    }

    /// <summary>
    /// Set skin color tint: { "r": 1.0, "g": 0.9, "b": 0.85 }
    /// Values near 1.0 preserve original texture, lower = darker/tinted
    /// </summary>
    public void SetSkinColor(string json)
    {
        if (sceneSetup != null)
        {
            var data = JsonUtility.FromJson<SkinColorData>(json);
            if (data != null)
            {
                sceneSetup.SetSkinColor(data.r, data.g, data.b);
            }
        }
    }

    /// <summary>
    /// Set FLAME shape params: { indices: [0,1,3], values: [1.2, 0.6, -0.8] }
    /// </summary>
    public void SetSurgeryParam(string json)
    {
        surgeryController?.SetParams(json);
    }

    /// <summary>
    /// Set base params from initial reconstruction
    /// </summary>
    public void SetBaseParams(string json)
    {
        surgeryController?.SetBaseParams(json);
    }

    /// <summary>
    /// Receive MediaPipe face landmarks for adaptive deformation targeting.
    /// JSON: { "noseTip": {x,y,z}, "noseBridge": {x,y,z}, ... }
    /// </summary>
    public void SetFaceLandmarks(string json)
    {
        if (sceneSetup != null)
        {
            sceneSetup.SetFaceLandmarks(json);
        }
    }

    /// <summary>
    /// Apply a named preset
    /// </summary>
    public void ApplyPreset(string presetName)
    {
        surgeryController?.ApplyPreset(presetName);
    }

    public void Undo()
    {
        surgeryController?.Undo();
    }

    public void Redo()
    {
        surgeryController?.Redo();
    }

    public void ResetAll()
    {
        surgeryController?.ResetAll();
    }

    public void ToggleComparison()
    {
        comparisonView?.Toggle();
    }

    /// <summary>
    /// Capture screenshot and send as base64 to JS
    /// </summary>
    public void CaptureScreenshot()
    {
        StartCoroutine(CaptureAndSend());
    }

    private System.Collections.IEnumerator CaptureAndSend()
    {
        yield return new WaitForEndOfFrame();

        var tex = new Texture2D(Screen.width, Screen.height, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, Screen.width, Screen.height), 0, 0);
        tex.Apply();

        byte[] bytes = tex.EncodeToPNG();
        string base64 = System.Convert.ToBase64String(bytes);
        Destroy(tex);

        SendToJS("screenshot", $"{{\"data\":\"data:image/png;base64,{base64}\"}}");
    }

    // === Unity → JS Methods ===

    private void SendToJS(string type, string payload)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        // Use ExternalEval for WebGL JS communication
        string escapedPayload = payload.Replace("\\", "\\\\").Replace("'", "\\'");
        Application.ExternalEval(
            $"window.dispatchEvent(new CustomEvent('unity-message', " +
            $"{{ detail: {{ type: '{type}', payload: '{escapedPayload}' }} }}));");
#else
        Debug.Log($"[JSBridge] → JS: type={type}, payload={payload}");
#endif
    }

    // Data classes
    [System.Serializable]
    private class FaceModelData
    {
        public string uvUrl;
        public string meshUrl;
        public string shapedirsUrl;
    }

    [System.Serializable]
    private class SkinColorData
    {
        public float r = 1f;
        public float g = 1f;
        public float b = 1f;
    }
}
