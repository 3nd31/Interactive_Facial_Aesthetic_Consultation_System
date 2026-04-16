using UnityEngine;

/// <summary>
/// Orbit camera with mouse + touch + gesture support
/// </summary>
public class OrbitCamera : MonoBehaviour
{
    [Header("Target")]
    public Vector3 target = Vector3.zero;

    [Header("Orbit")]
    public float distance = 2f;
    public float minDistance = 0.5f;
    public float maxDistance = 10f;
    public float rotateSpeed = 5f;
    public float zoomSpeed = 2f;
    public float panSpeed = 0.5f;

    [Header("Damping")]
    public float dampingFactor = 0.92f;
    public float autoRotateSpeed = 0f;

    [Header("Limits")]
    public float minPolarAngle = 10f;
    public float maxPolarAngle = 170f;

    private float azimuth = 0f;
    private float polar = 80f;
    private float velocityAzimuth = 0f;
    private float velocityPolar = 0f;

    private Vector2 lastMousePos;
    private bool isDragging;
    private bool isPanning;

    // Touch state
    private float lastPinchDist;

    void Start()
    {
        UpdateCameraPosition();
    }

    void Update()
    {
        HandleMouseInput();
        HandleTouchInput();

        // Inertia damping
        velocityAzimuth *= dampingFactor;
        velocityPolar *= dampingFactor;

        if (!isDragging)
        {
            azimuth += velocityAzimuth;
            polar += velocityPolar;
            azimuth += autoRotateSpeed * Time.deltaTime;
        }

        // Clamp polar angle
        polar = Mathf.Clamp(polar, minPolarAngle, maxPolarAngle);

        UpdateCameraPosition();
    }

    private void HandleMouseInput()
    {
        // Right-click drag: rotate
        if (Input.GetMouseButtonDown(1))
        {
            isDragging = true;
            lastMousePos = Input.mousePosition;
        }
        if (Input.GetMouseButtonUp(1))
        {
            isDragging = false;
        }

        // Middle-click drag: pan
        if (Input.GetMouseButtonDown(2))
        {
            isPanning = true;
            lastMousePos = Input.mousePosition;
        }
        if (Input.GetMouseButtonUp(2))
        {
            isPanning = false;
        }

        if (isDragging)
        {
            Vector2 delta = (Vector2)Input.mousePosition - lastMousePos;
            lastMousePos = Input.mousePosition;

            float dAzimuth = delta.x * rotateSpeed * 0.1f;
            float dPolar = delta.y * rotateSpeed * 0.1f;

            azimuth += dAzimuth;
            polar += dPolar;
            velocityAzimuth = dAzimuth;
            velocityPolar = dPolar;
        }

        if (isPanning)
        {
            Vector2 delta = (Vector2)Input.mousePosition - lastMousePos;
            lastMousePos = Input.mousePosition;

            Vector3 right = transform.right;
            Vector3 up = transform.up;
            target -= (right * delta.x + up * delta.y) * panSpeed * 0.001f * distance;
        }

        // Scroll zoom
        float scroll = Input.mouseScrollDelta.y;
        if (Mathf.Abs(scroll) > 0.01f)
        {
            distance -= scroll * zoomSpeed * 0.1f * distance;
            distance = Mathf.Clamp(distance, minDistance, maxDistance);
        }
    }

    private void HandleTouchInput()
    {
        int touchCount = Input.touchCount;

        if (touchCount == 1)
        {
            var touch = Input.GetTouch(0);
            if (touch.phase == TouchPhase.Moved)
            {
                // Single finger: rotate
                float dAzimuth = touch.deltaPosition.x * rotateSpeed * 0.05f;
                float dPolar = -touch.deltaPosition.y * rotateSpeed * 0.05f;
                azimuth += dAzimuth;
                polar += dPolar;
            }
        }
        else if (touchCount == 2)
        {
            var t0 = Input.GetTouch(0);
            var t1 = Input.GetTouch(1);

            // Pinch zoom
            float dist = Vector2.Distance(t0.position, t1.position);
            if (t0.phase == TouchPhase.Began || t1.phase == TouchPhase.Began)
            {
                lastPinchDist = dist;
            }
            else if (t0.phase == TouchPhase.Moved || t1.phase == TouchPhase.Moved)
            {
                float delta = dist - lastPinchDist;
                distance -= delta * zoomSpeed * 0.005f;
                distance = Mathf.Clamp(distance, minDistance, maxDistance);
                lastPinchDist = dist;

                // Two-finger rotate
                Vector2 avgDelta = (t0.deltaPosition + t1.deltaPosition) * 0.5f;
                azimuth -= avgDelta.x * rotateSpeed * 0.03f;
                polar += avgDelta.y * rotateSpeed * 0.03f;
            }
        }
        else if (touchCount == 3)
        {
            // Three-finger pan
            var avgDelta = Vector2.zero;
            for (int i = 0; i < 3; i++)
                avgDelta += Input.GetTouch(i).deltaPosition;
            avgDelta /= 3f;

            Vector3 right = transform.right;
            Vector3 up = transform.up;
            target -= (right * avgDelta.x + up * avgDelta.y) * panSpeed * 0.001f * distance;
        }
    }

    private void UpdateCameraPosition()
    {
        float azRad = azimuth * Mathf.Deg2Rad;
        float polRad = polar * Mathf.Deg2Rad;

        Vector3 offset = new Vector3(
            distance * Mathf.Sin(polRad) * Mathf.Cos(azRad),
            distance * Mathf.Cos(polRad),
            distance * Mathf.Sin(polRad) * Mathf.Sin(azRad)
        );

        transform.position = target + offset;
        transform.LookAt(target);
    }

    /// <summary>
    /// Focus camera on a point
    /// </summary>
    public void FocusOn(Vector3 point, float dist = -1)
    {
        target = point;
        if (dist > 0) distance = dist;
    }
}
