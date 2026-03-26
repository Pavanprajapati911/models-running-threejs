precision mediump float;

varying float vRandom;
varying float vElevation;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;

uniform sampler2D grassTex;
uniform sampler2D dirtTex;
uniform sampler2D rockTex;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uCameraPos;

uniform float uTextureScale;
uniform float uLightingIntensity;
uniform float uSpecularStrength;

uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;


void main() {
  vec3 normal = normalize(vNormal);

  // ---------------- TEXTURE BLENDING ----------------

  vec2 uvScaled = vUv * uTextureScale;

  vec3 grass = texture2D(grassTex, uvScaled).rgb;
  vec3 dirt = texture2D(dirtTex, uvScaled).rgb;
  vec3 rock = texture2D(rockTex, uvScaled).rgb;

  // ---------------- SLOPE & BIOME BLENDING ----------------
  
  // 1. Detect slope (normal.y)
  float slope = 1.0 - normal.y;
  float rockSlopeFactor = smoothstep(0.3, 0.7, slope);

  // 2. Height-based zones (World scale)
  // Sea level: -2.0, Snow line: ~15.0 (large scale)
  float beachFactor = smoothstep(-2.2, -1.0, vWorldPos.y);
  float forestFactor = smoothstep(-1.0, 8.0, vWorldPos.y);
  float snowFactor = smoothstep(12.0, 18.0, vWorldPos.y);

  // 3. Biome coloring (approximate from textures or height)
  // We'll use the existing textures but blend them based on slope and height
  vec3 baseColor = dirt;
  baseColor = mix(baseColor, grass, forestFactor);
  
  // Apply rock to steep slopes regardless of height (except maybe underwater)
  baseColor = mix(baseColor, rock, rockSlopeFactor * beachFactor);
  
  // Snow cap
  baseColor = mix(baseColor, vec3(0.95, 0.95, 1.0), snowFactor);

  // ---------------- UNDERWATER TINT ----------------
  if (vWorldPos.y < -2.0) {
      baseColor = mix(baseColor, vec3(0.0, 0.2, 0.4), 0.6);
  }





  // ---------------- LIGHTING ----------------

  vec3 lightDir = normalize(uLightDir);


  // Diffuse (sun light)
  float diff = max(dot(normal, lightDir), 0.0);

  // Specular (sun reflection)
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  vec3 halfDir = normalize(lightDir + viewDir);

  float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);

  // ---------------- FINAL COLOR ----------------

  vec3 finalColor = (baseColor * diff * uLightColor * uLightingIntensity);

  // add ambient light
  vec3 ambient = baseColor * 0.2;

  // add specular highlight (Blinn-Phong)
  vec3 specular = spec * vec3(1.0) * uSpecularStrength;

  vec3 colorWithLight = finalColor + ambient + specular;

  // ---------------- FOG ----------------
  float dist = length(uCameraPos - vWorldPos);
  float fogFactor = smoothstep(uFogNear, uFogFar, dist);
  vec3 finalFogColor = mix(colorWithLight, uFogColor, fogFactor);

  gl_FragColor = vec4(finalFogColor, 1.0);
}
 