Shader "FaceVR/SeamBlendLit"
{
    Properties
    {
        _MainTex ("Albedo", 2D) = "white" {}
        _Color ("Color Tint", Color) = (1,1,1,1)
        _Smoothness ("Smoothness", Range(0,1)) = 0.3
        _SeamBlend ("Seam Blend Strength", Range(0,1)) = 0.85
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 200

        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows vertex:vert
        #pragma target 3.0

        sampler2D _MainTex;
        fixed4 _Color;
        half _Smoothness;
        half _SeamBlend;

        struct Input
        {
            float2 uv_MainTex;
            fixed4 vertColor;
        };

        void vert(inout appdata_full v, out Input o)
        {
            UNITY_INITIALIZE_OUTPUT(Input, o);
            o.vertColor = v.color;
        }

        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            fixed4 tex = tex2D(_MainTex, IN.uv_MainTex) * _Color;

            // Blend texture with vertex color at UV seam vertices
            // vertColor.a = 1.0 for seam verts, 0.0 for non-seam
            float seamMask = IN.vertColor.a * _SeamBlend;
            fixed3 blended = lerp(tex.rgb, IN.vertColor.rgb, seamMask);

            o.Albedo = blended;
            o.Smoothness = _Smoothness;
            o.Alpha = 1.0;
        }
        ENDCG
    }
    FallBack "Standard"
}
