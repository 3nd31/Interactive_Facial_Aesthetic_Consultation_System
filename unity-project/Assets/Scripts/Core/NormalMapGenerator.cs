using UnityEngine;

/// <summary>
/// Generates a normal map from an albedo (color) texture using Sobel gradient.
/// Applied to the face material for surface detail (pores, wrinkles)
/// without increasing polygon count.
/// </summary>
public class NormalMapGenerator : MonoBehaviour
{
    /// <summary>
    /// Generate a normal map from an albedo texture using Sobel-based height estimation.
    /// The luminance of the albedo is treated as a height field.
    /// </summary>
    public static Texture2D GenerateFromAlbedo(Texture2D albedo, float strength = 2.0f)
    {
        int w = albedo.width;
        int h = albedo.height;

        // Get luminance as height
        Color[] srcPixels = albedo.GetPixels();
        float[] heights = new float[w * h];
        for (int i = 0; i < srcPixels.Length; i++)
        {
            Color c = srcPixels[i];
            // Luminance (perceptual weighting)
            heights[i] = c.r * 0.299f + c.g * 0.587f + c.b * 0.114f;
        }

        // Sobel gradients → normal
        Color[] normalPixels = new Color[w * h];

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                // Sample 3×3 neighborhood (clamped)
                float tl = GetHeight(heights, w, h, x - 1, y - 1);
                float t  = GetHeight(heights, w, h, x,     y - 1);
                float tr = GetHeight(heights, w, h, x + 1, y - 1);
                float l  = GetHeight(heights, w, h, x - 1, y);
                float r  = GetHeight(heights, w, h, x + 1, y);
                float bl = GetHeight(heights, w, h, x - 1, y + 1);
                float b  = GetHeight(heights, w, h, x,     y + 1);
                float br = GetHeight(heights, w, h, x + 1, y + 1);

                // Sobel X gradient
                float dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
                // Sobel Y gradient
                float dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

                // Normal vector (pointing up in tangent space)
                Vector3 normal = new Vector3(-dx * strength, -dy * strength, 1.0f).normalized;

                // Pack to [0,1] range for texture storage
                normalPixels[y * w + x] = new Color(
                    normal.x * 0.5f + 0.5f,
                    normal.y * 0.5f + 0.5f,
                    normal.z * 0.5f + 0.5f,
                    1.0f
                );
            }
        }

        Texture2D normalMap = new Texture2D(w, h, TextureFormat.RGBA32, true);
        normalMap.SetPixels(normalPixels);
        normalMap.Apply();
        normalMap.filterMode = FilterMode.Trilinear;
        normalMap.anisoLevel = 4;

        return normalMap;
    }

    private static float GetHeight(float[] heights, int w, int h, int x, int y)
    {
        x = Mathf.Clamp(x, 0, w - 1);
        y = Mathf.Clamp(y, 0, h - 1);
        return heights[y * w + x];
    }
}
