"use strict";
/**
 * Image-to-Map Converter for HOI4 (Tier 2)
 * 
 * Pipeline:
 * 1. Load reference image (PNG/JPG/BMP)
 * 2. Quantize colors → detect distinct regions
 * 3. Label connected components → each becomes a province
 * 4. Assign unique RGB colors per province
 * 5. Detect sea (blue-ish regions) vs land
 * 6. Detect coastal provinces (land adjacent to sea)
 * 7. Generate: provinces.bmp, definition.csv, state files, strategic regions
 * 8. Auto-group provinces into states (configurable size)
 * 9. Return preview + stats
 */

const fs = require('fs');
const path = require('path');

let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = null; }

// ─── Color Utilities ────────────────────────────────────────────────────────────

function colorDistance(r1, g1, b1, r2, g2, b2) {
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function isBlueish(r, g, b) {
    return b > 100 && b > r * 1.3 && b > g * 1.1;
}

function isWhiteish(r, g, b) {
    return r > 220 && g > 220 && b > 220;
}

function isBlackish(r, g, b) {
    return r < 30 && g < 30 && b < 30;
}

/**
 * Classify terrain based on average color of province pixels.
 * Maps common map colors to HOI4 terrain types.
 */
function classifyTerrain(r, g, b) {
    // Sea/water already handled separately
    const brightness = (r + g + b) / 3;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);

    // White/very light → arctic/snow
    if (brightness > 210 && saturation < 40) return 'arctic';
    // Very dark gray → wasteland (volcanic, barren)
    if (brightness < 50 && saturation < 30) return 'mountain';

    // Yellow/tan/sandy → desert
    if (r > 160 && g > 130 && b < 100 && r > b * 1.5) return 'desert';
    // Brown/dark brown → hills
    if (r > 100 && r < 180 && g > 60 && g < 140 && b < 80 && r > g) return 'hills';
    // Dark green → forest
    if (g > 80 && g > r && g > b && brightness < 140) return 'forest';
    // Bright/medium green → plains
    if (g > r && g > b && brightness >= 140) return 'plains';
    // Very dark green with high saturation → jungle
    if (g > 60 && g > r * 1.1 && brightness < 100) return 'jungle';
    // Olive/gray-green → marsh
    if (g > r * 0.9 && g < r * 1.2 && b < g && brightness < 130 && saturation < 60) return 'marsh';
    // Gray → mountain
    if (saturation < 30 && brightness > 80 && brightness < 180) return 'mountain';
    // Red/dark red → urban
    if (r > 150 && r > g * 1.4 && r > b * 1.4) return 'urban';

    // Default
    return 'plains';
}

/**
 * Detect separate continents via flood-fill on land provinces.
 * Returns: map of provinceId → continentId (1-based)
 */
function detectContinents(provinces, labels, width, height) {
    const landSet = new Set(provinces.filter(p => p.type === 'land').map(p => p.id));
    const provContinent = new Map();
    let continentId = 0;

    // Build province adjacency from pixel grid
    const adj = new Map();
    for (const p of provinces) adj.set(p.id, new Set());
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width - 1; x++) {
            const a = labels[y * width + x], b = labels[y * width + x + 1];
            if (a > 0 && b > 0 && a !== b) { adj.get(a)?.add(b); adj.get(b)?.add(a); }
        }
    }
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width; x++) {
            const a = labels[y * width + x], b = labels[(y + 1) * width + x];
            if (a > 0 && b > 0 && a !== b) { adj.get(a)?.add(b); adj.get(b)?.add(a); }
        }
    }

    // Flood-fill each unvisited land province
    for (const p of provinces) {
        if (p.type !== 'land' || provContinent.has(p.id)) continue;
        continentId++;
        const queue = [p.id];
        provContinent.set(p.id, continentId);
        while (queue.length > 0) {
            const cur = queue.shift();
            for (const nid of (adj.get(cur) || [])) {
                if (landSet.has(nid) && !provContinent.has(nid)) {
                    provContinent.set(nid, continentId);
                    queue.push(nid);
                }
            }
        }
    }

    return { provContinent, totalContinents: continentId, adj };
}

/**
 * Generate heightmap: luminosity from source image, elevated for mountains/hills.
 */
function generateHeightmapData(pixels, labels, provinces, width, height) {
    const heightmap = new Uint8Array(width * height);
    const provMap = new Map(provinces.map(p => [p.id, p]));

    for (let i = 0; i < width * height; i++) {
        const pid = labels[i];
        const prov = provMap.get(pid);
        const off = i * 3;
        // Base: luminosity of source pixel
        let h = Math.round(0.299 * pixels[off] + 0.587 * pixels[off + 1] + 0.114 * pixels[off + 2]);

        if (prov) {
            if (prov.type === 'sea') { h = Math.min(h, 20); } // Sea is low
            else {
                // Terrain-based elevation adjustments
                switch (prov.terrain) {
                    case 'mountain': h = Math.min(255, h + 80); break;
                    case 'hills': h = Math.min(255, h + 40); break;
                    case 'desert': h = Math.max(40, Math.min(h, 120)); break;
                    case 'plains': h = Math.max(30, Math.min(h, 100)); break;
                    case 'marsh': h = Math.max(20, Math.min(h, 50)); break;
                    default: h = Math.max(25, Math.min(h, 150));
                }
            }
        } else {
            h = 0; // Border pixels
        }
        heightmap[i] = h;
    }
    return heightmap;
}

