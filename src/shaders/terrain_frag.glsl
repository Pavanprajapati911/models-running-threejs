precision highp float;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vElevation;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uCameraPos;

uniform float uTime;
uniform float uGlobalSeed;

uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

// ---------------- TEXTURES ----------------
// We support up to 4 layers mapped to RGBA of uSplatMap
uniform sampler2D uSplatMap;
uniform sampler2D uLayer0; 
uniform sampler2D uLayer1;
uniform sampler2D uLayer2;
uniform sampler2D uLayer3;

uniform float uLayer0Scale;
uniform float uLayer1Scale;
uniform float uLayer2Scale;
uniform float uLayer3Scale;

// ---------------- NOISE ----------------

float hash(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p){
    float v = 0.0;
    float a = 0.5;
    for(int i = 0; i < 3; i++){
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main(){
    vec3 normal = normalize(vNormal);
    vec2 worldXZ = vWorldPos.xz + uGlobalSeed;

    // Sample Splat Map (using per-chunk 0-1 UVs)
    vec4 weights = texture2D(uSplatMap, vUv);
    
    // Normalize weights to ensure they sum to 1.0
    float totalWeight = weights.r + weights.g + weights.b + weights.a;
    if (totalWeight > 0.0) {
        weights /= totalWeight;
    } else {
        weights = vec4(1.0, 0.0, 0.0, 0.0); // Fallback to Layer 0
    }

    // ---------------- PROCEDURAL TINTS ----------------
    float biome = fbm(worldXZ * 0.01);
    vec3 deepGreen = vec3(0.08,0.18,0.04);
    vec3 freshGreen = vec3(0.2,0.35,0.08);
    vec3 forestTint = mix(freshGreen, deepGreen, biome);

    vec3 mudDark = vec3(0.15,0.1,0.05);
    vec3 mudLight = vec3(0.3,0.22,0.15);
    vec3 mudTint = mix(mudDark, mudLight, fbm(worldXZ * 0.2));

    // Sample Textures
    vec3 col0 = texture2D(uLayer0, worldXZ * uLayer0Scale).rgb * forestTint * 2.0;
    vec3 col1 = texture2D(uLayer1, worldXZ * uLayer1Scale).rgb * mudTint * 2.5;
    vec3 col2 = texture2D(uLayer2, worldXZ * uLayer2Scale).rgb; 
    vec3 col3 = texture2D(uLayer3, worldXZ * uLayer3Scale).rgb;

    // Final Blended Color
    vec3 color = col0 * weights.r + col1 * weights.g + col2 * weights.b + col3 * weights.a;

    // ---------------- LIGHTING ----------------
    vec3 lightDir = normalize(uLightDir);
    float diff = max(dot(normal, lightDir), 0.0);

    vec3 ambient = vec3(0.25,0.3,0.35) * 0.5;
    vec3 finalColor = color * (diff * uLightColor + ambient);

    // Mud specular (only on Mud layer influence)
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
    finalColor += spec * 0.15 * weights.g; 

    // ---------------- FOG ----------------
    float dist = distance(uCameraPos, vWorldPos);
    float fogFactor = smoothstep(uFogNear, uFogFar, dist);
    finalColor = mix(finalColor, uFogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
}