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

// ---------------- NOISE ----------------

float hash(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) +
           (c - a) * u.y * (1.0 - u.x) +
           (d - b) * u.x * u.y;
}

float fbm(vec2 p){
    float v = 0.0;
    float a = 0.5;

    // OPTIMIZED: Reduced from 5 to 3 octaves. 
    // This saves 40% of GPU cycles for the heavy procedural terrain shader.
    for(int i = 0; i < 3; i++){
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// ---------------- MAIN ----------------

void main(){

    vec3 normal = normalize(vNormal);
    vec2 worldXZ = vWorldPos.xz + uGlobalSeed;

    // ---------------- BIOME ----------------
    float biome = fbm(worldXZ * 0.01);

    // ---------------- MUD ROADS ----------------
    float pathNoise = fbm(worldXZ * 0.02);
    float path = smoothstep(0.45, 0.55, pathNoise);

    // Make paths more organic
    path *= smoothstep(-1.0, 1.5, -vElevation);

    // ---------------- DIRT ----------------
    float dirt = fbm(worldXZ * 0.08);
    dirt = smoothstep(0.5, 0.7, dirt);

    // Combine dirt + path
    float dirtMask = max(dirt, path);

    // ---------------- COLORS ----------------
    vec3 deepGreen = vec3(0.08,0.18,0.04);
    vec3 freshGreen = vec3(0.2,0.35,0.08);
    vec3 dry = vec3(0.45,0.42,0.18);

    vec3 mudDark = vec3(0.15,0.1,0.05);
    vec3 mudLight = vec3(0.3,0.22,0.15);

    vec3 grass = mix(freshGreen, deepGreen, biome);
    grass = mix(grass, dry, biome * 0.6);

    vec3 dirtCol = mix(mudDark, mudLight, fbm(worldXZ * 0.2));

    // Dead grass transition
    vec3 deadGrass = vec3(0.35,0.3,0.15);
    grass = mix(grass, deadGrass, dirtMask * 0.5);

    // ---------------- FOLIAGE DENSITY ----------------

    float cluster = fbm(worldXZ * 0.15);
    cluster = smoothstep(0.4, 0.8, cluster);

    float blades = noise(worldXZ * vec2(6.0, 24.0));
    blades = smoothstep(0.5, 0.7, blades);

    float density = cluster * blades;

    grass *= mix(0.7, 1.3, density);

    // Remove grass on paths
    grass *= (1.0 - path);

    // ---------------- FINAL BLEND ----------------

    vec3 color = mix(grass, dirtCol, dirtMask);

    // ---------------- LIGHTING ----------------

    vec3 lightDir = normalize(uLightDir);
    float diff = max(dot(normal, lightDir), 0.0);

    vec3 ambient = vec3(0.25,0.3,0.35) * 0.5;

    vec3 finalColor = color * (diff * uLightColor + ambient);

    // Wet mud specular
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);

    finalColor += spec * 0.15 * path;

    // ---------------- FOG ----------------

    float dist = distance(uCameraPos, vWorldPos);
    float fogFactor = smoothstep(uFogNear, uFogFar, dist);

    finalColor = mix(finalColor, uFogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
}