/**
 * Generate positions.txt content for all provinces.
 * Each province needs: unit, city, building, text positions + rotation + height.
 */
function generatePositionsTxt(provinces, heightmap, width, height) {
    const lines = [];
    for (const p of provinces) {
        const cx = p.center.x;
        const cy = p.center.y;
        const h = heightmap ? heightmap[cy * width + cx] / 25.5 : 0; // Normalize to ~0-10
        // Slightly offset each position type so they don't overlap
        const ux = cx, uy = cy;                     // unit
        const ccx = cx + 1, ccy = cy + 1;           // city
        const bx = cx - 1, by = cy + 1;             // building
        const tx = cx, ty = cy - 2;                  // text

        lines.push(`${p.id} = {`);
        lines.push(`\tposition = { ${ux}.000 ${h.toFixed(3)} ${uy}.000 ${ccx}.000 ${h.toFixed(3)} ${ccy}.000 ${bx}.000 ${h.toFixed(3)} ${by}.000 ${tx}.000 ${h.toFixed(3)} ${ty}.000 }`);
        lines.push(`\trotation = { 0.000 0.000 0.000 0.000 }`);
        lines.push(`\theight = { ${h.toFixed(3)} ${h.toFixed(3)} ${h.toFixed(3)} ${h.toFixed(3)} }`);
        lines.push(`}`);
    }
    return lines.join('\n') + '\n';
}

/**
 * Generate supply network: place hubs at largest province in each state, connect with railways.
 */
function generateSupplyNetwork(states, provinces, adj) {
    const provMap = new Map(provinces.map(p => [p.id, p]));
    const hubs = []; // {level, provinceId}
    const railways = []; // {level, provinces: [id, id, ...]}

    // Place hub at largest province in each state
    for (const state of states) {
        if (state.provinces.length === 0) continue;
        let bestProv = state.provinces[0], bestSize = 0;
        for (const pid of state.provinces) {
            const p = provMap.get(pid);
            if (p && p.pixelCount > bestSize) { bestSize = p.pixelCount; bestProv = pid; }
        }
        hubs.push({ level: 1, province: bestProv });
    }

    // Connect adjacent state hubs with railways
    const hubSet = new Set(hubs.map(h => h.province));
    const stateOfProv = new Map();
    for (const state of states) {
        for (const pid of state.provinces) stateOfProv.set(pid, state.id);
    }

    // Find inter-state adjacencies and create railway paths
    const connectedStates = new Set();
    for (const hub of hubs) {
        const hubStateId = stateOfProv.get(hub.province);
        // BFS from hub to find nearest other hub
        const visited = new Set([hub.province]);
        const queue = [[hub.province]]; // paths
        while (queue.length > 0) {
            const path = queue.shift();
            const cur = path[path.length - 1];
            for (const nid of (adj.get(cur) || [])) {
                if (visited.has(nid)) continue;
                visited.add(nid);
                const p = provMap.get(nid);
                if (!p || p.type !== 'land') continue;
                const newPath = [...path, nid];
                if (hubSet.has(nid) && stateOfProv.get(nid) !== hubStateId) {
                    const key = [hubStateId, stateOfProv.get(nid)].sort().join('-');
                    if (!connectedStates.has(key)) {
                        connectedStates.add(key);
                        railways.push({ level: 1, provinces: newPath });
                    }
                    continue;
                }
                if (newPath.length < 15) queue.push(newPath); // Limit BFS depth
            }
        }
    }

    return { hubs, railways };
}

/**
 * Detect straits: narrow sea gaps between coastal provinces on different landmasses.
 */
