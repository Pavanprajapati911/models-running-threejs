varying vec2 vUv;
varying float vVaryingColor;
varying float vVariation;

uniform float uTime;
uniform float uWindSpeed;
uniform float uWindStrength;

// Interaction Uniforms
uniform vec3 uPlayerPos;
uniform float uInteractionRadius;
uniform float uInteractionStrength;

// Per-instance data: x = timeOffset, y = variation, z = lean, w = tilt
attribute vec4 aInstanceData;

void main() {
    vUv = uv;
    vVariation = aInstanceData.y;
    
    // 0. WORLD POSITION CALC
    // 🔥 FIX: Must multiply by modelMatrix to get world-space position of the patch
    vec4 worldInstancePos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    
    // 1. ORGANIC SILHOUETTE (Narrow base, Leaf middle, Pointy tip)
    vec3 pos = position;
    float tipTaper = 1.0 - uv.y;
    float baseNarrow = smoothstep(0.0, 0.3, uv.y) * 0.8 + 0.2;
    pos.x *= tipTaper * baseNarrow;
    
    // Width variation per clump
    pos.x *= 0.8 + aInstanceData.y * 0.4;
    
    // 2. GROWTH CURVE (Persistent bend)
    float growthCurve = pow(uv.y, 2.0) * 0.5;
    pos.x += growthCurve * (aInstanceData.y - 0.5); // Curve slightly left/right based on variation
    pos.z += growthCurve * (aInstanceData.z);
    
    // 3. BENDING PHYSICS (Non-linear stiffness)
    float bending = pow(uv.y, 2.5);
    
    // 4. WIND CALCULATION
    float timeOffset = aInstanceData.x;
    float wind = sin(uTime * uWindSpeed + timeOffset + (worldInstancePos.x * 0.2)) * uWindStrength;
    wind += sin(uTime * uWindSpeed * 2.0 + timeOffset) * uWindStrength * 0.3;
    
    // 5. LEAN AND TILT
    float lean = aInstanceData.z * bending;
    float tilt = aInstanceData.w * bending;
    
    // 6. PLAYER INTERACTION (BENDING AWAY)
    float dist = distance(worldInstancePos.xz, uPlayerPos.xz);
    float interaction = 1.0 - smoothstep(0.0, uInteractionRadius, dist);
    interaction *= uInteractionStrength;
    vec2 dir = normalize(worldInstancePos.xz - uPlayerPos.xz + 0.0001);
    
    pos.x += dir.x * interaction * uv.y * 1.5;
    pos.z += dir.y * interaction * uv.y * 1.5;

    // Combine all displacements
    pos.x += (wind + tilt) * bending;
    pos.z += (wind * 0.5 + lean) * bending;
    
    // Standard transformation
    // Note: instanceMatrix and position are already in patch-local space
    // gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
    // Which is the same as:
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    vVaryingColor = uv.y;
}
