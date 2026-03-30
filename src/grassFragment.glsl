varying vec2 vUv;
varying float vVaryingColor;
varying float vVariation;

uniform vec3 uBaseColor;
uniform vec3 uTipColor;

void main() {
    // 1. IMPROVED GREEN GRADIENT
    // Dark forest green at root, bright lime green at tip
    vec3 baseColor = uBaseColor; // Root (from uniform)
    vec3 tipColor = uTipColor;   // Tip (from uniform)
    
    // 2. PER-INSTANCE COLOR VARIATION
    // Blend with a secondary color based on vVariation attribute
    vec3 variColor = tipColor * 1.2; // Slightly brighter or yellower variation
    tipColor = mix(tipColor, variColor, vVariation * 0.3);
    
    // Mix bottom to top
    vec3 finalColor = mix(baseColor, tipColor, vVaryingColor);
    
    // 3. ADD DEPTH COLORING
    // Slightly darker inside (fake AO based on uv.x)
    float edgeDarkening = smoothstep(0.0, 0.4, abs(vUv.x - 0.5));
    finalColor *= mix(1.0, 0.8, edgeDarkening);
    
    gl_FragColor = vec4(finalColor, 1.0);
}