function detectAdjacencies(provinces, labels, width, height, provContinent) {
    const adjacencies = [];
    const coastalLand = provinces.filter(p => p.type === 'land' && p.coastal);
    const seaSet = new Set(provinces.filter(p => p.type === 'sea').map(p => p.id));

    // For each pair of coastal provinces on different continents, check if they're 
    // close across a sea gap (within ~10 pixels)
    const checked = new Set();
    for (const a of coastalLand) {
        for (const b of coastalLand) {
            if (a.id >= b.id) continue;
            const ca = provContinent.get(a.id), cb = provContinent.get(b.id);
            if (ca === cb) continue; // Same continent

            const key = `${a.id}-${b.id}`;
            if (checked.has(key)) continue;
            checked.add(key);

            // Check pixel distance between closest points
            const dx = a.center.x - b.center.x;
            const dy = a.center.y - b.center.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < Math.max(width, height) * 0.08) { // Within ~8% of map size
                // Find a sea province between them as the "through" province
                const mx = Math.round((a.center.x + b.center.x) / 2);
                const my = Math.round((a.center.y + b.center.y) / 2);
                let throughProv = -1;
                for (let r = 0; r < 10; r++) {
                    for (let dy2 = -r; dy2 <= r; dy2++) {
                        for (let dx2 = -r; dx2 <= r; dx2++) {
                            const px = mx + dx2, py = my + dy2;
                            if (px >= 0 && px < width && py >= 0 && py < height) {
                                const pid = labels[py * width + px];
                                if (pid > 0 && seaSet.has(pid)) { throughProv = pid; break; }
                            }
                        }
                        if (throughProv > 0) break;
                    }
                    if (throughProv > 0) break;
                }

                if (throughProv > 0) {
                    adjacencies.push({
                        from: a.id, to: b.id, type: 'sea',
                        through: throughProv,
                        start: { x: a.center.x, y: a.center.y },
                        stop: { x: b.center.x, y: b.center.y },
                        comment: `Strait: continent ${ca} to ${cb}`
                    });
                }
            }
        }
    }
    return adjacencies;
}

/** Generate a unique province color that won't collide */
function generateProvinceColor(id) {
    // Use a hash-like distribution to spread colors across RGB space
    // Avoid very dark, very bright, and pure blue (sea confusion)
    const r = ((id * 137 + 43) % 200) + 30;
    const g = ((id * 89 + 17) % 200) + 30;
    const b = ((id * 53 + 71) % 180) + 30;
    return { r: r & 0xFF, g: g & 0xFF, b: b & 0xFF };
}

// ─── Connected Component Labeling ───────────────────────────────────────────────

/**
 * Union-Find for efficient connected component labeling
 */
class UnionFind {
    constructor(n) {
        this.parent = new Int32Array(n);
        this.rank = new Int32Array(n);
        for (let i = 0; i < n; i++) this.parent[i] = i;
    }
    find(x) {
        while (this.parent[x] !== x) {
            this.parent[x] = this.parent[this.parent[x]]; // path compression
            x = this.parent[x];
        }
        return x;
    }
    union(a, b) {
        const ra = this.find(a), rb = this.find(b);
        if (ra === rb) return;
        if (this.rank[ra] < this.rank[rb]) { this.parent[ra] = rb; }
        else if (this.rank[ra] > this.rank[rb]) { this.parent[rb] = ra; }
        else { this.parent[rb] = ra; this.rank[ra]++; }
    }
}

/**
 * Two-pass connected component labeling on quantized image
 * Returns: labels array (same size as image), component count
 */
function labelComponents(pixels, width, height, colorThreshold) {
    const n = width * height;
    const labels = new Int32Array(n);
    const uf = new UnionFind(n);
    labels.fill(-1);

    // First pass: assign provisional labels and record equivalences
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const off = idx * 3;
            const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];

            // Skip border pixels (black lines)
            if (isBlackish(r, g, b)) { labels[idx] = -1; continue; }

            // Check neighbors (left, above)
            let merged = false;
            // Left
            if (x > 0) {
                const leftIdx = y * width + (x - 1);
                if (labels[leftIdx] >= 0) {
                    const lo = leftIdx * 3;
                    if (colorDistance(r, g, b, pixels[lo], pixels[lo + 1], pixels[lo + 2]) < colorThreshold) {
                        labels[idx] = labels[leftIdx];
                        merged = true;
                    }
                }
            }
            // Above
            if (y > 0) {
                const upIdx = (y - 1) * width + x;
                if (labels[upIdx] >= 0) {
                    const uo = upIdx * 3;
                    if (colorDistance(r, g, b, pixels[uo], pixels[uo + 1], pixels[uo + 2]) < colorThreshold) {
                        if (merged) {
                            uf.union(labels[idx], labels[upIdx]);
                        } else {
                            labels[idx] = labels[upIdx];
                            merged = true;
                        }
                    }
                }
            }

            if (!merged) {
                labels[idx] = idx; // new component
            }
        }
    }

    // Second pass: flatten labels
    const rootMap = new Map();
    let nextId = 1; // Province IDs start at 1
    for (let i = 0; i < n; i++) {
        if (labels[i] < 0) continue;
        const root = uf.find(labels[i]);
        if (!rootMap.has(root)) {
            rootMap.set(root, nextId++);
        }
        labels[i] = rootMap.get(root);
    }

    return { labels, provinceCount: nextId - 1 };
}

// ─── Province Classification ────────────────────────────────────────────────────

