using UnityEngine;

/// <summary>
/// ComparisonView — Before/After comparison for surgery simulation.
/// Supports split-screen and slider overlay modes.
/// </summary>
public class ComparisonView : MonoBehaviour
{
    [Header("References")]
    public Camera mainCamera;
    public MeshFilter originalMeshFilter;  // Before surgery
    public MeshFilter modifiedMeshFilter;  // After surgery

    [Header("Settings")]
    public bool isActive = false;
    public float splitPosition = 0.5f; // 0-1, position of comparison divider

    public enum CompareMode { SplitScreen, SliderOverlay }
    public CompareMode mode = CompareMode.SliderOverlay;

    private Vector3[] originalVertices;
    private Material originalMaterial;
    private Material modifiedMaterial;

    /// <summary>
    /// Capture original state before surgery modifications
    /// </summary>
    public void CaptureOriginal()
    {
        if (originalMeshFilter != null && originalMeshFilter.mesh != null)
        {
            originalVertices = originalMeshFilter.mesh.vertices;
            Debug.Log($"[Compare] Captured original: {originalVertices.Length} vertices");
        }
    }

    /// <summary>
    /// Toggle comparison mode
    /// </summary>
    public void Toggle()
    {
        isActive = !isActive;
        ApplyComparison();
    }

    /// <summary>
    /// Set split position (0-1)
    /// </summary>
    public void SetSplitPosition(float position)
    {
        splitPosition = Mathf.Clamp01(position);
        if (isActive) ApplyComparison();
    }

    private void ApplyComparison()
    {
        if (!isActive)
        {
            // Show only modified mesh
            if (originalMeshFilter != null) originalMeshFilter.gameObject.SetActive(false);
            if (modifiedMeshFilter != null) modifiedMeshFilter.gameObject.SetActive(true);
            return;
        }

        if (mode == CompareMode.SplitScreen)
        {
            // Both visible, camera renders split
            if (originalMeshFilter != null) originalMeshFilter.gameObject.SetActive(true);
            if (modifiedMeshFilter != null) modifiedMeshFilter.gameObject.SetActive(true);
        }
    }

    void Update()
    {
        if (!isActive) return;

        // Sync camera between views for split-screen mode
        // Handle slider dragging for overlay mode
        if (Input.GetMouseButton(0) && mode == CompareMode.SliderOverlay)
        {
            splitPosition = Input.mousePosition.x / Screen.width;
        }
    }
}
