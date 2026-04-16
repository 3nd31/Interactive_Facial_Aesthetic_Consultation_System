using UnityEngine;

/// <summary>
/// GestureSculptor — Maps mouse/touch drag on face mesh to FLAME shape param changes.
/// 
/// "Hand tracking failure" workaround: instead of tracking hand position,
/// we use the hand interaction keywords (push/pull/drag) to modify face shape.
/// 
/// Interaction modes:
///   - Left drag on face = Push/Pull (adjust primary params of hit region)
///   - Shift + Left drag = Smooth (gentler adjustment)
///   - Right drag = Orbit camera (handled by OrbitCamera)
/// </summary>
public class GestureSculptor : MonoBehaviour
{
    [Header("References")]
    public Camera mainCamera;
    public SurgeryController surgeryController;
    public MeshFilter targetMeshFilter;

    [Header("Settings")]
    public float sensitivity = 2.0f;
    public float smoothSensitivity = 0.3f;
    public LayerMask faceMask = ~0;

    private bool isDragging = false;
    private Vector3 lastMousePos;
    private string hitRegion = "";

    // Face region detection based on UV/vertex position
    // Maps mesh vertex height to surgery region
    private static readonly (float minH, float maxH, string region)[] REGION_MAP = {
        (0.5f, 1.0f, "forehead"),
        (0.2f, 0.5f, "eye"),
        (-0.1f, 0.2f, "nose"),
        (-0.1f, 0.1f, "cheek"),
        (-0.3f, -0.1f, "lip"),
        (-0.6f, -0.3f, "jaw"),
        (-1.0f, -0.6f, "chin"),
    };

    // Region → FLAME shape param indices (primary axis)
    // These are the same indices used in SurgeryController
    private static readonly System.Collections.Generic.Dictionary<string, int[]> REGION_PARAMS = new()
    {
        { "nose", new[] { 0, 1, 3, 2 } },      // bridge, tip, width, length
        { "jaw", new[] { 4, 7, 9 } },           // width, angle, sharpness
        { "chin", new[] { 10, 11, 13 } },       // length, protrusion, width
        { "cheek", new[] { 14, 16, 17 } },      // height, width, fullness
        { "forehead", new[] { 19, 21 } },        // height, width
        { "eye", new[] { 23, 24, 26 } },         // size, spacing, tilt
        { "lip", new[] { 27, 29, 31 } },         // fullness, width, bow
    };

    void Update()
    {
        if (Input.GetMouseButtonDown(0) && !Input.GetKey(KeyCode.LeftAlt))
        {
            TryStartSculpt(Input.mousePosition);
        }

        if (isDragging && Input.GetMouseButton(0))
        {
            Vector3 delta = Input.mousePosition - lastMousePos;
            PerformSculpt(delta);
            lastMousePos = Input.mousePosition;
        }

        if (Input.GetMouseButtonUp(0))
        {
            isDragging = false;
        }
    }

    private void TryStartSculpt(Vector3 screenPos)
    {
        if (mainCamera == null || targetMeshFilter == null) return;

        Ray ray = mainCamera.ScreenPointToRay(screenPos);
        RaycastHit hit;

        if (Physics.Raycast(ray, out hit, 100f, faceMask))
        {
            if (hit.collider.gameObject == targetMeshFilter.gameObject)
            {
                isDragging = true;
                lastMousePos = screenPos;
                hitRegion = DetectRegion(hit.point);
                Debug.Log($"[Sculptor] Start sculpt: {hitRegion}");
            }
        }
    }

    private string DetectRegion(Vector3 hitPoint)
    {
        // Convert hit point to local space, use Y for region detection
        Vector3 local = targetMeshFilter.transform.InverseTransformPoint(hitPoint);
        float normalizedH = local.y / 0.12f; // Normalize based on head height

        foreach (var (minH, maxH, region) in REGION_MAP)
        {
            if (normalizedH >= minH && normalizedH < maxH)
                return region;
        }
        return "nose"; // default
    }

    private void PerformSculpt(Vector3 screenDelta)
    {
        if (surgeryController == null || string.IsNullOrEmpty(hitRegion)) return;
        if (!REGION_PARAMS.ContainsKey(hitRegion)) return;

        int[] paramIndices = REGION_PARAMS[hitRegion];
        bool smooth = Input.GetKey(KeyCode.LeftShift);
        float sens = smooth ? smoothSensitivity : sensitivity;

        // Normalize screen delta
        float dx = screenDelta.x / Screen.width * sens;
        float dy = screenDelta.y / Screen.height * sens;

        // Map drag to param changes (ADDITIVE)
        // Vertical drag → primary param (height/length/size)
        // Horizontal drag → secondary param (width/spacing)
        if (paramIndices.Length > 0)
            surgeryController.AddParam(paramIndices[0], dy * 5f);

        if (paramIndices.Length > 2)
            surgeryController.AddParam(paramIndices[2], dx * 5f);
    }
}