function classifyProvinces(pixels, labels, width, height, provinceCount) {
    const provinces = [];
    // Accumulate per-province stats
    const stats = new Array(provinceCount + 1).fill(null).map(() => ({
        pixelCount: 0, sumR: 0, sumG: 0, sumB: 0,
        minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
        sumX: 0, sumY: 0
    }));

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const pid = labels[idx];
            if (pid <= 0) continue;
            const off = idx * 3;
            const s = stats[pid];
            s.pixelCount++;
            s.sumR += pixels[off];
            s.sumG += pixels[off + 1];
            s.sumB += pixels[off + 2];
            s.minX = Math.min(s.minX, x);
            s.minY = Math.min(s.minY, y);
            s.maxX = Math.max(s.maxX, x);
            s.maxY = Math.max(s.maxY, y);
            s.sumX += x;
            s.sumY += y;
        }
    }

    for (let id = 1; id <= provinceCount; id++) {
        const s = stats[id];
        if (s.pixelCount === 0) continue;
        const avgR = Math.round(s.sumR / s.pixelCount);
        const avgG = Math.round(s.sumG / s.pixelCount);
        const avgB = Math.round(s.sumB / s.pixelCount);
        const isSea = isBlueish(avgR, avgG, avgB);
        const terrain = isSea ? 'ocean' : classifyTerrain(avgR, avgG, avgB);
        const color = generateProvinceColor(id);

        provinces.push({
            id,
            type: isSea ? 'sea' : 'land',
            terrain,
            coastal: false, // set later
            continent: isSea ? 0 : 1, // updated later by detectContinents
            color,
            avgColor: { r: avgR, g: avgG, b: avgB },
            pixelCount: s.pixelCount,
            center: { x: Math.round(s.sumX / s.pixelCount), y: Math.round(s.sumY / s.pixelCount) },
            bounds: { minX: s.minX, minY: s.minY, maxX: s.maxX, maxY: s.maxY }
        });
    }

    // Detect coastal: land province within 3 pixels of sea province (across borders)
    const seaSet = new Set(provinces.filter(p => p.type === 'sea').map(p => p.id));
    const coastalSet = new Set();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pid = labels[y * width + x];
            if (pid <= 0 || seaSet.has(pid) || coastalSet.has(pid)) continue;
            // Check neighbors within radius 3 to bridge across border pixels
            let found = false;
            for (let dy = -3; dy <= 3 && !found; dy++) {
                for (let dx = -3; dx <= 3 && !found; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    const nid = labels[ny * width + nx];
                    if (nid > 0 && seaSet.has(nid)) {
                        coastalSet.add(pid);
                        found = true;
                    }
                }
            }
        }
    }
    for (const p of provinces) {
        if (coastalSet.has(p.id)) p.coastal = true;
    }

    return provinces;
}

// ─── State Grouping ─────────────────────────────────────────────────────────────

/**
 * Group land provinces into states using spatial proximity
 */
function groupIntoStates(provinces, labels, width, height, provincesPerState) {
    const landProvs = provinces.filter(p => p.type === 'land');
    if (landProvs.length === 0) return [];

    // Build adjacency graph
    const adj = new Map();
    for (const p of landProvs) adj.set(p.id, new Set());

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width - 1; x++) {
            const a = labels[y * width + x], b = labels[y * width + x + 1];
            if (a > 0 && b > 0 && a !== b && adj.has(a) && adj.has(b)) {
                adj.get(a).add(b);
                adj.get(b).add(a);
            }
        }
    }
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width; x++) {
            const a = labels[y * width + x], b = labels[(y + 1) * width + x];
            if (a > 0 && b > 0 && a !== b && adj.has(a) && adj.has(b)) {
                adj.get(a).add(b);
                adj.get(b).add(a);
            }
        }
    }

    // Greedy BFS grouping
    const assigned = new Set();
    const states = [];
    let stateId = 1;

    // Sort by pixel count descending to start with larger provinces
    const sorted = [...landProvs].sort((a, b) => b.pixelCount - a.pixelCount);

    for (const startProv of sorted) {
        if (assigned.has(startProv.id)) continue;

        const stateProvs = [startProv.id];
        assigned.add(startProv.id);
        const queue = [startProv.id];

        while (queue.length > 0 && stateProvs.length < provincesPerState) {
            const current = queue.shift();
            const neighbors = adj.get(current) || new Set();
            for (const nid of neighbors) {
                if (assigned.has(nid) || stateProvs.length >= provincesPerState) continue;
                stateProvs.push(nid);
                assigned.add(nid);
                queue.push(nid);
            }
        }

        states.push({
            id: stateId++,
            name: `STATE_${stateId - 1}`,
            provinces: stateProvs,
            category: stateProvs.length > 6 ? 'large_city' : stateProvs.length > 3 ? 'city' : 'rural'
        });
    }

    return states;
}

