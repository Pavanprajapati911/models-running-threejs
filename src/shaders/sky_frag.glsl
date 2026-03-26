uniform vec3 uSunPosition;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;

varying vec3 vWorldPosition;

void main() {
    float height = normalize(vWorldPosition).y;
    float sunHeight = normalize(uSunPosition).y;
    
    // Gradient based on height
    float gradient = smoothstep(-0.1, 0.4, height);
    vec3 skyColor = mix(uHorizonColor, uZenithColor, gradient);
    
    // Atmospheric tint based on sun position (sunset/sunrise effect)
    float horizonTint = smoothstep(0.3, -0.3, sunHeight);
    vec3 sunsetColor = vec3(1.0, 0.4, 0.1);
    skyColor = mix(skyColor, sunsetColor, horizonTint * (1.0 - gradient) * 0.8);

    gl_FragColor = vec4(skyColor, 1.0);
}
