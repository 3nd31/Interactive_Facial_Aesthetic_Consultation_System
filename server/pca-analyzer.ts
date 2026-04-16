/**
 * PCA Analyzer — Automatically map FLAME PCA components to facial regions
 * 
 * For each PCA component (0-49):
 *   1. Call /api/deform with shape[i] = base[i] + delta
 *   2. Compare vertices against base mesh
 *   3. Classify displacement by spatial region (nose, jaw, eye, lip, forehead, cheek)
 *   4. Output mapping: { region → [sorted list of most impactful components] }
 * 
 * Usage: npx tsx pca-analyzer.ts [jobId]
 */

import * as fs from 'fs';
import * as path from 'path';

// Use dirname from the script location
const __dirname = path.dirname(process.argv[1]);

const GPU_URL = 'http://jp-tyo-bgp-1.ofalias.net:60136';
const LOCAL_URL = 'http://localhost:3001';
const JOBS_DIR = path.join(__dirname, 'jobs');
const DELTA = 2.0; // PCA perturbation magnitude
const NUM_COMPONENTS = 50; // Test first 50 components (most impactful)

// Facial region bounding boxes (approximate, in FLAME coordinate space)
// FLAME model is roughly centered at origin, face forward along -Z
interface BBox {
    name: string;
    xMin: number; xMax: number;
    yMin: number; yMax: number;
    zMin: number; zMax: number;
}

const REGIONS: BBox[] = [
    // Model bounds: X[-0.1,0.1] Y[-0.18,0.13] Z[-0.15,0.07]
    // Face faces -Z direction, Y up, X right

    // Nose: center of face, protruding forward (most negative Z)
    { name: 'nose', xMin: -0.03, xMax: 0.03, yMin: -0.06, yMax: 0.00, zMin: -0.16, zMax: -0.10 },
    // Jaw/chin: lower face, wide
    { name: 'jaw', xMin: -0.08, xMax: 0.08, yMin: -0.18, yMax: -0.06, zMin: -0.15, zMax: 0.08 },
    // Left eye (positive X in FLAME = left from model's perspective)
    { name: 'eye_left', xMin: 0.02, xMax: 0.06, yMin: 0.00, yMax: 0.04, zMin: -0.14, zMax: -0.06 },
    // Right eye
    { name: 'eye_right', xMin: -0.06, xMax: -0.02, yMin: 0.00, yMax: 0.04, zMin: -0.14, zMax: -0.06 },
    // Lips/mouth: center, below nose
    { name: 'lips', xMin: -0.03, xMax: 0.03, yMin: -0.10, yMax: -0.04, zMin: -0.16, zMax: -0.08 },
    // Forehead: upper face
    { name: 'forehead', xMin: -0.06, xMax: 0.06, yMin: 0.04, yMax: 0.13, zMin: -0.14, zMax: 0.0 },
    // Cheeks: sides of face
    { name: 'cheeks', xMin: -0.10, xMax: 0.10, yMin: -0.05, yMax: 0.04, zMin: -0.12, zMax: 0.0 },
];

interface Vertex {
    x: number; y: number; z: number;
}

function parseOBJVertices(objText: string): Vertex[] {
    const verts: Vertex[] = [];
    for (const line of objText.split('\n')) {
        if (line.startsWith('v ')) {
            const parts = line.trim().split(/\s+/);
            verts.push({
                x: parseFloat(parts[1]),
                y: parseFloat(parts[2]),
                z: parseFloat(parts[3]),
            });
        }
    }
    return verts;
}

function classifyVertex(v: Vertex): string[] {
    const regions: string[] = [];
    for (const r of REGIONS) {
        if (v.x >= r.xMin && v.x <= r.xMax &&
            v.y >= r.yMin && v.y <= r.yMax &&
            v.z >= r.zMin && v.z <= r.zMax) {
            regions.push(r.name);
        }
    }
    return regions.length > 0 ? regions : ['other'];
}

function computeDisplacement(base: Vertex[], deformed: Vertex[]): Map<string, number> {
    const regionDisp = new Map<string, number>();
    const regionCount = new Map<string, number>();

    for (const r of REGIONS) {
        regionDisp.set(r.name, 0);
        regionCount.set(r.name, 0);
    }
    regionDisp.set('total', 0);

    const count = Math.min(base.length, deformed.length);
    for (let i = 0; i < count; i++) {
        const dx = deformed[i].x - base[i].x;
        const dy = deformed[i].y - base[i].y;
        const dz = deformed[i].z - base[i].z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        regionDisp.set('total', (regionDisp.get('total') || 0) + dist);

        const regions = classifyVertex(base[i]);
        for (const r of regions) {
            regionDisp.set(r, (regionDisp.get(r) || 0) + dist);
            regionCount.set(r, (regionCount.get(r) || 0) + 1);
        }
    }

    // Normalize by count to get average displacement per vertex in region
    for (const [name, totalDisp] of regionDisp) {
        const cnt = regionCount.get(name) || 1;
        if (name !== 'total') {
            regionDisp.set(name, totalDisp / cnt);
        }
    }

    return regionDisp;
}