// ─── Strategic Region Grouping ──────────────────────────────────────────────────

function groupIntoRegions(states, provinces, statesPerRegion) {
    const regions = [];
    let regionId = 1;

    for (let i = 0; i < states.length; i += statesPerRegion) {
        const chunk = states.slice(i, i + statesPerRegion);
        const allProvs = [];
        for (const s of chunk) allProvs.push(...s.provinces);

        regions.push({
            id: regionId++,
            name: `STRATEGICREGION_${regionId - 1}`,
            provinces: allProvs
        });
    }

    // Sea regions
    const seaProvs = provinces.filter(p => p.type === 'sea');
    if (seaProvs.length > 0) {
        regions.push({
            id: regionId++,
            name: `OCEAN_REGION`,
            provinces: seaProvs.map(p => p.id),
            navalTerrain: 'open_ocean'
        });
    }

    return regions;
}

// ─── BMP Writer ─────────────────────────────────────────────────────────────────

function createBMP(pixels, width, height) {
    // 24-bit BMP, bottom-up, 4-byte aligned rows
    const rowStride = Math.ceil((width * 3) / 4) * 4;
    const dataSize = rowStride * height;
    const headerSize = 54;
    const fileSize = headerSize + dataSize;

    const buf = Buffer.alloc(fileSize);

    // File header (14 bytes)
    buf.write('BM', 0);
    buf.writeUInt32LE(fileSize, 2);
    buf.writeUInt32LE(0, 6); // reserved
    buf.writeUInt32LE(headerSize, 10);

    // Info header (40 bytes) - BITMAPINFOHEADER
    buf.writeUInt32LE(40, 14); // header size
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22); // positive = bottom-up
    buf.writeUInt16LE(1, 26); // planes
    buf.writeUInt16LE(24, 28); // bits per pixel
    buf.writeUInt32LE(0, 30); // compression (none)
    buf.writeUInt32LE(dataSize, 34);
    buf.writeInt32LE(2835, 38); // x pixels per meter (~72 DPI)
    buf.writeInt32LE(2835, 42); // y pixels per meter
    buf.writeUInt32LE(0, 46); // colors used
    buf.writeUInt32LE(0, 50); // important colors

    // Pixel data (BGR, bottom-up)
    for (let y = 0; y < height; y++) {
        const srcY = height - 1 - y; // flip for bottom-up
        for (let x = 0; x < width; x++) {
            const srcOff = (srcY * width + x) * 3;
            const dstOff = headerSize + y * rowStride + x * 3;
            buf[dstOff + 0] = pixels[srcOff + 2]; // B
            buf[dstOff + 1] = pixels[srcOff + 1]; // G
            buf[dstOff + 2] = pixels[srcOff + 0]; // R
        }
    }

    return buf;
}

// ─── File Generation ────────────────────────────────────────────────────────────

function generateDefinitionCsv(provinces) {
    const lines = ['id;r;g;b;type;coastal;terrain;continent'];
    for (const p of provinces) {
        lines.push(`${p.id};${p.color.r};${p.color.g};${p.color.b};${p.type};${p.coastal};${p.terrain};${p.continent}`);
    }
    return lines.join('\n') + '\n';
}

function generateStateFile(state, owner) {
    const ownerTag = owner || '';
    let historyLines = '';
    if (ownerTag) {
        historyLines = `\t\towner = ${ownerTag}\n\t\tadd_core_of = ${ownerTag}\n`;
    }
    historyLines += '\t\tbuildings = {\n\t\t\tinfrastructure = 1\n\t\t}';

    return `state = {\n\tid = ${state.id}\n\tname = "STATE_${state.id}"\n\tmanpower = 0\n\n\tstate_category = ${state.category}\n\n\thistory = {\n${historyLines}\n\t}\n\n\tprovinces = {\n\t\t${state.provinces.join(' ')}\n\t}\n}\n`;
}

function generateStrategicRegionFile(region) {
    let content = `strategic_region = {\n\tid = ${region.id}\n\tname = "${region.name}"\n\tprovinces = {\n\t\t${region.provinces.join(' ')}\n\t}\n`;
    if (region.navalTerrain) {
        content += `\tnaval_terrain = ${region.navalTerrain}\n`;
    }
    // Weather block
    content += `\tweather = {\n\t\tperiod = {\n\t\t\tbetween = { 0.0 30.0 }\n\t\t\ttemperature = { -5.0 18.0 }\n\t\t\tno_phenomenon = 0.500\n\t\t\train_light = 0.300\n\t\t\train_heavy = 0.100\n\t\t\tsnow = 0.100\n\t\t}\n\t}\n`;
    content += `}\n`;
    return content;
}

