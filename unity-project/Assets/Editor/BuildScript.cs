using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
using System.Collections.Generic;
using System.IO;

public class BuildScript
{
    [MenuItem("Build/WebGL Dev")]
    public static void BuildWebGLDev()
    {
        string outputPath = Path.GetFullPath(
            Path.Combine(Application.dataPath, "../../app/public/unity-build"));

        Debug.Log("[BuildScript] Building WebGL to: " + outputPath);

        var scenes = new List<string>();
        foreach (var s in EditorBuildSettings.scenes)
        {
            if (s.enabled) scenes.Add(s.path);
        }

        var options = new BuildPlayerOptions
        {
            scenes = scenes.ToArray(),
            locationPathName = outputPath,
            target = BuildTarget.WebGL,
            options = BuildOptions.Development
        };

        var report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result == BuildResult.Succeeded)
        {
            Debug.Log("[BuildScript] Build succeeded: " + report.summary.totalSize + " bytes");
        }
        else
        {
            Debug.LogError("[BuildScript] Build failed: " + report.summary.result);
            EditorApplication.Exit(1);
        }
    }
}