async function callDeform(shape: number[]): Promise<string> {
    const res = await fetch(`${LOCAL_URL}/api/deform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shape }),
    });
    if (!res.ok) throw new Error(`Deform failed: ${res.status}`);
    return res.text();
}

async function main() {
    const jobId = process.argv[2] || '5ff71766';
    const paramsPath = path.join(JOBS_DIR, jobId, 'params.json');

    if (!fs.existsSync(paramsPath)) {
        console.error(`No params.json found for job ${jobId}`);
        process.exit(1);
    }

    const params = JSON.parse(fs.readFileSync(paramsPath, 'utf-8'));
    const baseShape: number[] = params.shape;

    console.log(`[PCA Analyzer] Job: ${jobId}, Shape dims: ${baseShape.length}`);
    console.log(`[PCA Analyzer] Testing ${NUM_COMPONENTS} components with delta=${DELTA}\n`);

    // 1. Get base mesh
    console.log('Getting base mesh...');
    const baseOBJ = await callDeform(baseShape);
    const baseVerts = parseOBJVertices(baseOBJ);
    console.log(`Base mesh: ${baseVerts.length} vertices\n`);

    // Print vertex spatial bounds for calibrating region boxes
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of baseVerts) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
    console.log(`Vertex bounds: X[${minX.toFixed(4)}, ${maxX.toFixed(4)}] Y[${minY.toFixed(4)}, ${maxY.toFixed(4)}] Z[${minZ.toFixed(4)}, ${maxZ.toFixed(4)}]\n`);

    // 2. Test each component
    interface ComponentResult {
        index: number;
        regions: Map<string, number>;
        totalDisp: number;
        topRegion: string;
    }

    const results: ComponentResult[] = [];

    for (let i = 0; i < NUM_COMPONENTS; i++) {
        const modShape = [...baseShape];
        modShape[i] = baseShape[i] + DELTA;

        try {
            const deformedOBJ = await callDeform(modShape);
            const deformedVerts = parseOBJVertices(deformedOBJ);
            const displacement = computeDisplacement(baseVerts, deformedVerts);

            const totalDisp = displacement.get('total') || 0;

            // Find top affected region
            let topRegion = 'global';
            let topDisp = 0;
            for (const [name, disp] of displacement) {
                if (name !== 'total' && disp > topDisp) {
                    topDisp = disp;
                    topRegion = name;
                }
            }

            results.push({ index: i, regions: displacement, totalDisp, topRegion });

            const regionStr = [...displacement.entries()]
                .filter(([n]) => n !== 'total')
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([n, d]) => `${n}:${(d * 1000).toFixed(2)}`)
                .join(' ');

            console.log(`PC${i.toString().padStart(2)}: total=${totalDisp.toFixed(4)} top=${topRegion.padEnd(10)} | ${regionStr}`);
        } catch (err) {
            console.error(`PC${i}: FAILED - ${err}`);
        }
    }

    // 3. Generate mapping
    console.log('\n=== REGION → TOP COMPONENTS ===\n');

    const regionMapping: Record<string, { index: number; displacement: number }[]> = {};

    for (const r of REGIONS) {
        const sorted = results
            .filter(c => (c.regions.get(r.name) || 0) > 0.0001) // threshold
            .sort((a, b) => (b.regions.get(r.name) || 0) - (a.regions.get(r.name) || 0))
            .slice(0, 8);

        regionMapping[r.name] = sorted.map(c => ({
            index: c.index,
            displacement: c.regions.get(r.name) || 0,
        }));

        console.log(`${r.name}:`);
        for (const s of sorted) {
            console.log(`  PC${s.index}: ${((s.regions.get(r.name) || 0) * 1000).toFixed(3)}mm`);
        }
    }

    // 4. Generate surgery param mapping
    // For each surgery param, pick the top region match and best components
    const surgeryMapping = {
        noseBridgeHeight: regionMapping['nose']?.slice(0, 3).map(c => c.index) || [],
        noseBridgeWidth: regionMapping['nose']?.slice(0, 3).map(c => c.index) || [],
        noseWingWidth: regionMapping['nose']?.slice(3, 6).map(c => c.index) || [],
        noseTipAngle: regionMapping['nose']?.slice(0, 3).map(c => c.index) || [],
        jawWidth: regionMapping['jaw']?.slice(0, 3).map(c => c.index) || [],
        jawAngle: regionMapping['jaw']?.slice(3, 6).map(c => c.index) || [],
        chinLength: regionMapping['jaw']?.slice(0, 2).map(c => c.index) || [],
        chinProjection: regionMapping['jaw']?.slice(2, 4).map(c => c.index) || [],
        eyeLidWidth: [...(regionMapping['eye_left']?.slice(0, 2).map(c => c.index) || []),
        ...(regionMapping['eye_right']?.slice(0, 2).map(c => c.index) || [])],
        eyeCorner: [...(regionMapping['eye_left']?.slice(2, 4).map(c => c.index) || []),
        ...(regionMapping['eye_right']?.slice(2, 4).map(c => c.index) || [])],
        lipVolume: regionMapping['lips']?.slice(0, 3).map(c => c.index) || [],
        lipArch: regionMapping['lips']?.slice(3, 6).map(c => c.index) || [],
    };

    // Save results
    const outputPath = path.join(__dirname, 'pca-mapping.json');
    const output = {
        generatedAt: new Date().toISOString(),
        jobId,
        delta: DELTA,
        vertexBounds: { minX, maxX, minY, maxY, minZ, maxZ },
        regionMapping,
        surgeryMapping,
    };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n✅ Saved to ${outputPath}`);
}

main().catch(console.error);
