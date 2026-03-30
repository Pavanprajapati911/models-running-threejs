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
    
    // 1. TAPER GEOMETRY
    vec3 pos = position;
    pos.x *= mix(1.0, 0.1, uv.y);
    
    // 2. BENDING LOGIC (Non-linear stiffness)
    float bending = pow(uv.y, 2.5);
    
    // 3. WIND CALCULATION
    float timeOffset = aInstanceData.x;
    float wind = sin(uTime * uWindSpeed + timeOffset + (worldInstancePos.x * 0.2)) * uWindStrength;
    wind += sin(uTime * uWindSpeed * 2.0 + timeOffset) * uWindStrength * 0.3;
    
    // 4. LEAN AND TILT
    float lean = aInstanceData.z * bending;
    float tilt = aInstanceData.w * bending;
    
    // 5. PLAYER INTERACTION (BENDING AWAY)
    // Distance check in XZ plane
    float dist = distance(worldInstancePos.xz, uPlayerPos.xz);
    
    // Influence falloff
    float interaction = 1.0 - smoothstep(0.0, uInteractionRadius, dist);
    interaction *= uInteractionStrength;
    
    // Direction away from player (with epsilon to avoid NaN)
    vec2 dir = normalize(worldInstancePos.xz - uPlayerPos.xz + 0.0001);
    
    // Apply interaction displacement
    // Only applied to top (uv.y) and added to existing wind/lean
    pos.x += dir.x * interaction * uv.y;
    pos.z += dir.y * interaction * uv.y;

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