function generateDefaultMap(width, height, provinces, seaProvinces) {
    return `max_provinces = ${provinces.length + 1}
definitions = "definition.csv"
provinces = "provinces.bmp"
positions = "positions.txt"
terrain = "terrain.bmp"
rivers = "rivers.bmp"
heightmap = "heightmap.bmp"
tree_definition = "trees.bmp"
continent = "continent.txt"
adjacency_rules = "adjacency_rules.txt"
adjacency = "adjacency.csv"
province_flag_sprites = "province_flag_sprites"
# Sea provinces
sea_starts = { ${seaProvinces.map(p => p.id).join(' ')} }
# Lakes (none by default)
lakes = { }
`;
}

// ─── Main Converter ─────────────────────────────────────────────────────────────

class ImageToMapConverter {
    constructor() {
        this.provinces = [];
        this.states = [];
        this.regions = [];
        this.labels = null;
        this.width = 0;
        this.height = 0;
    }

    /**
     * Convert an image to HOI4 map files.
     * 
     * @param {string} imagePath - Path to source image
     * @param {string} outputDir - Output mod directory
     * @param {object} options - Configuration
     * @returns {object} Result with stats and preview
     */
    async convert(imagePath, outputDir, options = {}) {
        if (!sharp) throw new Error('Sharp is required for image-to-map conversion. Install with: npm install sharp');

        const {
            targetWidth = 0,        // 0 = use image size, HOI4 standard = 5632
            targetHeight = 0,       // 0 = auto from aspect ratio, HOI4 standard = 2048
            colorThreshold = 30,    // How different colors must be to be separate provinces
            minProvincePixels = 16, // Minimum pixels for a valid province
            provincesPerState = 5,  // Target provinces per state
            statesPerRegion = 4,    // Target states per strategic region
            defaultOwner = '',      // Country TAG for all states
            detectSea = true,       // Auto-detect blue regions as sea
            borderColor = null,     // If set, treat this color as borders between provinces
            seaColor = null,        // If set, treat this color as sea
        } = options;

        console.error('[MapGen] Loading image:', imagePath);

        // Step 1: Load and resize image
        let img = sharp(imagePath).removeAlpha();
        const metadata = await sharp(imagePath).metadata();
        let w = targetWidth || metadata.width;
        let h = targetHeight || Math.round(metadata.height * (w / metadata.width));

        // HOI4 maps should be reasonable size
        if (w > 8192) { h = Math.round(h * (8192 / w)); w = 8192; }
        if (h > 4096) { w = Math.round(w * (4096 / h)); h = 4096; }

        // Ensure even dimensions (HOI4 requirement)
        w = w & ~1;
        h = h & ~1;

        const { data: pixels, info } = await img
            .resize(w, h, { kernel: 'nearest' })
            .raw()
            .toBuffer({ resolveWithObject: true });

        this.width = w;
        this.height = h;
        console.error(`[MapGen] Image: ${w}x${h} (${pixels.length} bytes)`);

        // Step 2: Pre-process - quantize to reduce noise
        // Simple quantize: snap each channel to nearest multiple of quantization level
        const quantLevel = Math.max(8, Math.round(colorThreshold / 2));
        const quantized = Buffer.from(pixels);
        for (let i = 0; i < quantized.length; i++) {
            quantized[i] = Math.round(quantized[i] / quantLevel) * quantLevel;
        }

        // Step 3: Connected component labeling
        console.error('[MapGen] Detecting provinces (connected component labeling)...');
        const { labels, provinceCount } = labelComponents(quantized, w, h, colorThreshold);
        this.labels = labels;
        console.error(`[MapGen] Found ${provinceCount} raw regions`);

        // Step 4: Classify provinces (land/sea, coastal detection)
        console.error('[MapGen] Classifying provinces...');
        let provs = classifyProvinces(pixels, labels, w, h, provinceCount);

        // Filter tiny provinces (merge into nearest neighbor or remove)
        const validProvs = provs.filter(p => p.pixelCount >= minProvincePixels);
        console.error(`[MapGen] Valid provinces: ${validProvs.length} (removed ${provs.length - validProvs.length} tiny regions)`);

        // Reassign IDs to be sequential
        const idRemap = new Map();
        validProvs.forEach((p, i) => {
            const oldId = p.id;
            p.id = i + 1;
            p.color = generateProvinceColor(p.id);
            idRemap.set(oldId, p.id);
        });

        // Update labels with new IDs
        for (let i = 0; i < labels.length; i++) {
            if (labels[i] > 0) {
                labels[i] = idRemap.get(labels[i]) || 0;
            }
        }

        this.provinces = validProvs;
        console.error(`[MapGen] Land: ${validProvs.filter(p => p.type === 'land').length}, Sea: ${validProvs.filter(p => p.type === 'sea').length}, Coastal: ${validProvs.filter(p => p.coastal).length}`);

        // Step 5a: Detect continents
        console.error('[MapGen] Detecting continents...');
        const { provContinent, totalContinents, adj } = detectContinents(validProvs, labels, w, h);
        for (const p of validProvs) {
            if (provContinent.has(p.id)) p.continent = provContinent.get(p.id);
        }
        console.error(`[MapGen] Found ${totalContinents} continent(s)`);
        this._adj = adj;
        this._provContinent = provContinent;

        // Step 5b: Generate heightmap data
        console.error('[MapGen] Generating heightmap...');
        this._heightmap = generateHeightmapData(pixels, labels, validProvs, w, h);

        // Step 5c: Terrain stats
        const terrainCounts = {};
        for (const p of validProvs) { terrainCounts[p.terrain] = (terrainCounts[p.terrain] || 0) + 1; }
        console.error(`[MapGen] Terrain: ${Object.entries(terrainCounts).map(([k,v])=>k+':'+v).join(', ')}`);

        // Step 6: Group into states
        console.error('[MapGen] Grouping provinces into states...');
        this.states = groupIntoStates(validProvs, labels, w, h, provincesPerState);
        console.error(`[MapGen] Created ${this.states.length} states`);

        // Step 7: Group into strategic regions
        this.regions = groupIntoRegions(this.states, validProvs, statesPerRegion);
        console.error(`[MapGen] Created ${this.regions.length} strategic regions`);

        // Step 8: Detect adjacencies (straits)
        console.error('[MapGen] Detecting adjacencies...');
        this._adjacencies = detectAdjacencies(validProvs, labels, w, h, provContinent);
        console.error(`[MapGen] Found ${this._adjacencies.length} strait(s)`);

        // Step 9: Generate supply network
        console.error('[MapGen] Generating supply network...');
        this._supply = generateSupplyNetwork(this.states, validProvs, adj);
        console.error(`[MapGen] ${this._supply.hubs.length} supply hubs, ${this._supply.railways.length} railways`);

        // Step 10: Generate output files
        console.error('[MapGen] Generating output files...');
        await this._writeOutput(outputDir, defaultOwner);

        // Step 8: Generate preview
        const preview = await this._generatePreview(labels, validProvs, w, h);

        const result = {
            success: true,
            dimensions: { width: w, height: h },
            provinces: {
                total: validProvs.length,
                land: validProvs.filter(p => p.type === 'land').length,
                sea: validProvs.filter(p => p.type === 'sea').length,
                coastal: validProvs.filter(p => p.coastal).length
            },
            terrain: terrainCounts,
            continents: totalContinents,
            states: this.states.length,
            strategic_regions: this.regions.length,
            supply: { hubs: this._supply.hubs.length, railways: this._supply.railways.length },
            adjacencies: this._adjacencies.length,
            output_dir: outputDir,
            files_created: [],
            preview_base64: preview
        };

        console.error(`[MapGen] Done! ${validProvs.length} provinces, ${this.states.length} states, ${this.regions.length} regions`);
        return result;
    }

