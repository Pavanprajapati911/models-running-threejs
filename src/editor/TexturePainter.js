import * as THREE from "three";

export class TexturePainter {
    constructor(chunkManager) {
        this.chunkManager = chunkManager;
    }

    /**
     * Paints on the terrain at a given world position.
     * @param {THREE.Vector3} worldPos 
     * @param {number} radius 
     * @param {number} strength 
     * @param {number} layerIndex (0 to 3)
     */
    paint(worldPos, radius, strength, layerIndex) {
        const chunks = this._getAffectedChunks(worldPos, radius);
        
        chunks.forEach(chunk => {
            this._paintOnChunk(chunk, worldPos, radius, strength, layerIndex);
        });
    }

    _getAffectedChunks(worldPos, radius) {
        const affected = [];
        const cs = this.chunkManager.chunkSize;
        
        // Calculate range of chunk coordinates
        const minX = Math.round((worldPos.x - radius) / cs);
        const maxX = Math.round((worldPos.x + radius) / cs);
        const minZ = Math.round((worldPos.z - radius) / cs);
        const maxZ = Math.round((worldPos.z + radius) / cs);

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = `${x},${z}`;
                const chunk = this.chunkManager.chunks.get(key);
                if (chunk && chunk.initialized) {
                    affected.push(chunk);
                }
            }
        }
        return affected;
    }

    _paintOnChunk(chunk, worldPos, radius, strength, layerIndex) {
        const res = chunk.splatRes;
        const data = chunk.splatData;
        const chunkSize = this.chunkManager.chunkSize;
        
        // Chunk center in world space
        const cx = chunk.x;
        const cz = chunk.z;

        const r2 = radius * radius;

        let modified = false;

        for (let i = 0; i < res * res; i++) {
            const px = i % res;
            const pz = Math.floor(i / res);

            // Local UV to World Position
            const u = px / (res - 1);
            // Flip V coordinate calculation to match Three.js UV (0,0) at MaxZ
            const v = 1.0 - (pz / (res - 1));
            
            const pointWorldX = cx + (u - 0.5) * chunkSize;
            const pointWorldZ = cz + (v - 0.5) * chunkSize;

            const dx = pointWorldX - worldPos.x;
            const dz = pointWorldZ - worldPos.z;
            const d2 = dx * dx + dz * dz;

            if (d2 < r2) {
                const dist = Math.sqrt(d2);
                // Radial falloff (smoothstep)
                const falloff = 1.0 - THREE.MathUtils.smoothstep(dist, 0, radius);
                const amount = falloff * strength;

                const i4 = i * 4;
                
                // Current weights
                let r = data[i4 + 0] / 255;
                let g = data[i4 + 1] / 255;
                let b = data[i4 + 2] / 255;
                let a = data[i4 + 3] / 255;

                // Apply paint to target layer
                if (layerIndex === 0) r += amount;
                else if (layerIndex === 1) g += amount;
                else if (layerIndex === 2) b += amount;
                else if (layerIndex === 3) a += amount;

                // Clamp the target layer, then normalize others
                r = Math.min(1.0, r);
                g = Math.min(1.0, g);
                b = Math.min(1.0, b);
                a = Math.min(1.0, a);

                // Simple but effective normalization:
                // Ensure target layer takes precedence, and reduce others proportionally
                const currentChannel = layerIndex === 0 ? r : layerIndex === 1 ? g : layerIndex === 2 ? b : a;
                const remaining = 1.0 - currentChannel;
                const otherSum = (layerIndex === 0 ? (g + b + a) : layerIndex === 1 ? (r + b + a) : layerIndex === 2 ? (r + g + a) : (r + g + b)) || 1.0;
                
                if (layerIndex !== 0) r = (r / otherSum) * remaining;
                if (layerIndex !== 1) g = (g / otherSum) * remaining;
                if (layerIndex !== 2) b = (b / otherSum) * remaining;
                if (layerIndex !== 3) a = (a / otherSum) * remaining;
                
                // Set the designated channel
                if (layerIndex === 0) r = currentChannel;
                else if (layerIndex === 1) g = currentChannel;
                else if (layerIndex === 2) b = currentChannel;
                else if (layerIndex === 3) a = currentChannel;

                const nr = Math.floor(r * 255);
                const ng = Math.floor(g * 255);
                const nb = Math.floor(b * 255);
                const na = Math.floor(a * 255);

                if (data[i4+0] !== nr || data[i4+1] !== ng || data[i4+2] !== nb || data[i4+3] !== na) {
                    data[i4 + 0] = nr;
                    data[i4 + 1] = ng;
                    data[i4 + 2] = nb;
                    data[i4 + 3] = na;
                    modified = true;
                }
            }
        }

        if (modified) {
            chunk.isSplatModified = true;
            chunk.splatTexture.needsUpdate = true;
        }
    }
}
