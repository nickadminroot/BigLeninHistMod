"use strict";
// Map Data Loader - Parses all HOI4 map files and builds WorldMapData
// Improved v0.3.0 with proper province geometry, railway routing, and enhanced coloring
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapDataLoader = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function packRGB(r, g, b) {
    return (r << 16) | (g << 8) | b;
}
function unpackRGB(packed) {
    return {
        r: (packed >> 16) & 0xFF,
        g: (packed >> 8) & 0xFF,
        b: packed & 0xFF
    };
}
class MapDataLoader {
    constructor(workspaceRoot) {
        this.provinces = [];
        this.states = [];
        this.strategicRegions = [];
        this.countries = [];
        this.railways = [];
        this.supplyNodes = [];
        this.warnings = [];
        this.continents = [''];
        this.terrains = [];
        this.colorToProvinceId = new Map();
        this.provinceIdToState = new Map();
        this.stateNames = new Map(); // STATE_ID -> localized name from state_names_l_english.yml
        this.maxProvinceId = 0;
        this.maxStateId = 0;
        this.mapWidth = 0;
        this.mapHeight = 0;
        this.bmpData = null;
        this.customBuildings = [];
        this.terrainDefinitions = [];
        this.rivers = null;
        this.heightmap = null;
        this.workspaceRoot = workspaceRoot;
    }
    async load(progress) {
        progress('Loading definition.csv...', 5);
        await this.loadDefinition();
        progress('Loading provinces.bmp...', 15);
        await this.loadProvincesBmp();
        progress('Building province geometry...', 30);
        this.buildProvinceGeometry();
        progress('Building province adjacencies...', 40);
        this.buildProvinceAdjacencies();
        progress('Loading states...', 50);
        await this.loadStates();
        progress('Loading state names...', 55);
        await this.loadStateNames();
        progress('Loading strategic regions...', 60);
        await this.loadStrategicRegions();
        progress('Loading countries...', 70);
        await this.loadCountries();
        progress('Loading supply network...', 78);
        await this.loadSupplyNetwork();
        progress('Loading terrain definitions...', 85);
        await this.loadTerrainDefinitions();
        progress('Loading custom buildings...', 90);
        await this.loadCustomBuildings();
        progress('Loading rivers...', 92);
        await this.loadRivers();
        progress('Loading heightmap...', 94);
        await this.loadHeightmap();
        progress('Validating...', 95);
        this.validate();
        progress('Complete', 100);
        return this.buildWorldMapData();
    }
    async loadStateNames() {
        // Load state names from localisation/english/state_names_l_english.yml
        const locPaths = [
            path.join(this.workspaceRoot, 'localisation', 'english', 'state_names_l_english.yml'),
            path.join(this.workspaceRoot, 'localisation', 'state_names_l_english.yml'),
            path.join(this.workspaceRoot, 'localization', 'english', 'state_names_l_english.yml'),
            path.join(this.workspaceRoot, 'localization', 'state_names_l_english.yml')
        ];
        for (const locPath of locPaths) {
            if (fs.existsSync(locPath)) {
                try {
                    const content = await fs.promises.readFile(locPath, 'utf-8');
                    const lines = content.split(/\r?\n/);
                    for (const line of lines) {
                        // Format: STATE_123:0 "State Name"
                        const match = line.match(/^\s*(STATE_\d+):\d*\s*"([^"]+)"/);
                        if (match) {
                            this.stateNames.set(match[1], match[2]);
                        }
                    }
                } catch (e) {
                    console.error('Failed to load state names from', locPath, e);
                }
                break; // Stop after first found file
            }
        }
    }
    async loadDefinition() {
        const defPath = path.join(this.workspaceRoot, 'map', 'definition.csv');
        if (!fs.existsSync(defPath)) {
            throw new Error('definition.csv not found');
        }
        const content = await fs.promises.readFile(defPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        // Log first few lines to debug format
        const log = (msg) => {
            const channel = global.hoi4OutputChannel;
            if (channel)
                channel.appendLine(msg);
        };
        log('[Definition] First 3 data lines:');
        let logCount = 0;
        for (const line of lines) {
            if (!line.trim() || line.startsWith('#'))
                continue;
            const parts = line.split(';');
            if (parts.length < 4)
                continue;
            // Log first few lines for debugging
            if (logCount < 3) {
                log('[Definition] Line: ' + line.substring(0, 100));
                logCount++;
            }
            const id = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            const g = parseInt(parts[2], 10);
            const b = parseInt(parts[3], 10);
            if (isNaN(id) || id < 0 || isNaN(r) || isNaN(g) || isNaN(b))
                continue;
            // HOI4 definition.csv format: provinceID;R;G;B;type;coastal;terrain;continent
            // parts[0] = id, parts[1-3] = RGB, parts[4] = type, parts[5] = coastal, parts[6] = terrain, parts[7] = continent
            const typeStr = (parts[4] || 'land').toLowerCase();
            const type = typeStr === 'sea' ? 'sea' : typeStr === 'lake' ? 'lake' : 'land';
            const coastal = parts[5]?.toLowerCase() === 'true';
            const terrain = parts[6] || 'unknown';
            const continent = parseInt(parts[7] || '0', 10) || 0;
            const color = packRGB(r, g, b);
            const province = {
                id,
                color,
                rgb: { r, g, b },
                type: type,
                terrain,
                coastal,
                continent,
                boundingBox: { x: 0, y: 0, w: 0, h: 0 },
                coverZones: [],
                centerOfMass: { x: 0, y: 0 },
                edges: [],
                pixelCount: 0
            };
            this.provinces[id] = province;
            this.colorToProvinceId.set(color, id);
            if (id > this.maxProvinceId) {
                this.maxProvinceId = id;
            }
            // Track continents
            if (continent >= this.continents.length) {
                while (this.continents.length <= continent) {
                    this.continents.push(`Continent ${this.continents.length}`);
                }
            }
            // Track terrains (only track actual terrain names, not type names)
            if (terrain && terrain !== 'unknown' && !this.terrains.includes(terrain)) {
                this.terrains.push(terrain);
            }
        }
        log('[Definition] Parsed terrains: ' + JSON.stringify(this.terrains));
    }
    async loadProvincesBmp() {
        const bmpPath = path.join(this.workspaceRoot, 'map', 'provinces.bmp');
        if (!fs.existsSync(bmpPath)) {
            throw new Error('provinces.bmp not found');
        }
        const buffer = await fs.promises.readFile(bmpPath);
        // Parse BMP header
        const magic = buffer.toString('ascii', 0, 2);
        if (magic !== 'BM') {
            throw new Error('Invalid BMP file');
        }
        const dataOffset = buffer.readUInt32LE(10);
        const width = buffer.readInt32LE(18);
        const height = Math.abs(buffer.readInt32LE(22));
        const bitsPerPixel = buffer.readUInt16LE(28);
        if (bitsPerPixel !== 24) {
            throw new Error(`Unsupported BMP bit depth: ${bitsPerPixel}`);
        }
        this.mapWidth = width;
        this.mapHeight = height;
        // Row stride (4-byte aligned)
        const rowStride = Math.ceil((width * 3) / 4) * 4;
        // Extract RGB data (flip vertically - BMP is bottom-up)
        this.bmpData = new Uint8Array(width * height * 3);
        for (let y = 0; y < height; y++) {
            const srcY = height - 1 - y;
            const srcOffset = dataOffset + srcY * rowStride;
            const dstOffset = y * width * 3;
            for (let x = 0; x < width; x++) {
                // BMP is BGR, convert to RGB
                this.bmpData[dstOffset + x * 3 + 0] = buffer[srcOffset + x * 3 + 2];
                this.bmpData[dstOffset + x * 3 + 1] = buffer[srcOffset + x * 3 + 1];
                this.bmpData[dstOffset + x * 3 + 2] = buffer[srcOffset + x * 3 + 0];
            }
        }
    }
    buildProvinceGeometry() {
        if (!this.bmpData)
            return;
        const width = this.mapWidth;
        const height = this.mapHeight;
        // Track pixels per province for bounding box and center of mass
        const provincePixels = new Map();
        // Scan all pixels
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = (y * width + x) * 3;
                const r = this.bmpData[offset];
                const g = this.bmpData[offset + 1];
                const b = this.bmpData[offset + 2];
                const color = packRGB(r, g, b);
                const provinceId = this.colorToProvinceId.get(color);
                if (provinceId !== undefined) {
                    let pixels = provincePixels.get(provinceId);
                    if (!pixels) {
                        pixels = [];
                        provincePixels.set(provinceId, pixels);
                    }
                    pixels.push({ x, y });
                }
            }
        }
        // Build geometry for each province
        for (const [provinceId, pixels] of provincePixels) {
            const province = this.provinces[provinceId];
            if (!province)
                continue;
            province.pixelCount = pixels.length;
            // Calculate bounding box and center of mass
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;
            let sumX = 0, sumY = 0;
            for (const p of pixels) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
                sumX += p.x;
                sumY += p.y;
            }
            province.boundingBox = {
                x: minX,
                y: minY,
                w: maxX - minX + 1,
                h: maxY - minY + 1
            };
            province.centerOfMass = {
                x: Math.round(sumX / pixels.length),
                y: Math.round(sumY / pixels.length)
            };
            // Build cover zones using run-length encoding per row
            province.coverZones = this.buildCoverZones(pixels);
        }
    }
    buildCoverZones(pixels) {
        // Group pixels by row
        const rows = new Map();
        for (const p of pixels) {
            let row = rows.get(p.y);
            if (!row) {
                row = [];
                rows.set(p.y, row);
            }
            row.push(p.x);
        }
        const zones = [];
        for (const [y, xCoords] of rows) {
            xCoords.sort((a, b) => a - b);
            // Run-length encode
            let startX = xCoords[0];
            let prevX = xCoords[0];
            for (let i = 1; i <= xCoords.length; i++) {
                const x = xCoords[i];
                if (i === xCoords.length || x !== prevX + 1) {
                    zones.push({
                        x: startX,
                        y: y,
                        w: prevX - startX + 1,
                        h: 1
                    });
                    startX = x;
                }
                prevX = x;
            }
        }
        return zones;
    }
    buildProvinceAdjacencies() {
        if (!this.bmpData)
            return;
        const width = this.mapWidth;
        const height = this.mapHeight;
        // For each province, find border pixels with neighbors
        const provinceBorders = new Map();
        // Scan all pixels for borders
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = (y * width + x) * 3;
                const r = this.bmpData[offset];
                const g = this.bmpData[offset + 1];
                const b = this.bmpData[offset + 2];
                const color = packRGB(r, g, b);
                const provinceId = this.colorToProvinceId.get(color);
                if (provinceId === undefined)
                    continue;
                // Check 4-connected neighbors
                const checkNeighbor = (nx, ny) => {
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height)
                        return;
                    const nOffset = (ny * width + nx) * 3;
                    const nr = this.bmpData[nOffset];
                    const ng = this.bmpData[nOffset + 1];
                    const nb = this.bmpData[nOffset + 2];
                    const nColor = packRGB(nr, ng, nb);
                    const neighborId = this.colorToProvinceId.get(nColor);
                    if (neighborId !== undefined && neighborId !== provinceId) {
                        // Found a border pixel
                        let borders = provinceBorders.get(provinceId);
                        if (!borders) {
                            borders = new Map();
                            provinceBorders.set(provinceId, borders);
                        }
                        let borderPixels = borders.get(neighborId);
                        if (!borderPixels) {
                            borderPixels = [];
                            borders.set(neighborId, borderPixels);
                        }
                        // Add the current pixel as a border point (avoid duplicates with simple check)
                        if (borderPixels.length === 0 ||
                            borderPixels[borderPixels.length - 1].x !== x ||
                            borderPixels[borderPixels.length - 1].y !== y) {
                            borderPixels.push({ x, y });
                        }
                    }
                };
                checkNeighbor(x - 1, y);
                checkNeighbor(x + 1, y);
                checkNeighbor(x, y - 1);
                checkNeighbor(x, y + 1);
            }
        }
        // Convert to province edges
        for (const [provinceId, borders] of provinceBorders) {
            const province = this.provinces[provinceId];
            if (!province)
                continue;
            province.edges = [];
            for (const [neighborId, borderPixels] of borders) {
                // Sample border pixels to keep data size manageable
                const sampledPixels = this.sampleBorderPixels(borderPixels, 50);
                province.edges.push({
                    to: neighborId,
                    borderPixels: sampledPixels
                });
            }
        }
    }
    sampleBorderPixels(pixels, maxCount) {
        if (pixels.length <= maxCount)
            return pixels;
        const result = [];
        const step = pixels.length / maxCount;
        for (let i = 0; i < maxCount; i++) {
            const idx = Math.floor(i * step);
            result.push(pixels[idx]);
        }
        return result;
    }
    async loadStates() {
        const statesDir = path.join(this.workspaceRoot, 'history', 'states');
        if (!fs.existsSync(statesDir))
            return;
        const files = await fs.promises.readdir(statesDir);
        for (const file of files) {
            if (!file.endsWith('.txt'))
                continue;
            const filePath = path.join(statesDir, file);
            const content = await fs.promises.readFile(filePath, 'utf-8');
            try {
                const state = this.parseStateFile(content, filePath);
                if (state) {
                    this.states[state.id] = state;
                    if (state.id > this.maxStateId) {
                        this.maxStateId = state.id;
                    }
                    // Map provinces to state
                    for (const provinceId of state.provinces) {
                        this.provinceIdToState.set(provinceId, state.id);
                    }
                    // Calculate state center of mass
                    state.centerOfMass = this.calculateStateCenterOfMass(state);
                }
            }
            catch (e) {
                console.error(`Error parsing ${file}:`, e);
            }
        }
    }
    parseStateFile(content, filePath) {
        // Simple regex-based parser
        const idMatch = content.match(/^\s*state\s*=\s*\{\s*id\s*=\s*(\d+)/m) ||
            content.match(/id\s*=\s*(\d+)/);
        if (!idMatch)
            return null;
        const id = parseInt(idMatch[1], 10);
        const nameMatch = content.match(/name\s*=\s*"?([^"\n}]+)"?/);
        const name = nameMatch ? nameMatch[1].trim() : `STATE_${id}`;
        const ownerMatch = content.match(/owner\s*=\s*(\w+)/);
        const owner = ownerMatch ? ownerMatch[1] : undefined;
        const manpowerMatch = content.match(/manpower\s*=\s*(\d+)/);
        const manpower = manpowerMatch ? parseInt(manpowerMatch[1], 10) : 0;
        const categoryMatch = content.match(/state_category\s*=\s*(\w+)/);
        const category = categoryMatch ? categoryMatch[1] : 'rural';
        const impassable = /impassable\s*=\s*yes/i.test(content);
        // Parse provinces
        const provincesMatch = content.match(/provinces\s*=\s*\{([^}]+)\}/);
        const provinces = [];
        if (provincesMatch) {
            const nums = provincesMatch[1].match(/\d+/g);
            if (nums) {
                provinces.push(...nums.map(n => parseInt(n, 10)));
            }
        }
        // Parse cores
        const cores = [];
        const coreMatches = content.matchAll(/add_core_of\s*=\s*(\w+)/g);
        for (const match of coreMatches) {
            cores.push(match[1]);
        }
        // Parse victory points
        const victoryPoints = {};
        const vpMatches = content.matchAll(/victory_points\s*=\s*\{\s*(\d+)\s+(\d+)\s*\}/g);
        for (const match of vpMatches) {
            victoryPoints[parseInt(match[1], 10)] = parseInt(match[2], 10);
        }
        // Parse resources
        const resources = {};
        const resourcesMatch = content.match(/resources\s*=\s*\{([^}]+)\}/);
        if (resourcesMatch) {
            const resMatches = resourcesMatch[1].matchAll(/(\w+)\s*=\s*(\d+)/g);
            for (const match of resMatches) {
                resources[match[1]] = parseInt(match[2], 10);
            }
        }
        // Parse buildings
        const buildings = {};
        // Match the entire buildings block including nested province blocks
        const buildingsBlockMatch = content.match(/buildings\s*=\s*\{([\s\S]*?)\n\t\}/);
        if (buildingsBlockMatch) {
            const buildingsContent = buildingsBlockMatch[1];
            
            // Parse state-level buildings (e.g., air_base = 3, infrastructure = 5)
            // These are direct key = value pairs not inside province blocks
            const lines = buildingsContent.split('\n');
            for (const line of lines) {
                // Match simple building = value (not inside a province block)
                const simpleMatch = line.match(/^\s*(\w+)\s*=\s*(\d+)\s*$/);
                if (simpleMatch && !simpleMatch[1].match(/^\d+$/)) {
                    buildings[simpleMatch[1]] = parseInt(simpleMatch[2], 10);
                }
            }
            
            // Parse province-specific buildings (e.g., 1234 = { naval_base = 2 dockyard = 1 })
            // This handles multi-line and single-line province blocks
            const provinceBlockRegex = /(\d+)\s*=\s*\{([^}]+)\}/g;
            let match;
            while ((match = provinceBlockRegex.exec(buildingsContent)) !== null) {
                const provinceId = match[1];
                const provBuildingsContent = match[2];
                buildings[provinceId] = {};
                
                // Parse all building = value pairs in this province block
                const buildingPairRegex = /(\w+)\s*=\s*(\d+)/g;
                let pairMatch;
                while ((pairMatch = buildingPairRegex.exec(provBuildingsContent)) !== null) {
                    buildings[provinceId][pairMatch[1]] = parseInt(pairMatch[2], 10);
                }
            }
        }
        return {
            id,
            name,
            owner,
            cores,
            manpower,
            category,
            provinces,
            victoryPoints,
            resources,
            impassable,
            file: filePath,
            buildings
        };
    }
    calculateStateCenterOfMass(state) {
        let sumX = 0, sumY = 0, totalPixels = 0;
        for (const provinceId of state.provinces) {
            const province = this.provinces[provinceId];
            if (province) {
                const weight = province.pixelCount || 1;
                sumX += province.centerOfMass.x * weight;
                sumY += province.centerOfMass.y * weight;
                totalPixels += weight;
            }
        }
        if (totalPixels === 0)
            return { x: 0, y: 0 };
        return {
            x: Math.round(sumX / totalPixels),
            y: Math.round(sumY / totalPixels)
        };
    }
    async loadStrategicRegions() {
        const regionsDir = path.join(this.workspaceRoot, 'map', 'strategicregions');
        if (!fs.existsSync(regionsDir))
            return;
        const files = await fs.promises.readdir(regionsDir);
        for (const file of files) {
            if (!file.endsWith('.txt'))
                continue;
            const filePath = path.join(regionsDir, file);
            const content = await fs.promises.readFile(filePath, 'utf-8');
            try {
                const region = this.parseStrategicRegionFile(content, filePath);
                if (region) {
                    this.strategicRegions[region.id] = region;
                    region.centerOfMass = this.calculateRegionCenterOfMass(region);
                }
            }
            catch (e) {
                console.error(`Error parsing ${file}:`, e);
            }
        }
    }
    parseStrategicRegionFile(content, filePath) {
        const idMatch = content.match(/id\s*=\s*(\d+)/);
        if (!idMatch)
            return null;
        const id = parseInt(idMatch[1], 10);
        const nameMatch = content.match(/name\s*=\s*"?([^"\n}]+)"?/);
        const name = nameMatch ? nameMatch[1].trim() : `STRATEGIC_REGION_${id}`;
        const provincesMatch = content.match(/provinces\s*=\s*\{([^}]+)\}/);
        const provinces = [];
        if (provincesMatch) {
            const nums = provincesMatch[1].match(/\d+/g);
            if (nums) {
                provinces.push(...nums.map(n => parseInt(n, 10)));
            }
        }
        const navalTerrainMatch = content.match(/naval_terrain\s*=\s*(\w+)/);
        const navalTerrain = navalTerrainMatch ? navalTerrainMatch[1] : undefined;
        return { id, name, provinces, navalTerrain, file: filePath };
    }
    calculateRegionCenterOfMass(region) {
        let sumX = 0, sumY = 0, totalPixels = 0;
        for (const provinceId of region.provinces) {
            const province = this.provinces[provinceId];
            if (province) {
                const weight = province.pixelCount || 1;
                sumX += province.centerOfMass.x * weight;
                sumY += province.centerOfMass.y * weight;
                totalPixels += weight;
            }
        }
        if (totalPixels === 0)
            return { x: 0, y: 0 };
        return {
            x: Math.round(sumX / totalPixels),
            y: Math.round(sumY / totalPixels)
        };
    }
    async loadCountries() {
        const colorsFile = path.join(this.workspaceRoot, 'common', 'countries', 'colors.txt');
        // Try to load colors.txt
        if (fs.existsSync(colorsFile)) {
            const content = await fs.promises.readFile(colorsFile, 'utf-8');
            // Match various color formats
            const matches = content.matchAll(/(\w{3})\s*=\s*\{\s*color\s*=\s*(?:rgb|hsv)?\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}/g);
            for (const match of matches) {
                const tag = match[1];
                const r = parseInt(match[2], 10);
                const g = parseInt(match[3], 10);
                const b = parseInt(match[4], 10);
                this.countries.push({
                    tag,
                    color: packRGB(r, g, b)
                });
            }
        }
    }
    async loadSupplyNetwork() {
        // Load railways
        // Format: Level Amount_of_provinces Province1 Province2 Province3...
        // Example: 4 4 693 1444 12 11
        const railwaysFile = path.join(this.workspaceRoot, 'map', 'railways.txt');
        if (fs.existsSync(railwaysFile)) {
            const content = await fs.promises.readFile(railwaysFile, 'utf-8');
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
                if (!line.trim() || line.startsWith('#'))
                    continue;
                const parts = line.trim().split(/\s+/);
                if (parts.length < 4) // Need at least: level, count, prov1, prov2
                    continue;
                const level = parseInt(parts[0], 10);
                const count = parseInt(parts[1], 10);
                if (isNaN(level) || isNaN(count))
                    continue;
                // Skip parts[0] (level) and parts[1] (count), provinces start at parts[2]
                const provinces = parts.slice(2).map(p => parseInt(p, 10)).filter(p => !isNaN(p));
                if (provinces.length >= 2) {
                    this.railways.push({ level, provinces });
                }
            }
        }
        
        // Load supply nodes - check both files
        // First try supply_nodes.txt (province-based format)
        // HOI4 format: "level province" (space separated), e.g. "1 1234"
        const supplyNodesFile = path.join(this.workspaceRoot, 'map', 'supply_nodes.txt');
        if (fs.existsSync(supplyNodesFile)) {
            const content = await fs.promises.readFile(supplyNodesFile, 'utf-8');
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#'))
                    continue;
                // Split by whitespace (HOI4 uses space-separated values)
                const parts = trimmed.split(/\s+/);
                if (parts.length < 2)
                    continue;
                const level = parseInt(parts[0], 10);
                const province = parseInt(parts[1], 10);
                // Only add if both are valid numbers and level is reasonable (1-10)
                if (!isNaN(level) && !isNaN(province) && province > 0 && level >= 1 && level <= 10) {
                    this.supplyNodes.push({ level, province });
                }
            }
            console.error('Supply nodes from supply_nodes.txt:', this.supplyNodes.length);
        } else {
            console.error('supply_nodes.txt not found');
        }
        
        // Also load building POSITIONS from buildings.txt
        // NOTE: buildings.txt contains POSITIONS where buildings CAN be built, not where they ARE built
        // Supply nodes that actually EXIST come from supply_nodes.txt only
        // We still load air_base and naval_base positions for reference
        const buildingsFile = path.join(this.workspaceRoot, 'map', 'buildings.txt');
        if (fs.existsSync(buildingsFile)) {
            const content = await fs.promises.readFile(buildingsFile, 'utf-8');
            const lines = content.split(/\r?\n/);
            
            for (const line of lines) {
                if (!line.trim() || line.startsWith('#'))
                    continue;
                const parts = line.trim().split(';');
                if (parts.length < 6)
                    continue;
                    
                const buildingType = parts[1].trim();
                const stateId = parseInt(parts[0], 10);
                const x = parseFloat(parts[2]);
                const y = parseFloat(parts[3]); // Height/elevation
                const z = parseFloat(parts[4]); // Map Y coordinate
                const rotation = parseFloat(parts[5]);
                
                // NOTE: We do NOT load supply_node from buildings.txt anymore
                // buildings.txt only contains POSITIONS, not actual built supply hubs
                // Actual supply hubs come from supply_nodes.txt
                
                // Track air_base locations
                if (buildingType === 'air_base') {
                    if (!isNaN(stateId) && !isNaN(x) && !isNaN(z)) {
                        if (!this.airbaseLocations) this.airbaseLocations = [];
                        this.airbaseLocations.push({
                            stateId: stateId,
                            x: x,
                            y: y,
                            z: z,
                            rotation: rotation
                        });
                    }
                }
                
                // Track naval_base locations
                if (buildingType === 'naval_base') {
                    if (!isNaN(stateId) && !isNaN(x) && !isNaN(z)) {
                        if (!this.navalBaseLocations) this.navalBaseLocations = [];
                        this.navalBaseLocations.push({
                            stateId: stateId,
                            x: x,
                            y: y,
                            z: z,
                            rotation: rotation
                        });
                    }
                }
            }
            console.error('Building positions loaded from buildings.txt');
        }
        
        console.error('Final supply node count (from supply_nodes.txt only):', this.supplyNodes.length);
    }
    async loadTerrainDefinitions() {
        // Get output channel if available
        const log = (msg) => {
            const channel = global.hoi4OutputChannel;
            if (channel)
                channel.appendLine(msg);
        };
        // Default terrain colors - these are fallbacks if not defined in files
        const defaultTerrainColors = {
            'plains': 0x7CB342, // Light green
            'forest': 0x2E7D32, // Forest green
            'hills': 0x9E9D24, // Olive green
            'mountain': 0x757575, // Gray
            'desert': 0xFDD835, // Yellow/sand
            'marsh': 0x4E342E, // Dark brown
            'jungle': 0x1B5E20, // Dark green
            'urban': 0x424242, // Dark gray
            'ocean': 0x0D47A1, // Navy blue
            'lakes': 0x1976D2, // Blue
            'unknown': 0x9E9E9E, // Medium gray
            // Additional common terrains
            'farmlands': 0x8BC34A, // Light green
            'pasture': 0xAED581, // Pale green
            'steppe': 0xD4E157, // Yellow-green
            'savanna': 0xFFB300, // Amber
            'wetlands': 0x00695C, // Teal
            'tundra': 0xB0BEC5, // Blue-gray
            'arctic': 0xECEFF1, // Light blue-gray
            'coastal_desert': 0xFFE082, // Light amber
            'oasis': 0x66BB6A // Medium green
        };
        log('[Terrain] Terrains from definition.csv: ' + JSON.stringify(this.terrains));
        // Initialize with terrains found in definition.csv
        for (const terrainName of this.terrains) {
            const color = defaultTerrainColors[terrainName.toLowerCase()] || defaultTerrainColors['unknown'];
            this.terrainDefinitions.push({ name: terrainName, color });
        }
        log('[Terrain] Initial terrain definitions count: ' + this.terrainDefinitions.length);
        // Try to load terrain definitions from common/terrain
        const terrainDir = path.join(this.workspaceRoot, 'common', 'terrain');
        if (!fs.existsSync(terrainDir)) {
            log('[Terrain] No common/terrain directory found at: ' + terrainDir);
            return;
        }
        try {
            const files = await fs.promises.readdir(terrainDir);
            log('[Terrain] Terrain files found: ' + files.join(', '));
            for (const file of files) {
                if (!file.endsWith('.txt'))
                    continue;
                const filePath = path.join(terrainDir, file);
                const content = await fs.promises.readFile(filePath, 'utf-8');
                // Parse terrain definitions - look for color = { r g b }
                // Format: terrain_name = { color = { 120 180 60 } ... }
                const terrainRegex = /(\w+)\s*=\s*\{[^}]*color\s*=\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}/g;
                let match;
                while ((match = terrainRegex.exec(content)) !== null) {
                    const name = match[1];
                    const r = parseInt(match[2], 10);
                    const g = parseInt(match[3], 10);
                    const b = parseInt(match[4], 10);
                    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                        const color = (r << 16) | (g << 8) | b;
                        // Update existing or add new
                        const existing = this.terrainDefinitions.find(t => t.name === name);
                        if (existing) {
                            existing.color = color;
                        }
                        else {
                            this.terrainDefinitions.push({ name, color });
                            if (!this.terrains.includes(name)) {
                                this.terrains.push(name);
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            log('[Terrain] Error loading terrain definitions: ' + e);
        }
        log('[Terrain] Final terrain definitions: ' + JSON.stringify(this.terrainDefinitions.slice(0, 10)) + (this.terrainDefinitions.length > 10 ? '...' : ''));
    }
    async loadCustomBuildings() {
        // Default HOI4 buildings
        const defaultBuildings = [
            'infrastructure',
            'arms_factory',
            'industrial_complex',
            'air_base',
            'anti_air_building',
            'radar_station',
            'dockyard',
            'naval_base',
            'fuel_silo',
            'rocket_site',
            'nuclear_reactor',
            'synthetic_refinery',
            'bunker',
            'coastal_bunker',
            'naval_fortress'
        ];
        this.customBuildings = [...defaultBuildings];
        // Scan common/buildings for mod-defined buildings
        const buildingsDir = path.join(this.workspaceRoot, 'common', 'buildings');
        if (!fs.existsSync(buildingsDir))
            return;
        try {
            const files = await fs.promises.readdir(buildingsDir);
            for (const file of files) {
                if (!file.endsWith('.txt'))
                    continue;
                const filePath = path.join(buildingsDir, file);
                const content = await fs.promises.readFile(filePath, 'utf-8');
                // Parse building definitions - they're typically like:
                // building_name = { ... }
                const buildingMatches = content.matchAll(/^(\w+)\s*=\s*\{/gm);
                for (const match of buildingMatches) {
                    const buildingName = match[1];
                    // Skip if it's a common non-building token
                    if (['buildings', 'if', 'else', 'AND', 'OR', 'NOT', 'limit', 'trigger'].includes(buildingName)) {
                        continue;
                    }
                    if (!this.customBuildings.includes(buildingName)) {
                        this.customBuildings.push(buildingName);
                    }
                }
            }
        }
        catch (e) {
            console.error('Error loading custom buildings:', e);
        }
    }
    validate() {
        // Check for orphaned provinces (land provinces not in any state)
        for (const province of this.provinces) {
            if (!province)
                continue;
            if (province.type === 'land' && !this.provinceIdToState.has(province.id)) {
                this.warnings.push({
                    source: [{ type: 'province', id: province.id }],
                    text: `Province ${province.id} is not assigned to any state`
                });
            }
        }
        // Check for states with no provinces
        for (const state of this.states) {
            if (!state)
                continue;
            if (state.provinces.length === 0) {
                this.warnings.push({
                    source: [{ type: 'state', id: state.id }],
                    text: `State ${state.id} has no provinces`
                });
            }
        }
        // Check for provinces in multiple states
        const provinceStateCount = new Map();
        for (const state of this.states) {
            if (!state)
                continue;
            for (const provinceId of state.provinces) {
                let states = provinceStateCount.get(provinceId);
                if (!states) {
                    states = [];
                    provinceStateCount.set(provinceId, states);
                }
                states.push(state.id);
            }
        }
        for (const [provinceId, stateIds] of provinceStateCount) {
            if (stateIds.length > 1) {
                this.warnings.push({
                    source: [{ type: 'province', id: provinceId }],
                    text: `Province ${provinceId} is in multiple states: ${stateIds.join(', ')}`
                });
            }
        }
        // Check for invalid railway references
        for (let i = 0; i < this.railways.length; i++) {
            const railway = this.railways[i];
            for (const provinceId of railway.provinces) {
                if (!this.provinces[provinceId]) {
                    this.warnings.push({
                        source: [{ type: 'railway', id: i }],
                        text: `Railway ${i} references non-existent province ${provinceId}`
                    });
                }
            }
        }
    }
    buildWorldMapData() {
        // Convert stateNames Map to object for serialization
        const stateNamesObj = {};
        for (const [key, value] of this.stateNames) {
            stateNamesObj[key] = value;
        }
        return {
            width: this.mapWidth,
            height: this.mapHeight,
            provinces: this.provinces.filter(p => p !== undefined),
            states: this.states.filter(s => s !== undefined),
            strategicRegions: this.strategicRegions.filter(r => r !== undefined),
            countries: this.countries,
            railways: this.railways,
            supplyNodes: this.supplyNodes,
            rivers: this.rivers,
            heightmap: this.heightmap,
            warnings: this.warnings,
            continents: this.continents,
            terrains: this.terrains,
            terrainDefinitions: this.terrainDefinitions,
            customBuildings: this.customBuildings,
            stateNames: stateNamesObj,
            provincesCount: this.maxProvinceId + 1,
            statesCount: this.maxStateId + 1,
            strategicRegionsCount: this.strategicRegions.length,
            countriesCount: this.countries.length
        };
    }
    
    // Load rivers from rivers.bmp
    async loadRivers() {
        const riversPath = path.join(this.workspaceRoot, 'map', 'rivers.bmp');
        if (!fs.existsSync(riversPath)) {
            console.error('rivers.bmp not found');
            this.rivers = null;
            return;
        }
        
        try {
            const buffer = fs.readFileSync(riversPath);
            
            // Parse BMP header
            if (buffer.toString('ascii', 0, 2) !== 'BM') {
                throw new Error('Invalid BMP');
            }
            
            const dataOffset = buffer.readUInt32LE(10);
            const width = buffer.readInt32LE(18);
            const height = Math.abs(buffer.readInt32LE(22));
            const bitsPerPixel = buffer.readUInt16LE(28);
            const isBottomUp = buffer.readInt32LE(22) > 0;
            
            const bytesPerPixel = bitsPerPixel / 8;
            const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
            
            // Extract river pixels (simplified - just store positions)
            const riverPixels = [];
            
            for (let y = 0; y < height; y++) {
                const srcY = isBottomUp ? (height - 1 - y) : y;
                const srcRowOffset = dataOffset + srcY * rowSize;
                
                for (let x = 0; x < width; x++) {
                    const srcPixelOffset = srcRowOffset + x * bytesPerPixel;
                    const b = buffer[srcPixelOffset];
                    const g = buffer[srcPixelOffset + 1];
                    const r = buffer[srcPixelOffset + 2];
                    
                    // Check for river colors (not white, not black)
                    const isWhite = r > 250 && g > 250 && b > 250;
                    const isBlack = r < 5 && g < 5 && b < 5;
                    
                    if (!isWhite && !isBlack) {
                        // Determine river type by color
                        let type = 'flow';
                        if (g > 200 && r < 50 && b < 50) type = 'source';      // Green
                        else if (r > 200 && g < 100 && b > 100) type = 'mouth'; // Magenta
                        else if (r > 200 && g > 200 && b < 50) type = 'merge';  // Yellow
                        
                        riverPixels.push({ x, y, type, r, g, b });
                    }
                }
            }
            
            console.error(`Loaded ${riverPixels.length} river pixels from rivers.bmp`);
            
            this.rivers = {
                width,
                height,
                pixels: riverPixels,
                pixelCount: riverPixels.length
            };
            
        } catch (e) {
            console.error('Failed to load rivers:', e);
            this.rivers = null;
        }
    }
    
    // Load heightmap from heightmap.bmp
    async loadHeightmap() {
        const heightmapPath = path.join(this.workspaceRoot, 'map', 'heightmap.bmp');
        if (!fs.existsSync(heightmapPath)) {
            console.error('heightmap.bmp not found');
            this.heightmap = null;
            return;
        }
        
        try {
            const buffer = fs.readFileSync(heightmapPath);
            
            // Parse BMP header
            if (buffer.toString('ascii', 0, 2) !== 'BM') {
                throw new Error('Invalid BMP');
            }
            
            const dataOffset = buffer.readUInt32LE(10);
            const width = buffer.readInt32LE(18);
            const height = Math.abs(buffer.readInt32LE(22));
            const bitsPerPixel = buffer.readUInt16LE(28);
            const isBottomUp = buffer.readInt32LE(22) > 0;
            
            // Downsample for performance (store every Nth pixel)
            const downsample = Math.max(1, Math.floor(Math.max(width, height) / 1024));
            const dsWidth = Math.ceil(width / downsample);
            const dsHeight = Math.ceil(height / downsample);
            const heightData = new Uint8Array(dsWidth * dsHeight);
            
            let minHeight = 255;
            let maxHeight = 0;
            
            const bytesPerPixel = bitsPerPixel / 8;
            const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
            
            for (let dsY = 0; dsY < dsHeight; dsY++) {
                const y = dsY * downsample;
                const srcY = isBottomUp ? (height - 1 - y) : y;
                const srcRowOffset = dataOffset + srcY * rowSize;
                
                for (let dsX = 0; dsX < dsWidth; dsX++) {
                    const x = dsX * downsample;
                    const srcPixelOffset = srcRowOffset + x * bytesPerPixel;
                    
                    // Use red channel or grayscale value as height
                    let h;
                    if (bitsPerPixel === 8) {
                        h = buffer[srcPixelOffset];
                    } else {
                        // For color BMP, use red channel (common in HOI4)
                        h = buffer[srcPixelOffset + 2]; // R in BGR order
                    }
                    
                    heightData[dsY * dsWidth + dsX] = h;
                    if (h < minHeight) minHeight = h;
                    if (h > maxHeight) maxHeight = h;
                }
            }
            
            console.error(`Loaded heightmap: ${width}x${height} (downsampled to ${dsWidth}x${dsHeight})`);
            
            // Convert to regular array for JSON transfer
            this.heightmap = {
                width: dsWidth,
                height: dsHeight,
                originalWidth: width,
                originalHeight: height,
                downsample,
                minHeight,
                maxHeight,
                data: Array.from(heightData)
            };
            
        } catch (e) {
            console.error('Failed to load heightmap:', e);
            this.heightmap = null;
        }
    }
    // Utility functions for generating new provinces
    generateUniqueColor() {
        const maxAttempts = 100000;
        for (let i = 0; i < maxAttempts; i++) {
            const r = Math.floor(Math.random() * 256);
            const g = Math.floor(Math.random() * 256);
            const b = Math.floor(Math.random() * 256);
            // Avoid very dark or very bright colors
            const sum = r + g + b;
            if (sum < 30 || sum > 720)
                continue;
            const color = packRGB(r, g, b);
            if (!this.colorToProvinceId.has(color)) {
                return { r, g, b };
            }
        }
        throw new Error('Could not generate unique color');
    }
    generateProvinceId() {
        return this.maxProvinceId + 1;
    }
    // Get the raw BMP data for province painting
    getBmpData() {
        if (!this.bmpData)
            return null;
        return {
            data: this.bmpData,
            width: this.mapWidth,
            height: this.mapHeight
        };
    }
    // Update state file with new values
    async updateStateFile(stateId, updates) {
        const state = this.states[stateId];
        if (!state || !state.file)
            return false;
        try {
            let content = await fs.promises.readFile(state.file, 'utf-8');
            // Update manpower
            if (updates.manpower !== undefined) {
                if (content.match(/manpower\s*=\s*\d+/)) {
                    content = content.replace(/manpower\s*=\s*\d+/, `manpower = ${updates.manpower}`);
                }
                else {
                    content = content.replace(/(state_category\s*=\s*\w+)/, `$1\n\tmanpower = ${updates.manpower}`);
                }
                state.manpower = updates.manpower;
            }
            // Update owner
            if (updates.owner !== undefined) {
                const ownerTag = updates.owner.toUpperCase();
                if (content.match(/owner\s*=\s*\w+/)) {
                    content = content.replace(/owner\s*=\s*\w+/, `owner = ${ownerTag}`);
                } else {
                    const histMatch = content.match(/history\s*=\s*\{/);
                    if (histMatch) {
                        const idx = content.indexOf(histMatch[0]) + histMatch[0].length;
                        content = content.slice(0, idx) + `\n\t\towner = ${ownerTag}` + content.slice(idx);
                    }
                }
                state.owner = ownerTag;
            }
            // Update category
            if (updates.category !== undefined) {
                content = content.replace(/state_category\s*=\s*\w+/, `state_category = ${updates.category}`);
                state.category = updates.category;
            }
            // Update resources
            if (updates.resources !== undefined) {
                const resEntries = Object.entries(updates.resources).filter(([, v]) => v > 0);
                if (resEntries.length > 0) {
                    const resLines = resEntries.map(([k, v]) => `\t\t${k} = ${v}`).join('\n');
                    const newBlock = `resources = {\n${resLines}\n\t}`;
                    if (content.match(/resources\s*=\s*\{[^}]*\}/)) {
                        content = content.replace(/resources\s*=\s*\{[^}]*\}/, newBlock);
                    } else {
                        content = content.replace(/\n(\t?)provinces/, `\n\t${newBlock}\n\n$1provinces`);
                    }
                } else {
                    // Remove resources block if all zeroed
                    content = content.replace(/\s*resources\s*=\s*\{[^}]*\}\n?/, '\n');
                }
                state.resources = updates.resources;
            }
            // Add cores
            if (updates.addCores && updates.addCores.length > 0) {
                for (const tag of updates.addCores) {
                    if (!content.includes(`add_core_of = ${tag}`)) {
                        const ownerMatch = content.match(/owner\s*=\s*\w+/);
                        if (ownerMatch) {
                            content = content.replace(ownerMatch[0], `${ownerMatch[0]}\n\t\tadd_core_of = ${tag}`);
                        } else {
                            const histMatch = content.match(/history\s*=\s*\{/);
                            if (histMatch) {
                                const idx = content.indexOf(histMatch[0]) + histMatch[0].length;
                                content = content.slice(0, idx) + `\n\t\tadd_core_of = ${tag}` + content.slice(idx);
                            }
                        }
                    }
                }
                if (!state.cores) state.cores = [];
                state.cores = [...new Set([...state.cores, ...updates.addCores])];
            }
            // Remove cores
            if (updates.removeCores && updates.removeCores.length > 0) {
                for (const tag of updates.removeCores) {
                    content = content.replace(new RegExp(`\\s*add_core_of\\s*=\\s*${tag}\\s*\\n?`), '\n');
                }
                if (state.cores) {
                    state.cores = state.cores.filter(c => !updates.removeCores.includes(c));
                }
            }
            // Update buildings
            if (updates.buildings) {
                for (const [building, value] of Object.entries(updates.buildings)) {
                    const buildingRegex = new RegExp(`(${building})\\s*=\\s*\\d+`);
                    if (content.match(buildingRegex)) {
                        content = content.replace(buildingRegex, `$1 = ${value}`);
                    }
                }
                state.buildings = { ...(state.buildings || {}), ...updates.buildings };
            }
            await fs.promises.writeFile(state.file, content, 'utf-8');
            return true;
        }
        catch (e) {
            console.error('Failed to update state file:', e);
            return false;
        }
    }
    // Move provinces between states (removes from source, adds to target)
    async moveProvincesToState(provinceIds, targetStateId) {
        const target = this.states[targetStateId];
        if (!target || !target.file) return false;
        try {
            // Remove from source states
            const sources = new Set();
            for (const pid of provinceIds) {
                const srcId = this.provinceIdToState.get(pid);
                if (srcId != null && srcId !== targetStateId) sources.add(srcId);
            }
            for (const srcId of sources) {
                const src = this.states[srcId];
                if (!src || !src.file) continue;
                let c = await fs.promises.readFile(src.file, 'utf-8');
                const pm = c.match(/provinces\s*=\s*\{([^}]+)\}/);
                if (pm) {
                    const kept = (pm[1].match(/\d+/g) || []).map(Number).filter(p => !provinceIds.includes(p));
                    c = c.replace(/provinces\s*=\s*\{[^}]+\}/, `provinces = {\n\t\t${kept.join(' ')}\n\t}`);
                    await fs.promises.writeFile(src.file, c, 'utf-8');
                    src.provinces = kept;
                }
            }
            // Add to target state
            let tc = await fs.promises.readFile(target.file, 'utf-8');
            const tpm = tc.match(/provinces\s*=\s*\{([^}]+)\}/);
            if (tpm) {
                const existing = (tpm[1].match(/\d+/g) || []).map(Number);
                const merged = [...new Set([...existing, ...provinceIds])].sort((a, b) => a - b);
                tc = tc.replace(/provinces\s*=\s*\{[^}]+\}/, `provinces = {\n\t\t${merged.join(' ')}\n\t}`);
                await fs.promises.writeFile(target.file, tc, 'utf-8');
                target.provinces = merged;
            }
            // Update index
            for (const pid of provinceIds) {
                this.provinceIdToState.set(pid, targetStateId);
            }
            return true;
        } catch (e) {
            console.error('Failed to move provinces:', e);
            return false;
        }
    }
    // Add a new province to definition.csv
    async addProvinceToDefinition(province) {
        const defPath = path.join(this.workspaceRoot, 'map', 'definition.csv');
        try {
            const line = `\n${province.id};${province.r};${province.g};${province.b};${province.type};${province.coastal};${province.terrain};${province.continent}`;
            await fs.promises.appendFile(defPath, line, 'utf-8');
            // Update internal state
            const color = packRGB(province.r, province.g, province.b);
            this.provinces[province.id] = {
                id: province.id,
                color,
                rgb: { r: province.r, g: province.g, b: province.b },
                type: province.type,
                terrain: province.terrain,
                coastal: province.coastal,
                continent: province.continent,
                boundingBox: { x: 0, y: 0, w: 0, h: 0 },
                coverZones: [],
                centerOfMass: { x: 0, y: 0 },
                edges: [],
                pixelCount: 0
            };
            this.colorToProvinceId.set(color, province.id);
            this.maxProvinceId = Math.max(this.maxProvinceId, province.id);
            return true;
        }
        catch (e) {
            console.error('Failed to add province to definition:', e);
            return false;
        }
    }
    // Update province terrain or continent in definition.csv
    async updateProvinceDefinition(provinceId, updates) {
        const defPath = path.join(this.workspaceRoot, 'map', 'definition.csv');
        try {
            const content = await fs.promises.readFile(defPath, 'utf-8');
            const lines = content.split(/\r?\n/);
            let modified = false;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim() || line.startsWith('#')) continue;
                
                const parts = line.split(';');
                if (parts.length < 8) continue;
                
                const id = parseInt(parts[0], 10);
                if (id !== provinceId) continue;
                
                // Format: id;r;g;b;type;coastal;terrain;continent
                // parts[0] = id
                // parts[1] = r
                // parts[2] = g
                // parts[3] = b
                // parts[4] = type (land/sea/lake)
                // parts[5] = coastal (true/false)
                // parts[6] = terrain (plains/hills/mountain/forest/etc)
                // parts[7] = continent
                
                if (updates.r !== undefined) {
                    parts[1] = String(updates.r);
                }
                if (updates.g !== undefined) {
                    parts[2] = String(updates.g);
                }
                if (updates.b !== undefined) {
                    parts[3] = String(updates.b);
                }
                if (updates.terrain !== undefined) {
                    parts[6] = updates.terrain;  // Fixed: was parts[4], now parts[6]
                }
                if (updates.continent !== undefined) {
                    parts[7] = String(updates.continent);
                }
                if (updates.type !== undefined) {
                    parts[4] = updates.type;  // For changing land/sea/lake
                }
                if (updates.coastal !== undefined) {
                    parts[5] = updates.coastal ? 'true' : 'false';
                }
                
                lines[i] = parts.join(';');
                modified = true;
                
                // Update internal province data
                if (this.provinces[provinceId]) {
                    if (updates.r !== undefined) {
                        this.provinces[provinceId].color = {
                            r: updates.r !== undefined ? updates.r : this.provinces[provinceId].color.r,
                            g: updates.g !== undefined ? updates.g : this.provinces[provinceId].color.g,
                            b: updates.b !== undefined ? updates.b : this.provinces[provinceId].color.b
                        };
                    }
                    if (updates.terrain !== undefined) {
                        this.provinces[provinceId].terrain = updates.terrain;
                    }
                    if (updates.continent !== undefined) {
                        this.provinces[provinceId].continent = updates.continent;
                    }
                    if (updates.type !== undefined) {
                        this.provinces[provinceId].type = updates.type;
                    }
                    if (updates.coastal !== undefined) {
                        this.provinces[provinceId].coastal = updates.coastal;
                    }
                }
                break;
            }
            
            if (modified) {
                await fs.promises.writeFile(defPath, lines.join('\n'), 'utf-8');
                return true;
            }
            return false;
        }
        catch (e) {
            console.error('Failed to update province definition:', e);
            return false;
        }
    }
    // Update naval base in state file
    async updateNavalBase(stateId, provinceId, level) {
        const statesDir = path.join(this.workspaceRoot, 'history', 'states');
        try {
            const files = await fs.promises.readdir(statesDir);
            for (const file of files) {
                if (!file.endsWith('.txt')) continue;
                const filePath = path.join(statesDir, file);
                const content = await fs.promises.readFile(filePath, 'utf-8');
                
                // Check if this is the right state file
                const idMatch = content.match(/^\s*id\s*=\s*(\d+)/m);
                if (!idMatch || parseInt(idMatch[1]) !== stateId) continue;
                
                // Found the right state file
                let newContent = content;
                
                // Look for existing naval_base entry for this province
                const navalBasePattern = new RegExp(`(\\d+)\\s*=\\s*\\{[^}]*naval_base\\s*=\\s*\\d+[^}]*\\}`, 'g');
                const provinceBuildingsPattern = new RegExp(`(${provinceId})\\s*=\\s*\\{([^}]*)\\}`, 'g');
                
                let hasProvince = provinceBuildingsPattern.test(content);
                provinceBuildingsPattern.lastIndex = 0;
                
                if (level === 0) {
                    // Remove naval base
                    if (hasProvince) {
                        newContent = content.replace(
                            new RegExp(`(${provinceId}\\s*=\\s*\\{[^}]*)naval_base\\s*=\\s*\\d+\\s*`, 'g'),
                            '$1'
                        );
                        // Clean up empty province blocks
                        newContent = newContent.replace(
                            new RegExp(`${provinceId}\\s*=\\s*\\{\\s*\\}`, 'g'),
                            ''
                        );
                    }
                } else {
                    // Add or update naval base
                    if (hasProvince) {
                        // Check if naval_base already exists
                        const existingNB = content.match(new RegExp(`${provinceId}\\s*=\\s*\\{[^}]*naval_base\\s*=\\s*(\\d+)`));
                        if (existingNB) {
                            // Update existing
                            newContent = content.replace(
                                new RegExp(`(${provinceId}\\s*=\\s*\\{[^}]*naval_base\\s*=\\s*)\\d+`),
                                `$1${level}`
                            );
                        } else {
                            // Add to existing province block
                            newContent = content.replace(
                                new RegExp(`(${provinceId}\\s*=\\s*\\{)([^}]*)(\\})`),
                                `$1$2 naval_base = ${level} $3`
                            );
                        }
                    } else {
                        // Need to add province buildings block
                        // Find the buildings section or create it
                        const buildingsMatch = content.match(/buildings\s*=\s*\{/);
                        if (buildingsMatch) {
                            // Add province to existing buildings section
                            newContent = content.replace(
                                /(buildings\s*=\s*\{)/,
                                `$1\n\t\t\t${provinceId} = { naval_base = ${level} }`
                            );
                        } else {
                            // Need to create buildings section - add after provinces
                            newContent = content.replace(
                                /(provinces\s*=\s*\{[^}]+\})/,
                                `$1\n\n\tbuildings = {\n\t\t${provinceId} = { naval_base = ${level} }\n\t}`
                            );
                        }
                    }
                }
                
                if (newContent !== content) {
                    await fs.promises.writeFile(filePath, newContent, 'utf-8');
                    return true;
                }
                return false;
            }
            return false;
        }
        catch (e) {
            console.error('Failed to update naval base:', e);
            return false;
        }
    }
    // Paint pixels to provinces.bmp
    async paintProvinceToBmp(pixels, color) {
        if (!this.bmpData)
            return false;
        const bmpPath = path.join(this.workspaceRoot, 'map', 'provinces.bmp');
        try {
            const buffer = await fs.promises.readFile(bmpPath);
            const dataOffset = buffer.readUInt32LE(10);
            const width = buffer.readInt32LE(18);
            const height = Math.abs(buffer.readInt32LE(22));
            const rowStride = Math.ceil((width * 3) / 4) * 4;
            // Paint each pixel (remember BMP is BGR and bottom-up)
            for (const p of pixels) {
                const srcY = height - 1 - p.y;
                const offset = dataOffset + srcY * rowStride + p.x * 3;
                buffer[offset] = color.b; // B
                buffer[offset + 1] = color.g; // G
                buffer[offset + 2] = color.r; // R
                // Also update internal bmpData
                const internalOffset = (p.y * width + p.x) * 3;
                this.bmpData[internalOffset] = color.r;
                this.bmpData[internalOffset + 1] = color.g;
                this.bmpData[internalOffset + 2] = color.b;
            }
            await fs.promises.writeFile(bmpPath, buffer);
            return true;
        }
        catch (e) {
            console.error('Failed to paint province to BMP:', e);
            return false;
        }
    }
    // Update localization file
    async updateLocalization(key, value, language = 'english') {
        const locDir = path.join(this.workspaceRoot, 'localisation', language);
        const locFile = path.join(locDir, 'state_names_l_english.yml');
        try {
            // Ensure directory exists
            if (!fs.existsSync(locDir)) {
                await fs.promises.mkdir(locDir, { recursive: true });
            }
            let content = '';
            if (fs.existsSync(locFile)) {
                content = await fs.promises.readFile(locFile, 'utf-8');
            }
            else {
                content = 'l_english:\n';
            }
            const keyRegex = new RegExp(`^\\s*${key}:\\d*\\s*"[^"]*"`, 'm');
            const newLine = ` ${key}:0 "${value}"`;
            if (content.match(keyRegex)) {
                content = content.replace(keyRegex, newLine);
            }
            else {
                content = content.trimEnd() + '\n' + newLine + '\n';
            }
            await fs.promises.writeFile(locFile, content, 'utf-8');
            return true;
        }
        catch (e) {
            console.error('Failed to update localization:', e);
            return false;
        }
    }
    // Create a new state file
    async createStateFile(state) {
        const statesDir = path.join(this.workspaceRoot, 'history', 'states');
        try {
            // Ensure directory exists
            if (!fs.existsSync(statesDir)) {
                await fs.promises.mkdir(statesDir, { recursive: true });
            }
            
            // First, remove these provinces from any existing states
            const provincesToMove = new Set(state.provinces);
            const affectedStates = new Map(); // stateId -> state object
            
            for (const provinceId of state.provinces) {
                const existingStateId = this.provinceIdToState.get(provinceId);
                if (existingStateId !== undefined && existingStateId !== state.id) {
                    const existingState = this.states[existingStateId];
                    if (existingState && !affectedStates.has(existingStateId)) {
                        affectedStates.set(existingStateId, existingState);
                    }
                }
            }
            
            // Update affected state files to remove the provinces
            // Also collect victory points to transfer
            const transferredVictoryPoints = {}; // provinceId -> value
            
            for (const [stateId, existingState] of affectedStates) {
                if (existingState.file && fs.existsSync(existingState.file)) {
                    try {
                        let content = await fs.promises.readFile(existingState.file, 'utf-8');
                        
                        // Collect victory points for provinces being moved
                        if (existingState.victoryPoints) {
                            for (const provinceId of provincesToMove) {
                                if (existingState.victoryPoints[provinceId] !== undefined) {
                                    transferredVictoryPoints[provinceId] = existingState.victoryPoints[provinceId];
                                    // Remove the VP from the old state's internal data
                                    delete existingState.victoryPoints[provinceId];
                                }
                            }
                        }
                        
                        // Remove victory_points lines for provinces being moved
                        for (const provinceId of provincesToMove) {
                            const vpRegex = new RegExp(`\\s*victory_points\\s*=\\s*\\{\\s*${provinceId}\\s+\\d+\\s*\\}`, 'g');
                            content = content.replace(vpRegex, '');
                        }
                        
                        // Find and update the provinces block
                        const provincesMatch = content.match(/provinces\s*=\s*\{([^}]*)\}/s);
                        if (provincesMatch) {
                            const oldProvincesStr = provincesMatch[1];
                            const oldProvinces = oldProvincesStr.match(/\d+/g) || [];
                            const newProvinces = oldProvinces.filter(p => !provincesToMove.has(parseInt(p, 10)));
                            
                            if (newProvinces.length > 0) {
                                // Update the state file with remaining provinces
                                const newProvincesBlock = 'provinces = {\n\t\t' + newProvinces.join(' ') + '\n\t}';
                                content = content.replace(/provinces\s*=\s*\{[^}]*\}/s, newProvincesBlock);
                                await fs.promises.writeFile(existingState.file, content, 'utf-8');
                                
                                // Update internal state
                                existingState.provinces = newProvinces.map(p => parseInt(p, 10));
                            } else {
                                // No provinces left - optionally delete the state file or leave empty
                                // For safety, we'll leave it with a comment
                                content = content.replace(/provinces\s*=\s*\{[^}]*\}/s, 
                                    'provinces = {\n\t\t# All provinces moved to state ' + state.id + '\n\t}');
                                await fs.promises.writeFile(existingState.file, content, 'utf-8');
                                existingState.provinces = [];
                            }
                        }
                    } catch (e) {
                        console.error('Failed to update state ' + stateId + ':', e);
                    }
                }
            }
            
            // Build victory points block for new state
            let vpBlock = '';
            const vpCount = Object.keys(transferredVictoryPoints).length;
            if (vpCount > 0) {
                for (const [provinceId, value] of Object.entries(transferredVictoryPoints)) {
                    vpBlock += `\n\t\tvictory_points = { ${provinceId} ${value} }`;
                }
                console.error(`Transferred ${vpCount} victory points to new state ${state.id}`);
            }
            
            // Now create the new state file
            const fileName = `${state.id}-${state.name.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
            const filePath = path.join(statesDir, fileName);
            const provincesStr = state.provinces.join(' ');
            const ownerTag = state.owner ? state.owner.toUpperCase() : '';
            let historyLines = '';
            if (ownerTag) {
                historyLines += '\t\towner = ' + ownerTag + '\n';
                historyLines += '\t\tadd_core_of = ' + ownerTag + '\n';
            }
            historyLines += '\t\tbuildings = {\n\t\t\tinfrastructure = 1\n\t\t}';
            historyLines += vpBlock;

            const content = `state = {
	id = ${state.id}
	name = "STATE_${state.id}"
	manpower = ${state.manpower || 0}
	
	state_category = ${state.category || 'rural'}
	
	history = {
${historyLines}
	}
	
	local_supplies = 0.0
	buildings_max_level_factor = 1.000
	
	provinces = {
		${provincesStr}
	}
}
`;
            await fs.promises.writeFile(filePath, content, 'utf-8');
            // Also add localization
            await this.updateLocalization(`STATE_${state.id}`, state.name);
            // Update internal state
            this.states[state.id] = {
                id: state.id,
                name: state.name,
                provinces: state.provinces,
                manpower: state.manpower || 0,
                category: state.category || 'rural',
                owner: state.owner,
                cores: [],
                victoryPoints: transferredVictoryPoints,
                resources: {},
                impassable: false,
                file: filePath,
                buildings: { infrastructure: 1 }
            };
            // Update province to state mapping
            for (const provinceId of state.provinces) {
                this.provinceIdToState.set(provinceId, state.id);
            }
            this.maxStateId = Math.max(this.maxStateId, state.id);
            
            // Return result with info about transferred VPs
            return {
                success: true,
                transferredVPs: transferredVictoryPoints,
                vpCount: Object.keys(transferredVictoryPoints).length
            };
        }
        catch (e) {
            console.error('Failed to create state file:', e);
            return { success: false, error: e.message };
        }
    }
    // Get next available state ID
    getNextStateId() {
        return this.maxStateId + 1;
    }
    
    // Add or update a victory point in a state file
    async addVictoryPoint(stateId, provinceId, value) {
        try {
            const state = this.states[stateId];
            if (!state || !state.file) {
                throw new Error(`State ${stateId} not found`);
            }
            
            let content = await fs.promises.readFile(state.file, 'utf-8');
            
            // Check if victory_points block exists for this province
            const existingVPRegex = new RegExp(`victory_points\\s*=\\s*\\{\\s*${provinceId}\\s+\\d+\\s*\\}`, 'g');
            
            if (existingVPRegex.test(content)) {
                // Update existing victory point
                content = content.replace(existingVPRegex, `victory_points = { ${provinceId} ${value} }`);
            } else {
                // Add new victory point - find history block
                const historyMatch = content.match(/history\s*=\s*\{/);
                if (historyMatch) {
                    const historyIndex = content.indexOf(historyMatch[0]) + historyMatch[0].length;
                    content = content.slice(0, historyIndex) + `\n\t\tvictory_points = { ${provinceId} ${value} }` + content.slice(historyIndex);
                } else {
                    // No history block, add before closing brace
                    const lastBrace = content.lastIndexOf('}');
                    if (lastBrace > 0) {
                        content = content.slice(0, lastBrace) + `\n\thistory = {\n\t\tvictory_points = { ${provinceId} ${value} }\n\t}\n` + content.slice(lastBrace);
                    }
                }
            }
            
            await fs.promises.writeFile(state.file, content, 'utf-8');
            
            // Update internal state
            if (!state.victoryPoints) state.victoryPoints = {};
            state.victoryPoints[provinceId] = value;
            
            return true;
        } catch (e) {
            console.error('Failed to add victory point:', e);
            return false;
        }
    }
    
    // Remove a victory point from a state file
    async removeVictoryPoint(stateId, provinceId) {
        try {
            const state = this.states[stateId];
            if (!state || !state.file) {
                throw new Error(`State ${stateId} not found`);
            }
            
            let content = await fs.promises.readFile(state.file, 'utf-8');
            
            // Remove the victory_points line for this province
            const vpRegex = new RegExp(`\\s*victory_points\\s*=\\s*\\{\\s*${provinceId}\\s+\\d+\\s*\\}`, 'g');
            content = content.replace(vpRegex, '');
            
            await fs.promises.writeFile(state.file, content, 'utf-8');
            
            // Update internal state
            if (state.victoryPoints) {
                delete state.victoryPoints[provinceId];
            }
            
            return true;
        } catch (e) {
            console.error('Failed to remove victory point:', e);
            return false;
        }
    }
    
    // Load victory point names from localization
    async loadVictoryPointNames() {
        const vpNames = {};
        const locPaths = [
            path.join(this.workspaceRoot, 'localisation', 'english', 'victory_points_l_english.yml'),
            path.join(this.workspaceRoot, 'localisation', 'victory_points_l_english.yml'),
            path.join(this.workspaceRoot, 'localization', 'english', 'victory_points_l_english.yml'),
            path.join(this.workspaceRoot, 'localization', 'victory_points_l_english.yml')
        ];
        
        for (const locPath of locPaths) {
            if (fs.existsSync(locPath)) {
                try {
                    const content = await fs.promises.readFile(locPath, 'utf-8');
                    const lines = content.split(/\\r?\\n/);
                    for (const line of lines) {
                        // Format: VICTORY_POINTS_1234:0 "Name"
                        const match = line.match(/VICTORY_POINTS_(\\d+):\\d*\\s*"([^"]+)"/);
                        if (match) {
                            vpNames[parseInt(match[1], 10)] = match[2];
                        }
                    }
                } catch (e) {
                    // Skip files that can't be read
                }
            }
        }
        
        return vpNames;
    }

    // ── Phase 3: Additional Write Methods ──

    /**
     * Save all railways back to map/railways.txt
     */
    async saveRailways() {
        const railwaysFile = path.join(this.workspaceRoot, 'map', 'railways.txt');
        const lines = ['# Railways - Level Count Province1 Province2 ...'];
        for (const rail of this.railways) {
            lines.push(`${rail.level} ${rail.provinces.length} ${rail.provinces.join(' ')}`);
        }
        await fs.promises.writeFile(railwaysFile, lines.join('\n') + '\n', 'utf-8');
    }

    /**
     * Add a railway connection
     */
    async addRailway(level, provinces) {
        if (!Array.isArray(provinces) || provinces.length < 2) return { error: 'Railway needs at least 2 provinces' };
        if (level < 1 || level > 5) return { error: 'Railway level must be 1-5' };
        this.railways.push({ level, provinces });
        await this.saveRailways();
        return { success: true, index: this.railways.length - 1 };
    }

    /**
     * Remove a railway by index
     */
    async removeRailway(index) {
        if (index < 0 || index >= this.railways.length) return { error: 'Invalid railway index' };
        const removed = this.railways.splice(index, 1)[0];
        await this.saveRailways();
        return { success: true, removed };
    }

    /**
     * Update railway level
     */
    async updateRailwayLevel(index, level) {
        if (index < 0 || index >= this.railways.length) return { error: 'Invalid railway index' };
        if (level < 1 || level > 5) return { error: 'Railway level must be 1-5' };
        this.railways[index].level = level;
        await this.saveRailways();
        return { success: true };
    }

    /**
     * Save all supply nodes back to map/supply_nodes.txt
     */
    async saveSupplyNodes() {
        const nodesFile = path.join(this.workspaceRoot, 'map', 'supply_nodes.txt');
        const lines = ['# Supply nodes - Level Province'];
        for (const node of this.supplyNodes) {
            lines.push(`${node.level} ${node.province}`);
        }
        await fs.promises.writeFile(nodesFile, lines.join('\n') + '\n', 'utf-8');
    }

    /**
     * Add a supply node
     */
    async addSupplyNode(level, province) {
        if (level < 1 || level > 10) return { error: 'Supply node level must be 1-10' };
        // Check if province already has a supply node
        const existing = this.supplyNodes.findIndex(n => n.province === province);
        if (existing >= 0) {
            this.supplyNodes[existing].level = level;
        } else {
            this.supplyNodes.push({ level, province });
        }
        await this.saveSupplyNodes();
        return { success: true };
    }

    /**
     * Remove a supply node
     */
    async removeSupplyNode(province) {
        const idx = this.supplyNodes.findIndex(n => n.province === province);
        if (idx < 0) return { error: `No supply node at province ${province}` };
        this.supplyNodes.splice(idx, 1);
        await this.saveSupplyNodes();
        return { success: true };
    }

    /**
     * Update a strategic region file
     */
    async updateStrategicRegion(regionId, updates) {
        const region = this.strategicRegions[regionId];
        if (!region || !region.file) return { error: `Strategic region ${regionId} not found` };
        try {
            let content = await fs.promises.readFile(region.file, 'utf-8');
            if (updates.name !== undefined) {
                content = content.replace(/name\s*=\s*"?[^"\n}]+"?/, `name = "${updates.name}"`);
                region.name = updates.name;
            }
            if (updates.provinces !== undefined) {
                const provStr = updates.provinces.join(' ');
                content = content.replace(/provinces\s*=\s*\{[^}]*\}/, `provinces = {\n\t\t${provStr}\n\t}`);
                region.provinces = updates.provinces;
            }
            if (updates.naval_terrain !== undefined) {
                if (updates.naval_terrain === null || updates.naval_terrain === '') {
                    content = content.replace(/\s*naval_terrain\s*=\s*\w+/, '');
                    region.navalTerrain = undefined;
                } else if (content.match(/naval_terrain\s*=\s*\w+/)) {
                    content = content.replace(/naval_terrain\s*=\s*\w+/, `naval_terrain = ${updates.naval_terrain}`);
                    region.navalTerrain = updates.naval_terrain;
                } else {
                    // Add after provinces block
                    content = content.replace(/(provinces\s*=\s*\{[^}]*\})/, `$1\n\tnaval_terrain = ${updates.naval_terrain}`);
                    region.navalTerrain = updates.naval_terrain;
                }
            }
            await fs.promises.writeFile(region.file, content, 'utf-8');
            region.centerOfMass = this.calculateRegionCenterOfMass(region);
            return { success: true };
        } catch (e) {
            return { error: e.message };
        }
    }

    /**
     * Create a backup of key files before write operations
     */
    async createBackup(label) {
        const backupDir = path.join(this.workspaceRoot, '.mcp_backups', label || Date.now().toString());
        await fs.promises.mkdir(backupDir, { recursive: true });
        const files = [
            ['map/railways.txt', 'railways.txt'],
            ['map/supply_nodes.txt', 'supply_nodes.txt'],
            ['map/definition.csv', 'definition.csv']
        ];
        for (const [src, dst] of files) {
            const srcPath = path.join(this.workspaceRoot, src);
            if (fs.existsSync(srcPath)) {
                await fs.promises.copyFile(srcPath, path.join(backupDir, dst));
            }
        }
        // Backup state files
        const statesDir = path.join(this.workspaceRoot, 'history', 'states');
        const statesBackup = path.join(backupDir, 'states');
        if (fs.existsSync(statesDir)) {
            await fs.promises.mkdir(statesBackup, { recursive: true });
            const stateFiles = await fs.promises.readdir(statesDir);
            for (const f of stateFiles) {
                if (f.endsWith('.txt')) {
                    await fs.promises.copyFile(path.join(statesDir, f), path.join(statesBackup, f));
                }
            }
        }
        // Backup strategic regions
        const regionsDir = path.join(this.workspaceRoot, 'map', 'strategicregions');
        const regionsBackup = path.join(backupDir, 'strategicregions');
        if (fs.existsSync(regionsDir)) {
            await fs.promises.mkdir(regionsBackup, { recursive: true });
            const regionFiles = await fs.promises.readdir(regionsDir);
            for (const f of regionFiles) {
                if (f.endsWith('.txt')) {
                    await fs.promises.copyFile(path.join(regionsDir, f), path.join(regionsBackup, f));
                }
            }
        }
        return backupDir;
    }
}
exports.MapDataLoader = MapDataLoader;
//# sourceMappingURL=mapDataLoader.js.map