    async _writeOutput(outputDir, defaultOwner) {
        // Create directory structure
        const dirs = [
            path.join(outputDir, 'map'),
            path.join(outputDir, 'map', 'strategicregions'),
            path.join(outputDir, 'history', 'states'),
            path.join(outputDir, 'localisation', 'english'),
        ];
        for (const d of dirs) {
            await fs.promises.mkdir(d, { recursive: true });
        }

        // provinces.bmp
        const bmpPixels = new Uint8Array(this.width * this.height * 3);
        for (let i = 0; i < this.labels.length; i++) {
            const pid = this.labels[i];
            const prov = pid > 0 ? this.provinces.find(p => p.id === pid) : null;
            const off = i * 3;
            if (prov) {
                bmpPixels[off] = prov.color.r;
                bmpPixels[off + 1] = prov.color.g;
                bmpPixels[off + 2] = prov.color.b;
            }
            // else black (0,0,0) for borders
        }
        const bmpBuffer = createBMP(bmpPixels, this.width, this.height);
        await fs.promises.writeFile(path.join(outputDir, 'map', 'provinces.bmp'), bmpBuffer);

        // definition.csv
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'definition.csv'),
            generateDefinitionCsv(this.provinces)
        );

        // default.map
        const seaProvs = this.provinces.filter(p => p.type === 'sea');
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'default.map'),
            generateDefaultMap(this.width, this.height, this.provinces, seaProvs)
        );

        // State files
        for (const state of this.states) {
            const fileName = `${state.id}-${state.name}.txt`;
            await fs.promises.writeFile(
                path.join(outputDir, 'history', 'states', fileName),
                generateStateFile(state, defaultOwner)
            );
        }

        // Strategic region files
        for (const region of this.regions) {
            const fileName = `${region.id}-${region.name.replace(/\s+/g, '_')}.txt`;
            await fs.promises.writeFile(
                path.join(outputDir, 'map', 'strategicregions', fileName),
                generateStrategicRegionFile(region)
            );
        }

        // railways.txt
        const railLines = [];
        for (const r of this._supply.railways) {
            railLines.push(`${r.level} ${r.provinces.length}`);
            railLines.push(r.provinces.join(' '));
        }
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'railways.txt'),
            railLines.length > 0 ? railLines.join('\n') + '\n' : '# No railways\n'
        );

        // supply_nodes.txt
        const supplyLines = this._supply.hubs.map(h => `${h.level} ${h.province}`);
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'supply_nodes.txt'),
            supplyLines.length > 0 ? supplyLines.join('\n') + '\n' : '# No supply nodes\n'
        );

        // adjacency.csv
        const adjLines = ['From;To;Type;Through;start_x;start_y;stop_x;stop_y;adjacency_rule_name;Comment'];
        for (const a of this._adjacencies) {
            adjLines.push(`${a.from};${a.to};${a.type};${a.through};${a.start.x};${a.start.y};${a.stop.x};${a.stop.y};;${a.comment}`);
        }
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'adjacency.csv'),
            adjLines.join('\n') + '\n'
        );

        // heightmap.bmp
        const heightPixels = new Uint8Array(this.width * this.height * 3);
        for (let i = 0; i < this._heightmap.length; i++) {
            const v = this._heightmap[i];
            heightPixels[i * 3] = v;
            heightPixels[i * 3 + 1] = v;
            heightPixels[i * 3 + 2] = v;
        }
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'heightmap.bmp'),
            createBMP(heightPixels, this.width, this.height)
        );

        // positions.txt
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'positions.txt'),
            generatePositionsTxt(this.provinces, this._heightmap, this.width, this.height)
        );

        // continent.txt
        const continentLines = ['# Continent definitions'];
        const continentIds = new Set();
        for (const p of this.provinces) { if (p.continent > 0) continentIds.add(p.continent); }
        for (const cid of [...continentIds].sort()) {
            const provIds = this.provinces.filter(p => p.continent === cid).map(p => p.id);
            continentLines.push(`${cid} = { ${provIds.join(' ')} }`);
        }
        await fs.promises.writeFile(
            path.join(outputDir, 'map', 'continent.txt'),
            continentLines.join('\n') + '\n'
        );

        // Localization
        const locLines = ['\uFEFFl_english:'];
        for (const state of this.states) {
            locLines.push(` STATE_${state.id}:0 "${state.name}"`);
        }
        await fs.promises.writeFile(
            path.join(outputDir, 'localisation', 'english', 'state_names_l_english.yml'),
            locLines.join('\n') + '\n'
        );
    }

    async _generatePreview(labels, provinces, width, height) {
        if (!sharp) return null;

        // Create a political-view preview
        const previewPixels = new Uint8Array(width * height * 3);
        const provMap = new Map(provinces.map(p => [p.id, p]));

        for (let i = 0; i < labels.length; i++) {
            const pid = labels[i];
            const prov = provMap.get(pid);
            const off = i * 3;
            if (prov) {
                if (prov.type === 'sea') {
                    previewPixels[off] = 50;
                    previewPixels[off + 1] = 80;
                    previewPixels[off + 2] = 160;
                } else {
                    // Use state-based colors
                    const stateColor = ((prov.id * 137 + 43) % 128) + 64;
                    previewPixels[off] = ((prov.id * 89) % 128) + 100;
                    previewPixels[off + 1] = stateColor;
                    previewPixels[off + 2] = ((prov.id * 53) % 100) + 80;
                }
            }
        }

        // Draw province borders
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width - 1; x++) {
                const a = labels[y * width + x], b = labels[y * width + x + 1];
                if (a !== b) {
                    const off = (y * width + x) * 3;
                    previewPixels[off] = previewPixels[off + 1] = previewPixels[off + 2] = 40;
                }
            }
        }
        for (let y = 0; y < height - 1; y++) {
            for (let x = 0; x < width; x++) {
                const a = labels[y * width + x], b = labels[(y + 1) * width + x];
                if (a !== b) {
                    const off = (y * width + x) * 3;
                    previewPixels[off] = previewPixels[off + 1] = previewPixels[off + 2] = 40;
                }
            }
        }

        // Downscale for preview
        const previewWidth = Math.min(width, 1200);
        const previewHeight = Math.round(height * (previewWidth / width));

        const pngBuffer = await sharp(Buffer.from(previewPixels), { raw: { width, height, channels: 3 } })
            .resize(previewWidth, previewHeight, { kernel: 'nearest' })
            .png()
            .toBuffer();

        return pngBuffer.toString('base64');
    }
}

// ─── Exports ────────────────────────────────────────────────────────────────────

exports.ImageToMapConverter = ImageToMapConverter;
exports.createBMP = createBMP;
exports.generateDefinitionCsv = generateDefinitionCsv;
exports.generateStateFile = generateStateFile;
exports.generateStrategicRegionFile = generateStrategicRegionFile;
