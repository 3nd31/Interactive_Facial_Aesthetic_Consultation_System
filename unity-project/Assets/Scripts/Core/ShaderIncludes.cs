using UnityEngine;

/// <summary>
/// ShaderIncludes — Forces shaders to be included in WebGL builds.
/// Shader.Find() at runtime only works if the shader is already in the build.
/// Having a Material reference to the shader forces Unity to include it.
/// Attach this to any GameObject in your scene (e.g. the SceneSetup object).
/// </summary>
public class ShaderIncludes : MonoBehaviour
{
    [Header("Drag materials here to force-include their shaders in builds")]
    public Material[] requiredMaterials;

    // This script doesn't need to do anything at runtime.
    // Its sole purpose is to hold references so Unity includes the shaders.
}
