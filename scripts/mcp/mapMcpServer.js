"use strict";
/**
 * HOI4 Map MCP Server - Phase 1: Query Tools
 * 
 * Exposes HOI4 map data via Model Context Protocol for AI tools
 * (Claude Code, ClawdBot, VS Code Copilot) to query and reason about.
 * 
 * Usage:
 *   Standalone:  node mapMcpServer.js /path/to/hoi4/mod
 *   Via extension: spawned as child process with workspace path
 */

const path = require('path');
const fs = require('fs');

// MCP SDK is optional - only needed when running as standalone MCP server
let Server, StdioServerTransport;
let ListToolsRequestSchema, CallToolRequestSchema;
let mcpAvailable = false;
try {
    Server = require('@modelcontextprotocol/sdk/server').Server;
    // Load StdioServerTransport from direct file path (not in exports map)
    const sdkServerDir = path.dirname(require.resolve('@modelcontextprotocol/sdk/server'));
    StdioServerTransport = require(path.join(sdkServerDir, 'stdio.js')).StdioServerTransport;
    // Load request schemas (needed for setRequestHandler in SDK 1.x+)
    const types = require(path.join(sdkServerDir, '..', 'types.js'));
    ListToolsRequestSchema = types.ListToolsRequestSchema;
    CallToolRequestSchema = types.CallToolRequestSchema;
    mcpAvailable = true;
} catch (e) {
    // MCP SDK not installed - tools still work via direct API, just no stdio server
}

const { MapDataLoader } = require('./mapDataLoader');

// Phase 5: Clausewitz Script Intelligence
const { parseClausewitz, ModIndexer, getWikiDB, analyzeScope } = require('./clausewitzMcp');

// Image-to-Map Converter
let ImageToMapConverter;
try { ImageToMapConverter = require('./imageToMap').ImageToMapConverter; } catch (e) { ImageToMapConverter = null; }

// Sharp is optional - only needed for image snapshot tools
let sharp;
let sharpAvailable = false;
try {
    sharp = require('sharp');
    sharpAvailable = true;
} catch (e) {
    // Sharp not installed - snapshot tools will return helpful error
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'map_get_summary',
        description: 'Get high-level map statistics: dimensions, province/state/region counts, feature availability. Call this first to understand the map scope.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'map_get_province',
        description: 'Get full details for a province by ID: RGB color, type (land/sea/lake), terrain, coastal status, continent, center position, pixel count, adjacent provinces, state membership, strategic region, victory points.',
        inputSchema: {
            type: 'object',
            properties: {
                province_id: { type: 'number', description: 'Province ID to look up' }
            },
            required: ['province_id']
        }
    },
    {
        name: 'map_search_provinces',
        description: 'Search provinces by criteria. Returns matching province IDs with summary data. Use filters to narrow results. Omit a filter to not filter on that field.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['land', 'sea', 'lake'], description: 'Province type filter' },
                terrain: { type: 'string', description: 'Terrain type (plains, forest, mountain, marsh, desert, jungle, hills, urban, etc.)' },
                coastal: { type: 'boolean', description: 'Filter by coastal status' },
                continent: { type: 'number', description: 'Continent ID filter' },
                state_id: { type: 'number', description: 'Only provinces in this state' },
                strategic_region_id: { type: 'number', description: 'Only provinces in this strategic region' },
                min_pixels: { type: 'number', description: 'Minimum pixel count (province size)' },
                has_victory_points: { type: 'boolean', description: 'Only provinces with victory points' },
                adjacent_to: { type: 'number', description: 'Only provinces adjacent to this province ID' },
                limit: { type: 'number', description: 'Max results to return (default 100)' }
            },
            required: []
        }
    },
    {
        name: 'map_get_state',
        description: 'Get full state data: name, owner, manpower, category, provinces, resources, victory points, buildings, cores, and center of mass position.',
        inputSchema: {
            type: 'object',
            properties: {
                state_id: { type: 'number', description: 'State ID to look up' }
            },
            required: ['state_id']
        }
    },
    {
        name: 'map_search_states',
        description: 'Search states by criteria. Returns matching states with summary data.',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Country TAG filter (e.g., GER, FRA, ENG)' },
                category: { type: 'string', description: 'State category (wasteland, enclave, tiny_island, pastoral, rural, town, large_town, city, large_city, metropolis, megalopolis)' },
                has_resource: { type: 'string', description: 'Only states with this resource (oil, aluminium, rubber, tungsten, steel, chromium)' },
                min_manpower: { type: 'number', description: 'Minimum manpower' },
                has_core: { type: 'string', description: 'Only states where this TAG has a core' },
                min_victory_points: { type: 'number', description: 'Minimum total victory points in state' },
                impassable: { type: 'boolean', description: 'Filter by impassable status' },
                limit: { type: 'number', description: 'Max results (default 100)' }
            },
            required: []
        }
    },
    {
        name: 'map_get_strategic_region',
        description: 'Get strategic region data: name, provinces, naval terrain, center position.',
        inputSchema: {
            type: 'object',
            properties: {
                region_id: { type: 'number', description: 'Strategic region ID' }
            },
            required: ['region_id']
        }
    },
    {
        name: 'map_get_adjacencies',
        description: 'Get all provinces adjacent to a given province, with border pixel counts. Useful for understanding connectivity and finding border provinces.',
        inputSchema: {
            type: 'object',
            properties: {
                province_id: { type: 'number', description: 'Province ID to get adjacencies for' },
                include_sea: { type: 'boolean', description: 'Include sea province adjacencies (default true)' }
            },
            required: ['province_id']
        }
    },
    {
        name: 'map_get_supply_network',
        description: 'Get railways and supply nodes. Optionally filter by state or bounding box. Returns railway routes (level + province chain) and supply hub locations.',
        inputSchema: {
            type: 'object',
            properties: {
                state_id: { type: 'number', description: 'Only supply infrastructure in/through this state' },
                province_id: { type: 'number', description: 'Only railways passing through this province' },
                bounding_box: {
                    type: 'object',
                    description: 'Geographic filter: only infrastructure in this area',
                    properties: {
                        x1: { type: 'number' }, y1: { type: 'number' },
                        x2: { type: 'number' }, y2: { type: 'number' }
                    }
                }
            },
            required: []
        }
    },
    {
        name: 'map_get_countries',
        description: 'List all countries with their TAG and color. Optionally get owned states for a specific country.',
        inputSchema: {
            type: 'object',
            properties: {
                tag: { type: 'string', description: 'If provided, returns detailed info for this country including all owned states' }
            },
            required: []
        }
    },
    {
        name: 'map_validate',
        description: 'Run validation checks on the map. Returns errors and warnings about orphan provinces, missing data, disconnected railways, etc.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', enum: ['all', 'provinces', 'states', 'supply', 'adjacency'], description: 'Validation category (default: all)' }
            },
            required: []
        }
    },
    {
        name: 'map_get_terrain_info',
        description: 'Get available terrain types and their distribution across the map.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'map_render_ascii',
        description: 'Render an ASCII art visualization of a map area showing state IDs, province types, or terrain. Useful for spatial reasoning in text-only environments.',
        inputSchema: {
            type: 'object',
            properties: {
                center_province: { type: 'number', description: 'Center the view on this province' },
                center: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'Center coordinates (alternative to center_province)' },
                radius: { type: 'number', description: 'Radius in map pixels (default 30)' },
                view: { type: 'string', enum: ['states', 'provinces', 'terrain', 'type'], description: 'What to display (default: states)' },
                sample_step: { type: 'number', description: 'Sample every N pixels (default 4, higher = more zoomed out)' }
            },
            required: []
        }
    },
    // ── Phase 2: Snapshot/Visualization Tools ──
    {
        name: 'map_render_snapshot',
        description: 'Render a PNG image of a map area. Returns base64-encoded PNG. Supports multiple view modes (political/terrain/provinces/type/manpower/industry/victory_points), zoom levels, province/state highlighting, borders, labels, and railway overlays. Use this to visually inspect map areas.',
        inputSchema: {
            type: 'object',
            properties: {
                center_province: { type: 'number', description: 'Center the view on this province ID' },
                center_state: { type: 'number', description: 'Center the view on this state (auto-calculates center and zoom)' },
                center: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'Center coordinates (alternative to center_province/state)' },
                zoom: { type: 'number', description: 'Pixels per map pixel (default 2, range 1-8). Higher = more zoomed in' },
                width: { type: 'number', description: 'Output image width in pixels (default 800, max 2000)' },
                height: { type: 'number', description: 'Output image height in pixels (default 600, max 1500)' },
                view: { type: 'string', enum: ['political', 'terrain', 'provinces', 'type', 'manpower', 'industry', 'victory_points', 'state_category'], description: 'Color mode (default: political)' },
                show_borders: { type: 'boolean', description: 'Show state borders as white lines (default true)' },
                show_labels: { type: 'boolean', description: 'Show state names/IDs as text labels (default false)' },
                show_railways: { type: 'boolean', description: 'Show railway connections (default false)' },
                show_supply_nodes: { type: 'boolean', description: 'Show supply hub markers (default false)' },
                highlights: {
                    type: 'array',
                    description: 'Highlight specific provinces or states with custom colors',
                    items: {
                        type: 'object',
                        properties: {
                            province_id: { type: 'number' },
                            state_id: { type: 'number' },
                            color: { type: 'string', description: 'Hex color like #ff0000' },
                            outline: { type: 'boolean', description: 'Only outline, do not fill (default false)' },
                            label: { type: 'string', description: 'Text label to display' }
                        }
                    }
                }
            },
            required: []
        }
    },
    {
        name: 'map_render_state_view',
        description: 'Render a focused view of a specific state with its provinces highlighted, neighbors visible, and key info labeled. Convenience wrapper around map_render_snapshot.',
        inputSchema: {
            type: 'object',
            properties: {
                state_id: { type: 'number', description: 'State to focus on' },
                padding: { type: 'number', description: 'Extra pixels of padding around the state (default 20)' },
                show_neighbors: { type: 'boolean', description: 'Show neighboring states dimmed (default true)' },
                show_railways: { type: 'boolean', description: 'Show railways in the area (default true)' },
                show_details: { type: 'boolean', description: 'Label provinces with IDs and victory points (default true)' }
            },
            required: ['state_id']
        }
    },
    {
        name: 'map_render_minimap',
        description: 'Render a full-map overview at low resolution with optional highlighted areas. Great for getting spatial context before zooming in.',
        inputSchema: {
            type: 'object',
            properties: {
                width: { type: 'number', description: 'Output width (default 800)' },
                view: { type: 'string', enum: ['political', 'terrain', 'type'], description: 'Color mode (default: political)' },
                highlight_states: { type: 'array', items: { type: 'number' }, description: 'State IDs to highlight with bright outlines' },
                highlight_provinces: { type: 'array', items: { type: 'number' }, description: 'Province IDs to highlight' }
            },
            required: []
        }
    },
    // ── Phase 3: Write Tools ──
    {
        name: 'map_edit_state',
        description: 'Edit a state\'s properties: owner, manpower, category, resources, buildings, cores. Creates a backup before writing. Returns the updated state data.',
        inputSchema: {
            type: 'object',
            properties: {
                state_id: { type: 'number', description: 'State ID to edit' },
                owner: { type: 'string', description: 'New owner country TAG (e.g. GER, FRA)' },
                manpower: { type: 'number', description: 'New manpower value' },
                category: { type: 'string', description: 'State category (rural, town, city, large_city, metropolis, etc.)' },
                resources: { type: 'object', description: 'Resources object, e.g. {"steel": 10, "oil": 5}. Set to 0 to remove.' },
                buildings: { type: 'object', description: 'Buildings to update, e.g. {"infrastructure": 5, "arms_factory": 2}' },
                add_cores: { type: 'array', items: { type: 'string' }, description: 'Country TAGs to add as cores' },
                remove_cores: { type: 'array', items: { type: 'string' }, description: 'Country TAGs to remove from cores' }
            },
            required: ['state_id']
        }
    },
    {
        name: 'map_create_state',
        description: 'Create a new state from a list of provinces. Provinces are automatically removed from their current states. Victory points transfer automatically. Creates backup first.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'State name (e.g. "New Munich")' },
                provinces: { type: 'array', items: { type: 'number' }, description: 'Province IDs to include' },
                owner: { type: 'string', description: 'Owner country TAG' },
                manpower: { type: 'number', description: 'Manpower (default 0)' },
                category: { type: 'string', description: 'State category (default rural)' },
                state_id: { type: 'number', description: 'Specific state ID (default: auto-assign next available)' }
            },
            required: ['name', 'provinces']
        }
    },
    {
        name: 'map_transfer_provinces',
        description: 'Move provinces from their current state(s) to a target state. Updates all affected state files. Creates backup first.',
        inputSchema: {
            type: 'object',
            properties: {
                province_ids: { type: 'array', items: { type: 'number' }, description: 'Province IDs to move' },
                target_state_id: { type: 'number', description: 'Destination state ID' }
            },
            required: ['province_ids', 'target_state_id']
        }
    },
    {
        name: 'map_edit_victory_point',
        description: 'Add, update, or remove a victory point. Set value to 0 to remove.',
        inputSchema: {
            type: 'object',
            properties: {
                province_id: { type: 'number', description: 'Province ID for the victory point' },
                value: { type: 'number', description: 'VP value (0 to remove)' },
                state_id: { type: 'number', description: 'State ID (auto-detected from province if omitted)' }
            },
            required: ['province_id', 'value']
        }
    },
    {
        name: 'map_edit_railway',
        description: 'Add, remove, or update railways. Use action: "add" to create, "remove" to delete by index, "update_level" to change level.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['add', 'remove', 'update_level', 'list'], description: 'Operation to perform' },
                level: { type: 'number', description: 'Railway level 1-5 (for add/update_level)' },
                provinces: { type: 'array', items: { type: 'number' }, description: 'Province chain for new railway (for add)' },
                index: { type: 'number', description: 'Railway index (for remove/update_level). Use map_get_supply_network to find indices.' }
            },
            required: ['action']
        }
    },
    {
        name: 'map_edit_supply_node',
        description: 'Add, remove, or update supply nodes (supply hubs).',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['add', 'remove'], description: 'Operation to perform' },
                province_id: { type: 'number', description: 'Province ID for the supply node' },
                level: { type: 'number', description: 'Supply node level 1-10 (for add, default 1)' }
            },
            required: ['action', 'province_id']
        }
    },
    {
        name: 'map_edit_strategic_region',
        description: 'Edit a strategic region\'s properties: name, provinces, naval terrain.',
        inputSchema: {
            type: 'object',
            properties: {
                region_id: { type: 'number', description: 'Strategic region ID' },
                name: { type: 'string', description: 'New region name' },
                provinces: { type: 'array', items: { type: 'number' }, description: 'New province list (replaces existing)' },
                naval_terrain: { type: 'string', description: 'Naval terrain type (null to remove)' }
            },
            required: ['region_id']
        }
    },
    {
        name: 'map_edit_province',
        description: 'Edit province definition properties: type, terrain, coastal, continent.',
        inputSchema: {
            type: 'object',
            properties: {
                province_id: { type: 'number', description: 'Province ID' },
                type: { type: 'string', enum: ['land', 'sea', 'lake'], description: 'Province type' },
                terrain: { type: 'string', description: 'Terrain type (e.g. plains, forest, mountain)' },
                coastal: { type: 'boolean', description: 'Whether the province is coastal' },
                continent: { type: 'number', description: 'Continent ID' }
            },
            required: ['province_id']
        }
    },
    {
        name: 'map_bulk_edit',
        description: 'Perform multiple edit operations in a single call. Creates one backup for the entire batch. Each operation is an object with "tool" (tool name without map_ prefix) and "args".',
        inputSchema: {
            type: 'object',
            properties: {
                operations: {
                    type: 'array',
                    description: 'Array of operations: [{tool: "edit_state", args: {state_id: 1, owner: "GER"}}, ...]',
                    items: {
                        type: 'object',
                        properties: {
                            tool: { type: 'string', description: 'Tool name without map_ prefix' },
                            args: { type: 'object', description: 'Arguments for the tool' }
                        },
                        required: ['tool', 'args']
                    }
                },
                dry_run: { type: 'boolean', description: 'If true, validate but do not apply changes (default false)' }
            },
            required: ['operations']
        }
    },
    {
        name: 'map_create_backup',
        description: 'Create a manual backup of all map files (states, railways, supply nodes, strategic regions, definitions). Returns the backup directory path.',
        inputSchema: {
            type: 'object',
            properties: {
                label: { type: 'string', description: 'Optional label for the backup (default: timestamp)' }
            },
            required: []
        }
    },
    // ── Phase 5: Clausewitz Script Intelligence ──
    {
        name: 'script_parse_file',
        description: 'Parse a Clausewitz .txt file into a structured AST. Returns blocks, key-value pairs, and comments. Use for understanding file structure.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Relative file path from mod root (e.g. "events/hl2_events.txt")' },
                max_depth: { type: 'number', description: 'Maximum nesting depth to return (default: unlimited)' }
            },
            required: ['file']
        }
    },
    {
        name: 'script_search',
        description: 'Search across all mod files for a pattern (regex supported). Returns matching lines with file, line number, and context. Like grep across the entire mod.',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Search pattern (regex supported). E.g. "has_idea = combine_occupation", "country_event.*hl2"' },
                file_pattern: { type: 'string', description: 'Optional regex to filter files (e.g. "events/", "\\.txt$")' },
                case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default false)' },
                max_results: { type: 'number', description: 'Maximum results (default 100)' }
            },
            required: ['pattern']
        }
    },
    {
        name: 'script_get_definitions',
        description: 'Get all definitions of a specific type across the mod. Types: event, focus, decision, idea, scripted_effect, scripted_trigger, scripted_gui, technology, on_action, character, country_flag, global_flag, state_flag, variable, country_history.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Definition type to find' },
                query: { type: 'string', description: 'Optional name filter (substring match)' }
            },
            required: ['type']
        }
    },
    {
        name: 'script_get_references',
        description: 'Find all references to a name across the entire mod. Searches for exact word matches of the given identifier in all .txt files. Returns file, line, text, and context.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Identifier to find references for (event ID, focus ID, flag name, idea name, etc.)' }
            },
            required: ['name']
        }
    },
    {
        name: 'script_validate_file',
        description: 'Validate a Clausewitz script file. Checks: bracket matching, undefined event/focus/idea references, missing localization keys, empty blocks, deprecated syntax.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Relative file path from mod root' }
            },
            required: ['file']
        }
    },
    {
        name: 'script_get_scope_context',
        description: 'Analyze the scope context at a specific line in a file. Returns: current scope (country/state/character), scope stack, depth. Useful for knowing which effects/triggers are valid.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Relative file path' },
                line: { type: 'number', description: 'Line number (1-based)' }
            },
            required: ['file', 'line']
        }
    },
    {
        name: 'script_lookup_effect',
        description: 'Look up a HOI4 effect by name. Returns scope, parameters, description, syntax, examples, version. Database of 215 effects, triggers, modifiers, and scopes.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Effect name (e.g. "add_political_power", "country_event")' },
                search: { type: 'string', description: 'Alternative: search by keyword in name/description (e.g. "stability", "war support")' },
                type_filter: { type: 'string', enum: ['effect', 'trigger', 'modifier', 'scope', 'define', 'structure'], description: 'Filter by entry type' },
                category_filter: { type: 'string', description: 'Filter by category (e.g. "resources", "diplomacy", "military")' },
                scope_filter: { type: 'string', enum: ['country', 'state', 'character', 'unit_leader', 'operative', 'any'], description: 'Filter by valid scope' }
            },
            required: []
        }
    },
    {
        name: 'mod_get_structure',
        description: 'Get the full mod directory structure with file counts per category, total lines of code, and file sizes. Quick overview of the entire project.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'mod_get_file',
        description: 'Read any file from the mod directory. Returns content with line numbers. Supports line range queries.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Relative file path from mod root' },
                start_line: { type: 'number', description: 'Starting line number (1-based, default: 1)' },
                end_line: { type: 'number', description: 'Ending line number (default: end of file)' }
            },
            required: ['file']
        }
    },
    {
        name: 'loc_search',
        description: 'Search localization keys and values. Searches both key names and translated text.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term (matches key names and values)' },
                language: { type: 'string', description: 'Filter by language (e.g. "english", "simp_chinese")' },
                max_results: { type: 'number', description: 'Maximum results (default 50)' }
            },
            required: ['query']
        }
    },
    {
        name: 'loc_get',
        description: 'Get a specific localization key\'s value in all available languages.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Localization key (e.g. "hl2.1.t", "STATE_1")' }
            },
            required: ['key']
        }
    },
    {
        name: 'loc_validate',
        description: 'Validate localization: find keys used in script but not defined, keys defined but never referenced, keys in one language but missing in another.',
        inputSchema: {
            type: 'object',
            properties: {
                check_missing_refs: { type: 'boolean', description: 'Check for script references to undefined loc keys (default true)' },
                check_unused: { type: 'boolean', description: 'Check for defined but unreferenced keys (default false, slow)' },
                check_languages: { type: 'boolean', description: 'Check for keys missing in non-English languages (default true)' }
            },
            required: []
        }
    },
    // ── Image-to-Map Converter ──
    {
        name: 'map_generate_from_image',
        description: 'Convert a reference image (PNG/JPG) into a complete HOI4 map. Detects colored regions as provinces, blue regions as sea, and generates provinces.bmp, definition.csv, state files, strategic regions, default.map, and localization. Returns a preview image and stats.',
        inputSchema: {
            type: 'object',
            properties: {
                image_path: { type: 'string', description: 'Absolute path to the reference image (PNG, JPG, BMP)' },
                output_dir: { type: 'string', description: 'Output mod directory path. Will create map/, history/states/, etc. inside it.' },
                target_width: { type: 'number', description: 'Target map width in pixels (default: image width, HOI4 standard: 5632)' },
                target_height: { type: 'number', description: 'Target map height in pixels (default: auto from aspect ratio, HOI4 standard: 2048)' },
                color_threshold: { type: 'number', description: 'Color difference threshold for province detection (default 30, lower = more provinces)' },
                min_province_pixels: { type: 'number', description: 'Minimum pixels for a valid province (default 16)' },
                provinces_per_state: { type: 'number', description: 'Target number of provinces per state (default 5)' },
                states_per_region: { type: 'number', description: 'Target states per strategic region (default 4)' },
                default_owner: { type: 'string', description: 'Country TAG to assign as owner of all states (e.g. "GER")' },
                detect_sea: { type: 'boolean', description: 'Auto-detect blue regions as sea (default true)' }
            },
            required: ['image_path', 'output_dir']
        }
    },
    {
        name: 'map_preview_image_regions',
        description: 'Preview how an image would be split into provinces WITHOUT generating any files. Returns a preview image showing detected regions and stats. Use this to test parameters before generating.',
        inputSchema: {
            type: 'object',
            properties: {
                image_path: { type: 'string', description: 'Path to the reference image' },
                color_threshold: { type: 'number', description: 'Color threshold (default 30)' },
                min_province_pixels: { type: 'number', description: 'Min pixels per province (default 16)' },
                target_width: { type: 'number', description: 'Target width (default: image size)' }
            },
            required: ['image_path']
        }
    },
    // ── Localization Write Tools ──
    {
        name: 'loc_set',
        description: 'Write or update a single localization key-value pair. Creates or updates the appropriate .yml file with BOM and proper formatting.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Localization key (e.g. "my_event.1.t")' },
                value: { type: 'string', description: 'Localization value text' },
                language: { type: 'string', description: 'Language (default "english"). Options: english, german, french, spanish, russian, polish, braz_por, japanese, simp_chinese' },
                file: { type: 'string', description: 'Target file path relative to mod root (e.g. "localisation/english/events_l_english.yml"). If omitted, auto-selects or creates.' }
            },
            required: ['key', 'value']
        }
    },
    {
        name: 'loc_bulk_set',
        description: 'Write multiple localization key-value pairs at once. Efficient for generating loc for events, focuses, decisions.',
        inputSchema: {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    description: 'Array of {key, value} pairs to write',
                    items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] }
                },
                language: { type: 'string', description: 'Language (default "english")' },
                file: { type: 'string', description: 'Target file. If omitted, auto-selects.' }
            },
            required: ['entries']
        }
    },
    // ── Phase 6: GUI Intelligence ──
    {
        name: 'gui_parse_gfx',
        description: 'Parse a .gfx sprite definition file. Returns all spriteTypes with names, textures, animation frames, and properties.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Path to .gfx file relative to mod root (e.g. "interface/my_sprites.gfx")' }
            },
            required: ['file']
        }
    },
    {
        name: 'gui_parse_gui',
        description: 'Parse a .gui window layout file. Returns element tree with window types, positions, sizes, sprites, and behaviors.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Path to .gui file relative to mod root (e.g. "interface/my_gui.gui")' }
            },
            required: ['file']
        }
    },
    {
        name: 'gui_validate',
        description: 'Validate GUI/GFX files: check that sprites referenced in .gui exist in .gfx, scripted_gui window_name matches .gui containers, and texture .dds files exist on disk.',
        inputSchema: {
            type: 'object',
            properties: {
                gui_file: { type: 'string', description: 'Path to .gui file to validate (optional — validates all if omitted)' },
                check_textures: { type: 'boolean', description: 'Also check .dds texture files exist (default true)' }
            },
            required: []
        }
    },
    {
        name: 'gui_get_sprites',
        description: 'Search and list all sprite definitions across the mod. Useful for finding available sprites when building GUIs.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search filter (substring match on sprite name)' },
                type: { type: 'string', description: 'Filter by sprite type: spriteType, corneredTileSpriteType, progressbartype, frameAnimatedSpriteType' }
            },
            required: []
        }
    },
    {
        name: 'gui_create_scripted_gui',
        description: 'Generate a scripted GUI definition file (common/scripted_guis/*.txt) with window_name, visible trigger, effect blocks, and property blocks.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Scripted GUI name (e.g. "my_resistance_panel")' },
                window_name: { type: 'string', description: 'The containerWindowType name in the .gui file this connects to' },
                context_type: { type: 'string', description: 'Context: player_context (default), selected_state_context, diplomacy_context' },
                visible: { type: 'string', description: 'Visible trigger block content (Clausewitz script). Default: "always = yes"' },
                effects: { type: 'array', description: 'Array of {name, script} for effect blocks (button clicks etc.)', items: { type: 'object' } },
                properties: { type: 'array', description: 'Array of {name, script} for dynamic property blocks', items: { type: 'object' } }
            },
            required: ['name', 'window_name']
        }
    },
    {
        name: 'gui_generate_gfx',
        description: 'Generate .gfx spriteType entries for DDS texture files. Scans a directory for .dds files and creates matching sprite definitions.',
        inputSchema: {
            type: 'object',
            properties: {
                directory: { type: 'string', description: 'Directory to scan for .dds files (relative to mod root, e.g. "gfx/interface/my_mod")' },
                output_file: { type: 'string', description: 'Output .gfx file path (default: interface/generated_sprites.gfx)' },
                prefix: { type: 'string', description: 'Sprite name prefix (default: "GFX_")' }
            },
            required: ['directory']
        }
    }
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

class MapMcpToolHandler {
    constructor(loader) {
        this.loader = loader;
        this.loaded = false;
        // Phase 5: Script intelligence
        this.modIndexer = new ModIndexer(loader.workspaceRoot);
    }

    async ensureLoaded() {
        if (this.loaded) return;
        console.error('[MapMCP] Loading map data...');
        await this.loader.load((msg, pct) => {
            console.error(`[MapMCP] ${pct}% ${msg}`);
        });
        await this.modIndexer.ensureLoaded();
        this.loaded = true;
        console.error(`[MapMCP] Map loaded: ${this.loader.mapWidth}x${this.loader.mapHeight}, ${this.loader.provinces.filter(Boolean).length} provinces, ${this.loader.states.filter(Boolean).length} states`);
    }

    async handle(toolName, args) {
        // Phase 5 tools only need the mod indexer, not map data
        const scriptTools = ['script_parse_file', 'script_search', 'script_get_definitions', 'script_get_references', 'script_validate_file', 'script_get_scope_context', 'script_lookup_effect', 'mod_get_structure', 'mod_get_file', 'loc_search', 'loc_get', 'loc_validate', 'loc_set', 'loc_bulk_set', 'gui_parse_gfx', 'gui_parse_gui', 'gui_validate', 'gui_get_sprites', 'gui_create_scripted_gui', 'gui_generate_gfx'];
        if (scriptTools.includes(toolName)) {
            await this.modIndexer.ensureLoaded();
        } else {
            await this.ensureLoaded();
        }

        switch (toolName) {
            case 'map_get_summary': return this.getSummary();
            case 'map_get_province': return this.getProvince(args);
            case 'map_search_provinces': return this.searchProvinces(args);
            case 'map_get_state': return this.getState(args);
            case 'map_search_states': return this.searchStates(args);
            case 'map_get_strategic_region': return this.getStrategicRegion(args);
            case 'map_get_adjacencies': return this.getAdjacencies(args);
            case 'map_get_supply_network': return this.getSupplyNetwork(args);
            case 'map_get_countries': return this.getCountries(args);
            case 'map_validate': return this.validate(args);
            case 'map_get_terrain_info': return this.getTerrainInfo();
            case 'map_render_ascii': return this.renderAscii(args);
            case 'map_render_snapshot': return this.renderSnapshot(args);
            case 'map_render_state_view': return this.renderStateView(args);
            case 'map_render_minimap': return this.renderMinimap(args);
            // Phase 3: Write tools
            case 'map_edit_state': return this.editState(args);
            case 'map_create_state': return this.createState(args);
            case 'map_transfer_provinces': return this.transferProvinces(args);
            case 'map_edit_victory_point': return this.editVictoryPoint(args);
            case 'map_edit_railway': return this.editRailway(args);
            case 'map_edit_supply_node': return this.editSupplyNode(args);
            case 'map_edit_strategic_region': return this.editStrategicRegion(args);
            case 'map_edit_province': return this.editProvince(args);
            case 'map_bulk_edit': return this.bulkEdit(args);
            case 'map_create_backup': return this.createBackup(args);
            // Phase 5: Script intelligence
            case 'script_parse_file': return this.scriptParseFile(args);
            case 'script_search': return this.scriptSearch(args);
            case 'script_get_definitions': return this.scriptGetDefinitions(args);
            case 'script_get_references': return this.scriptGetReferences(args);
            case 'script_validate_file': return this.scriptValidateFile(args);
            case 'script_get_scope_context': return this.scriptGetScopeContext(args);
            case 'script_lookup_effect': return this.scriptLookupEffect(args);
            case 'mod_get_structure': return this.modGetStructure(args);
            case 'mod_get_file': return this.modGetFile(args);
            case 'loc_search': return this.locSearch(args);
            case 'loc_get': return this.locGet(args);
            case 'loc_validate': return this.locValidate(args);
            // Image-to-Map
            case 'map_generate_from_image': return this.generateFromImage(args);
            case 'map_preview_image_regions': return this.previewImageRegions(args);
            // Localization Write
            case 'loc_set': return this.locSet(args);
            case 'loc_bulk_set': return this.locBulkSet(args);
            // Phase 6: GUI Intelligence
            case 'gui_parse_gfx': return this.guiParseGfx(args);
            case 'gui_parse_gui': return this.guiParseGui(args);
            case 'gui_validate': return this.guiValidate(args);
            case 'gui_get_sprites': return this.guiGetSprites(args);
            case 'gui_create_scripted_gui': return this.guiCreateScriptedGui(args);
            case 'gui_generate_gfx': return this.guiGenerateGfx(args);
            default: return { error: `Unknown tool: ${toolName}` };
        }
    }

    // ── Query Implementations ──

    getSummary() {
        const provinces = this.loader.provinces.filter(Boolean);
        const states = this.loader.states.filter(Boolean);
        const regions = this.loader.strategicRegions.filter(Boolean);

        // Build province assignment maps
        const provinceToState = {};
        const provinceToRegion = {};
        for (const s of states) {
            for (const pId of s.provinces) provinceToState[pId] = s.id;
        }
        for (const r of regions) {
            for (const pId of r.provinces) provinceToRegion[pId] = r.id;
        }

        const landProvinces = provinces.filter(p => p.type === 'land');
        const seaProvinces = provinces.filter(p => p.type === 'sea');
        const lakeProvinces = provinces.filter(p => p.type === 'lake');
        const unassigned = landProvinces.filter(p => !provinceToState[p.id]);

        return {
            map_dimensions: { width: this.loader.mapWidth, height: this.loader.mapHeight },
            provinces: {
                total: provinces.length,
                land: landProvinces.length,
                sea: seaProvinces.length,
                lake: lakeProvinces.length,
                coastal: provinces.filter(p => p.coastal).length,
                unassigned_to_state: unassigned.length
            },
            states: {
                total: states.length,
                with_owner: states.filter(s => s.owner).length,
                impassable: states.filter(s => s.impassable).length
            },
            strategic_regions: { total: regions.length },
            countries: { total: this.loader.countries.length },
            supply: {
                railways: this.loader.railways.length,
                supply_nodes: this.loader.supplyNodes.length
            },
            terrains: this.loader.terrains,
            continents: this.loader.continents.length - 1, // exclude index 0
            has_rivers: this.loader.rivers !== null,
            has_heightmap: this.loader.heightmap !== null,
            warnings: this.loader.warnings.length
        };
    }

    getProvince(args) {
        const prov = this.loader.provinces[args.province_id];
        if (!prov) return { error: `Province ${args.province_id} not found` };

        // Find state and region membership
        let stateId = null, regionId = null;
        for (const s of this.loader.states.filter(Boolean)) {
            if (s.provinces.includes(prov.id)) { stateId = s.id; break; }
        }
        for (const r of this.loader.strategicRegions.filter(Boolean)) {
            if (r.provinces.includes(prov.id)) { regionId = r.id; break; }
        }

        // Get victory points
        let victoryPoints = 0;
        if (stateId !== null) {
            const state = this.loader.states[stateId];
            if (state && state.victoryPoints && state.victoryPoints[prov.id]) {
                victoryPoints = state.victoryPoints[prov.id];
            }
        }

        return {
            id: prov.id,
            rgb: prov.rgb,
            type: prov.type,
            terrain: prov.terrain,
            coastal: prov.coastal,
            continent: prov.continent,
            center: prov.centerOfMass,
            pixel_count: prov.pixelCount,
            bounding_box: prov.boundingBox,
            state_id: stateId,
            strategic_region_id: regionId,
            victory_points: victoryPoints,
            adjacent_provinces: (prov.edges || []).map(e => ({
                province_id: e.to,
                border_pixels: e.borderPixels ? e.borderPixels.length : e.length || 0
            }))
        };
    }

    searchProvinces(args) {
        const limit = args.limit || 100;
        let results = this.loader.provinces.filter(Boolean);

        // Build lookup maps
        const provinceToState = {};
        const provinceToRegion = {};
        for (const s of this.loader.states.filter(Boolean)) {
            for (const pId of s.provinces) provinceToState[pId] = s.id;
        }
        for (const r of this.loader.strategicRegions.filter(Boolean)) {
            for (const pId of r.provinces) provinceToRegion[pId] = r.id;
        }

        // Victory point lookup
        const vpProvinces = new Set();
        for (const s of this.loader.states.filter(Boolean)) {
            if (s.victoryPoints) {
                for (const pId of Object.keys(s.victoryPoints)) vpProvinces.add(parseInt(pId));
            }
        }

        // Apply filters
        if (args.type) results = results.filter(p => p.type === args.type);
        if (args.terrain) results = results.filter(p => p.terrain === args.terrain);
        if (args.coastal !== undefined) results = results.filter(p => p.coastal === args.coastal);
        if (args.continent !== undefined) results = results.filter(p => p.continent === args.continent);
        if (args.state_id !== undefined) results = results.filter(p => provinceToState[p.id] === args.state_id);
        if (args.strategic_region_id !== undefined) results = results.filter(p => provinceToRegion[p.id] === args.strategic_region_id);
        if (args.min_pixels) results = results.filter(p => p.pixelCount >= args.min_pixels);
        if (args.has_victory_points) results = results.filter(p => vpProvinces.has(p.id));
        if (args.adjacent_to !== undefined) {
            const adjProv = this.loader.provinces[args.adjacent_to];
            if (adjProv && adjProv.edges) {
                const adjIds = new Set(adjProv.edges.map(e => e.to));
                results = results.filter(p => adjIds.has(p.id));
            }
        }

        const total = results.length;
        results = results.slice(0, limit);

        return {
            total_matches: total,
            returned: results.length,
            provinces: results.map(p => ({
                id: p.id,
                type: p.type,
                terrain: p.terrain,
                coastal: p.coastal,
                center: p.centerOfMass,
                pixel_count: p.pixelCount,
                state_id: provinceToState[p.id] || null
            }))
        };
    }

    getState(args) {
        const state = this.loader.states[args.state_id];
        if (!state) return { error: `State ${args.state_id} not found` };

        const center = this.loader.calculateStateCenterOfMass(state);

        // Get display name from stateNames
        let displayName = state.name;
        if (this.loader.stateNames) {
            const locName = this.loader.stateNames.get ? this.loader.stateNames.get(state.name) : this.loader.stateNames[state.name];
            if (locName) displayName = locName;
        }

        return {
            id: state.id,
            name: state.name,
            display_name: displayName,
            owner: state.owner || null,
            manpower: state.manpower,
            category: state.category,
            impassable: state.impassable || false,
            provinces: state.provinces,
            province_count: state.provinces.length,
            resources: state.resources || {},
            victory_points: state.victoryPoints || {},
            total_victory_points: Object.values(state.victoryPoints || {}).reduce((a, b) => a + b, 0),
            buildings: state.buildings || {},
            cores: state.cores || [],
            center_of_mass: center,
            file: state.file ? path.basename(state.file) : null
        };
    }

    searchStates(args) {
        const limit = args.limit || 100;
        let results = this.loader.states.filter(Boolean);

        if (args.owner) results = results.filter(s => s.owner === args.owner);
        if (args.category) results = results.filter(s => s.category === args.category);
        if (args.impassable !== undefined) results = results.filter(s => (s.impassable || false) === args.impassable);
        if (args.min_manpower) results = results.filter(s => s.manpower >= args.min_manpower);
        if (args.has_core) results = results.filter(s => s.cores && s.cores.includes(args.has_core));
        if (args.has_resource) {
            results = results.filter(s => s.resources && s.resources[args.has_resource] > 0);
        }
        if (args.min_victory_points) {
            results = results.filter(s => {
                const total = Object.values(s.victoryPoints || {}).reduce((a, b) => a + b, 0);
                return total >= args.min_victory_points;
            });
        }

        const total = results.length;
        results = results.slice(0, limit);

        return {
            total_matches: total,
            returned: results.length,
            states: results.map(s => ({
                id: s.id,
                name: s.name,
                owner: s.owner || null,
                manpower: s.manpower,
                category: s.category,
                province_count: s.provinces.length,
                total_vp: Object.values(s.victoryPoints || {}).reduce((a, b) => a + b, 0),
                resources: s.resources || {}
            }))
        };
    }

    getStrategicRegion(args) {
        const region = this.loader.strategicRegions[args.region_id];
        if (!region) return { error: `Strategic region ${args.region_id} not found` };

        return {
            id: region.id,
            name: region.name,
            provinces: region.provinces,
            province_count: region.provinces.length,
            naval_terrain: region.navalTerrain || null,
            center_of_mass: region.centerOfMass || this.loader.calculateRegionCenterOfMass(region),
            file: region.file ? path.basename(region.file) : null
        };
    }

    getAdjacencies(args) {
        const prov = this.loader.provinces[args.province_id];
        if (!prov) return { error: `Province ${args.province_id} not found` };

        const includeSea = args.include_sea !== false;
        const edges = prov.edges || [];

        const result = {
            province_id: prov.id,
            type: prov.type,
            adjacent: []
        };

        for (const edge of edges) {
            const neighbor = this.loader.provinces[edge.to];
            if (!neighbor) continue;
            if (!includeSea && neighbor.type === 'sea') continue;

            result.adjacent.push({
                province_id: edge.to,
                type: neighbor.type,
                terrain: neighbor.terrain,
                border_pixels: edge.borderPixels ? edge.borderPixels.length : edge.length || 0
            });
        }

        return result;
    }

    getSupplyNetwork(args) {
        let railways = this.loader.railways || [];
        let supplyNodes = this.loader.supplyNodes || [];

        // Filter by state
        if (args.state_id !== undefined) {
            const state = this.loader.states[args.state_id];
            if (!state) return { error: `State ${args.state_id} not found` };
            const provSet = new Set(state.provinces);
            railways = railways.filter(r => r.provinces.some(p => provSet.has(p)));
            supplyNodes = supplyNodes.filter(n => provSet.has(n.province));
        }

        // Filter by province
        if (args.province_id !== undefined) {
            railways = railways.filter(r => r.provinces.includes(args.province_id));
            supplyNodes = supplyNodes.filter(n => n.province === args.province_id);
        }

        // Filter by bounding box
        if (args.bounding_box) {
            const bb = args.bounding_box;
            const inBox = (pId) => {
                const p = this.loader.provinces[pId];
                if (!p) return false;
                return p.centerOfMass.x >= bb.x1 && p.centerOfMass.x <= bb.x2 &&
                       p.centerOfMass.y >= bb.y1 && p.centerOfMass.y <= bb.y2;
            };
            railways = railways.filter(r => r.provinces.some(inBox));
            supplyNodes = supplyNodes.filter(n => inBox(n.province));
        }

        return {
            railways: railways.map(r => ({
                level: r.level,
                provinces: r.provinces,
                province_count: r.provinces.length
            })),
            supply_nodes: supplyNodes.map(n => ({
                level: n.level,
                province_id: n.province
            })),
            summary: {
                railway_count: railways.length,
                supply_node_count: supplyNodes.length,
                total_railway_segments: railways.reduce((a, r) => a + r.provinces.length - 1, 0)
            }
        };
    }

    getCountries(args) {
        if (args.tag) {
            const country = this.loader.countries.find(c => c.tag === args.tag);
            if (!country) return { error: `Country ${args.tag} not found` };

            // Find all states owned by this country
            const ownedStates = this.loader.states.filter(Boolean).filter(s => s.owner === args.tag);
            const coreStates = this.loader.states.filter(Boolean).filter(s => s.cores && s.cores.includes(args.tag));

            const r = (country.color >> 16) & 0xFF;
            const g = (country.color >> 8) & 0xFF;
            const b = country.color & 0xFF;

            return {
                tag: country.tag,
                color: { r, g, b },
                owned_states: ownedStates.map(s => ({
                    id: s.id, name: s.name, provinces: s.provinces.length,
                    manpower: s.manpower
                })),
                core_states: coreStates.map(s => ({ id: s.id, name: s.name })),
                total_provinces: ownedStates.reduce((a, s) => a + s.provinces.length, 0),
                total_manpower: ownedStates.reduce((a, s) => a + (s.manpower || 0), 0)
            };
        }

        return {
            countries: this.loader.countries.map(c => {
                const r = (c.color >> 16) & 0xFF;
                const g = (c.color >> 8) & 0xFF;
                const b = c.color & 0xFF;
                const ownedCount = this.loader.states.filter(Boolean).filter(s => s.owner === c.tag).length;
                return { tag: c.tag, color: { r, g, b }, owned_states: ownedCount };
            })
        };
    }

    validate(args) {
        const category = args.category || 'all';
        const errors = [];
        const warnings = [];

        // Province validation
        if (category === 'all' || category === 'provinces') {
            const assignedProvinces = new Set();
            for (const s of this.loader.states.filter(Boolean)) {
                for (const pId of s.provinces) {
                    if (assignedProvinces.has(pId)) {
                        errors.push({ type: 'duplicate_assignment', province_id: pId, message: `Province ${pId} assigned to multiple states` });
                    }
                    assignedProvinces.add(pId);
                }
            }

            for (const p of this.loader.provinces.filter(Boolean)) {
                if (p.type === 'land' && !assignedProvinces.has(p.id)) {
                    warnings.push({ type: 'unassigned_province', province_id: p.id, message: `Land province ${p.id} not assigned to any state` });
                }
                if (p.pixelCount === 0) {
                    errors.push({ type: 'empty_province', province_id: p.id, message: `Province ${p.id} has 0 pixels on map` });
                }
            }
        }

        // State validation
        if (category === 'all' || category === 'states') {
            for (const s of this.loader.states.filter(Boolean)) {
                if (!s.owner && !s.impassable) {
                    warnings.push({ type: 'no_owner', state_id: s.id, message: `State ${s.id} (${s.name}) has no owner` });
                }
                if (s.provinces.length === 0) {
                    errors.push({ type: 'empty_state', state_id: s.id, message: `State ${s.id} (${s.name}) has no provinces` });
                }
                if (s.manpower === 0 && !s.impassable) {
                    warnings.push({ type: 'zero_manpower', state_id: s.id, message: `State ${s.id} (${s.name}) has 0 manpower` });
                }
                // Check for provinces that don't exist
                for (const pId of s.provinces) {
                    if (!this.loader.provinces[pId]) {
                        errors.push({ type: 'invalid_province_ref', state_id: s.id, province_id: pId, message: `State ${s.id} references non-existent province ${pId}` });
                    }
                }
            }
        }

        // Supply validation
        if (category === 'all' || category === 'supply') {
            for (const node of this.loader.supplyNodes) {
                if (!this.loader.provinces[node.province]) {
                    errors.push({ type: 'invalid_supply_node', province_id: node.province, message: `Supply node on non-existent province ${node.province}` });
                }
            }
            for (const rail of this.loader.railways) {
                for (const pId of rail.provinces) {
                    if (!this.loader.provinces[pId]) {
                        errors.push({ type: 'invalid_railway_province', province_id: pId, message: `Railway references non-existent province ${pId}` });
                    }
                }
            }
        }

        return {
            errors: errors,
            warnings: warnings,
            error_count: errors.length,
            warning_count: warnings.length,
            loader_warnings: this.loader.warnings.length
        };
    }

    getTerrainInfo() {
        const terrainCounts = {};
        for (const p of this.loader.provinces.filter(Boolean)) {
            const t = p.terrain || 'unknown';
            terrainCounts[t] = (terrainCounts[t] || 0) + 1;
        }

        return {
            terrains: this.loader.terrains,
            terrain_definitions: (this.loader.terrainDefinitions || []).map(td => ({
                name: td.name,
                color: td.color
            })),
            distribution: Object.entries(terrainCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([terrain, count]) => ({ terrain, count }))
        };
    }

    // ── Image-to-Map Converter ──

    async generateFromImage(args) {
        if (!ImageToMapConverter) return { error: 'ImageToMapConverter not available. Install sharp: npm install sharp' };
        if (!fs.existsSync(args.image_path)) return { error: `Image not found: ${args.image_path}` };

        const converter = new ImageToMapConverter();
        const result = await converter.convert(args.image_path, args.output_dir, {
            targetWidth: args.target_width || 0,
            targetHeight: args.target_height || 0,
            colorThreshold: args.color_threshold || 30,
            minProvincePixels: args.min_province_pixels || 16,
            provincesPerState: args.provinces_per_state || 5,
            statesPerRegion: args.states_per_region || 4,
            defaultOwner: args.default_owner || '',
            detectSea: args.detect_sea !== false,
        });

        // Return image + text
        if (result.preview_base64) {
            return {
                _image: result.preview_base64,
                _text: JSON.stringify({ ...result, preview_base64: undefined })
            };
        }
        return result;
    }

    async previewImageRegions(args) {
        if (!ImageToMapConverter) return { error: 'ImageToMapConverter not available. Install sharp: npm install sharp' };
        if (!fs.existsSync(args.image_path)) return { error: `Image not found: ${args.image_path}` };

        // Run the pipeline but skip file writing — only do detection + preview
        const converter = new ImageToMapConverter();
        const sharp = require('sharp');

        let img = sharp(args.image_path).removeAlpha();
        const metadata = await sharp(args.image_path).metadata();
        let w = args.target_width || metadata.width;
        let h = Math.round(metadata.height * (w / metadata.width));
        if (w > 8192) { h = Math.round(h * (8192 / w)); w = 8192; }
        w = w & ~1; h = h & ~1;

        const { data: pixels } = await img.resize(w, h, { kernel: 'nearest' }).raw().toBuffer({ resolveWithObject: true });

        const threshold = args.color_threshold || 30;
        const quantLevel = Math.max(8, Math.round(threshold / 2));
        const quantized = Buffer.from(pixels);
        for (let i = 0; i < quantized.length; i++) {
            quantized[i] = Math.round(quantized[i] / quantLevel) * quantLevel;
        }

        const { labelComponents, classifyProvinces } = (() => {
            // Re-require to get the functions
            const mod = require('./imageToMap');
            return mod;
        })();

        // Use the converter's internal methods via the module
        const imgMod = require('./imageToMap');
        // Actually, we need labelComponents and classifyProvinces exposed
        // For now, just run convert() to a temp dir and return only the preview
        const tmpDir = path.join(require('os').tmpdir(), 'mapgen_preview_' + Date.now());
        const result = await converter.convert(args.image_path, tmpDir, {
            targetWidth: args.target_width || 0,
            colorThreshold: threshold,
            minProvincePixels: args.min_province_pixels || 16,
            provincesPerState: 999, // group into as few states as possible
            statesPerRegion: 999,
        });

        // Clean up temp dir
        fs.rmSync(tmpDir, { recursive: true, force: true });

        if (result.preview_base64) {
            return {
                _image: result.preview_base64,
                _text: JSON.stringify({
                    dimensions: result.dimensions,
                    provinces: result.provinces,
                    note: 'This is a preview only. Use map_generate_from_image to create the actual map files.'
                })
            };
        }
        return { dimensions: result.dimensions, provinces: result.provinces };
    }

    // ── Localization Write Tools ──

    async locSet(args) {
        const language = args.language || 'english';
        const key = args.key;
        const value = args.value;

        // Find or create the target file
        let filePath;
        if (args.file) {
            filePath = path.join(this.modIndexer.root, args.file);
        } else {
            // Auto-select: search existing files for the key, or use a default
            await this.modIndexer.ensureLoaded();
            let found = null;
            for (const [k, entries] of this.modIndexer.localizations) {
                if (k === key) {
                    const langEntry = entries.find(e => e.language === language);
                    if (langEntry) { found = langEntry.file; break; }
                    if (entries.length > 0) { found = entries[0].file; break; }
                }
            }
            if (found) {
                filePath = found;
            } else {
                // Create in default location
                const locDir = path.join(this.modIndexer.root, 'localisation', language);
                await fs.promises.mkdir(locDir, { recursive: true });
                filePath = path.join(locDir, `custom_l_${language}.yml`);
            }
        }

        // Read or create file
        let content;
        if (fs.existsSync(filePath)) {
            content = await fs.promises.readFile(filePath, 'utf-8');
        } else {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            content = `\uFEFFl_${language}:\n`;
        }

        // Update or append key
        const keyRegex = new RegExp(`^(\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*\\d+\\s+)".+"`, 'm');
        if (keyRegex.test(content)) {
            content = content.replace(keyRegex, `$1"${value}"`);
        } else {
            // Append before final newline
            content = content.trimEnd() + `\n ${key}:0 "${value}"\n`;
        }

        await fs.promises.writeFile(filePath, content, 'utf-8');

        // Update index
        this.modIndexer._locDirty = true;

        return { success: true, key, value, language, file: filePath };
    }

    async locBulkSet(args) {
        const language = args.language || 'english';
        const entries = args.entries;
        if (!entries || entries.length === 0) return { error: 'No entries provided' };

        // Determine file
        let filePath;
        if (args.file) {
            filePath = path.join(this.modIndexer.root, args.file);
        } else {
            const locDir = path.join(this.modIndexer.root, 'localisation', language);
            await fs.promises.mkdir(locDir, { recursive: true });
            filePath = path.join(locDir, `custom_l_${language}.yml`);
        }

        let content;
        if (fs.existsSync(filePath)) {
            content = await fs.promises.readFile(filePath, 'utf-8');
        } else {
            content = `\uFEFFl_${language}:\n`;
        }

        let updated = 0, added = 0;
        for (const entry of entries) {
            const keyRegex = new RegExp(`^(\\s*${entry.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*\\d+\\s+)".+"`, 'm');
            if (keyRegex.test(content)) {
                content = content.replace(keyRegex, `$1"${entry.value}"`);
                updated++;
            } else {
                content = content.trimEnd() + `\n ${entry.key}:0 "${entry.value}"\n`;
                added++;
            }
        }

        await fs.promises.writeFile(filePath, content, 'utf-8');
        return { success: true, file: filePath, language, updated, added, total: entries.length };
    }

    // ── Phase 6: GUI Intelligence ──

    _parseGuiGfxFile(content) {
        // Parse .gfx and .gui files (Clausewitz-like syntax with nested blocks)
        const results = [];
        const lines = content.split('\n');
        const stack = []; // Stack of {type, line, properties, children}

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const line = raw.trim();
            if (line.startsWith('#') || line === '') continue;

            // Count braces
            const opens = (line.match(/{/g) || []).length;
            const closes = (line.match(/}/g) || []).length;

            // Inline block: key = { ... } all on one line (e.g. position = { x = 100 y = 100 })
            const inlineMatch = line.match(/^(\w+)\s*=\s*\{([^}]+)\}\s*$/);
            if (inlineMatch && opens === closes) {
                if (stack.length > 0) {
                    stack[stack.length - 1].properties[inlineMatch[1]] = inlineMatch[2].trim();
                }
                continue;
            }

            // Block start: word = {
            const blockMatch = line.match(/^(\w+)\s*=\s*\{/);
            if (blockMatch && opens > closes) {
                const entry = { type: blockMatch[1], line: i + 1, properties: {}, children: [] };
                if (stack.length > 0) {
                    stack[stack.length - 1].children.push(entry);
                } else {
                    results.push(entry);
                }
                stack.push(entry);
                continue;
            }

            // Key = "value" or key = value
            const kvMatch = line.match(/^(\w+)\s*=\s*"([^"]*)"/);
            const kvMatch2 = !kvMatch ? line.match(/^(\w+)\s*=\s*([^{}\s]+)\s*$/) : null;
            if ((kvMatch || kvMatch2) && stack.length > 0) {
                const m = kvMatch || kvMatch2;
                stack[stack.length - 1].properties[m[1]] = m[2].trim();
            }

            // Handle closing braces (only pure close lines, not block-start lines)
            if (!blockMatch) {
                for (let c = 0; c < closes; c++) {
                    if (stack.length > 0) stack.pop();
                }
            }
        }
        return results;
    }

    async guiParseGfx(args) {
        const filePath = path.join(this.modIndexer.root, args.file);
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.file}` };
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = this._parseGuiGfxFile(content);

        const sprites = [];
        for (const block of parsed) {
            if (block.type === 'spriteTypes') {
                for (const child of block.children) {
                    sprites.push({
                        type: child.type,
                        name: child.properties.name || '',
                        texturefile: child.properties.texturefile || child.properties.textureFile || '',
                        noOfFrames: parseInt(child.properties.noOfFrames || '1'),
                        line: child.line,
                        allProps: child.properties
                    });
                }
            }
        }
        return { file: args.file, sprites, total: sprites.length };
    }

    async guiParseGui(args) {
        const filePath = path.join(this.modIndexer.root, args.file);
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.file}` };
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = this._parseGuiGfxFile(content);

        const windows = [];
        for (const block of parsed) {
            if (block.type === 'guiTypes') {
                for (const child of block.children) {
                    windows.push({
                        type: child.type,
                        name: child.properties.name || '',
                        position: child.properties.position || '',
                        size: child.properties.size || '',
                        line: child.line,
                        children: child.children.map(c => ({
                            type: c.type,
                            name: c.properties.name || '',
                            position: c.properties.position || '',
                            sprite: c.properties.spriteType || c.properties.quadTextureSprite || '',
                            line: c.line
                        })),
                        allProps: child.properties
                    });
                }
            }
        }
        return { file: args.file, windows, total: windows.length };
    }

    async guiValidate(args) {
        const root = this.modIndexer.root;
        const issues = [];

        // Collect all sprites from .gfx files
        const allSprites = new Set();
        const gfxFiles = [];
        const scanGfx = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                if (f.isDirectory()) scanGfx(path.join(dir, f.name));
                else if (f.name.endsWith('.gfx')) gfxFiles.push(path.join(dir, f.name));
            }
        };
        scanGfx(path.join(root, 'interface'));

        for (const gf of gfxFiles) {
            const parsed = this._parseGuiGfxFile(await fs.promises.readFile(gf, 'utf-8'));
            for (const block of parsed) {
                if (block.type === 'spriteTypes') {
                    for (const child of block.children) {
                        if (child.properties.name) allSprites.add(child.properties.name);
                    }
                }
            }
        }

        // Scan .gui files for sprite references
        const guiFiles = [];
        scanGfx(path.join(root, 'interface')); // re-scans, fine
        for (const gf of gfxFiles) { // already have gfx
            if (gf.endsWith('.gui')) guiFiles.push(gf);
        }
        // Also scan for .gui explicitly
        const scanGui = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                if (f.isDirectory()) scanGui(path.join(dir, f.name));
                else if (f.name.endsWith('.gui')) guiFiles.push(path.join(dir, f.name));
            }
        };
        scanGui(path.join(root, 'interface'));

        const uniqueGuiFiles = [...new Set(guiFiles)];
        for (const gf of uniqueGuiFiles) {
            const content = await fs.promises.readFile(gf, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const spriteMatch = lines[i].match(/(?:spriteType|quadTextureSprite)\s*=\s*"?(\w+)"?/);
                if (spriteMatch && !allSprites.has(spriteMatch[1])) {
                    issues.push({
                        type: 'missing_sprite', severity: 'error',
                        file: path.relative(root, gf), line: i + 1,
                        sprite: spriteMatch[1],
                        message: `Sprite "${spriteMatch[1]}" not found in any .gfx file`
                    });
                }
            }
        }

        // Check texture files exist
        if (args.check_textures !== false) {
            for (const gf of gfxFiles) {
                const content = await fs.promises.readFile(gf, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const texMatch = lines[i].match(/texturefile\s*=\s*"?([^"\s}]+)"?/i);
                    if (texMatch) {
                        const texPath = path.join(root, texMatch[1].replace(/\\/g, '/'));
                        if (!fs.existsSync(texPath)) {
                            issues.push({
                                type: 'missing_texture', severity: 'warning',
                                file: path.relative(root, gf), line: i + 1,
                                texture: texMatch[1],
                                message: `Texture file not found: ${texMatch[1]}`
                            });
                        }
                    }
                }
            }
        }

        // Check scripted_gui window_name references
        await this.modIndexer.ensureLoaded();
        const sgDefs = this.modIndexer.findDefinitionsByType('scripted_gui');
        for (const sg of sgDefs) {
            // Read the file and extract window_name
            const sgPath = path.join(root, sg.file);
            if (fs.existsSync(sgPath)) {
                const content = await fs.promises.readFile(sgPath, 'utf-8');
                const wnMatch = content.match(/window_name\s*=\s*"?(\w+)"?/);
                if (wnMatch) {
                    // Check if that window exists in any .gui file
                    let found = false;
                    for (const gf of uniqueGuiFiles) {
                        const gc = await fs.promises.readFile(gf, 'utf-8');
                        if (gc.includes(`name = "${wnMatch[1]}"`) || gc.includes(`name = ${wnMatch[1]}`)) {
                            found = true; break;
                        }
                    }
                    if (!found) {
                        issues.push({
                            type: 'missing_window', severity: 'error',
                            file: sg.file, line: sg.line, window_name: wnMatch[1],
                            message: `scripted_gui "${sg.name}" references window "${wnMatch[1]}" not found in .gui files`
                        });
                    }
                }
            }
        }

        return { total_issues: issues.length, sprites_found: allSprites.size, gui_files: uniqueGuiFiles.length, gfx_files: gfxFiles.length, issues };
    }

    async guiGetSprites(args) {
        const root = this.modIndexer.root;
        const sprites = [];
        const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                if (f.isDirectory()) scanDir(path.join(dir, f.name));
                else if (f.name.endsWith('.gfx')) {
                    try {
                        const content = fs.readFileSync(path.join(dir, f.name), 'utf-8');
                        const parsed = this._parseGuiGfxFile(content);
                        for (const block of parsed) {
                            if (block.type === 'spriteTypes') {
                                for (const child of block.children) {
                                    if (child.properties.name) {
                                        sprites.push({
                                            name: child.properties.name,
                                            type: child.type,
                                            texture: child.properties.texturefile || child.properties.textureFile || '',
                                            frames: parseInt(child.properties.noOfFrames || '1'),
                                            file: path.relative(root, path.join(dir, f.name)),
                                            line: child.line
                                        });
                                    }
                                }
                            }
                        }
                    } catch (e) { /* skip broken files */ }
                }
            }
        };
        scanDir(path.join(root, 'interface'));

        let filtered = sprites;
        if (args.query) {
            const q = args.query.toLowerCase();
            filtered = sprites.filter(s => s.name.toLowerCase().includes(q));
        }
        if (args.type) {
            filtered = filtered.filter(s => s.type === args.type);
        }

        return { total: filtered.length, sprites: filtered.slice(0, 100) };
    }

    async guiCreateScriptedGui(args) {
        const name = args.name;
        const windowName = args.window_name;
        const contextType = args.context_type || 'player_context';
        const visible = args.visible || 'always = yes';
        const effects = args.effects || [];
        const properties = args.properties || [];

        let content = `scripted_gui = {\n\t${name} = {\n`;
        content += `\t\tcontext_type = ${contextType}\n`;
        content += `\t\twindow_name = "${windowName}"\n\n`;
        content += `\t\tvisible = {\n\t\t\t${visible}\n\t\t}\n\n`;

        for (const eff of effects) {
            content += `\t\t${eff.name} = {\n`;
            content += `\t\t\t${eff.script || '# TODO: Add effect logic'}\n`;
            content += `\t\t}\n\n`;
        }

        if (properties.length > 0) {
            content += `\t\tproperties = {\n`;
            for (const prop of properties) {
                content += `\t\t\t${prop.name} = {\n`;
                content += `\t\t\t\t${prop.script || '# TODO: Add property logic'}\n`;
                content += `\t\t\t}\n`;
            }
            content += `\t\t}\n`;
        }

        content += `\t}\n}\n`;

        // Write to file
        const outDir = path.join(this.modIndexer.root, 'common', 'scripted_guis');
        await fs.promises.mkdir(outDir, { recursive: true });
        const outFile = path.join(outDir, `${name}.txt`);
        await fs.promises.writeFile(outFile, content, 'utf-8');

        return { success: true, file: path.relative(this.modIndexer.root, outFile), content };
    }

    async guiGenerateGfx(args) {
        const root = this.modIndexer.root;
        const scanDir = path.join(root, args.directory);
        if (!fs.existsSync(scanDir)) return { error: `Directory not found: ${args.directory}` };

        const prefix = args.prefix || 'GFX_';
        const ddsFiles = [];
        const scan = (dir) => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                if (f.isDirectory()) scan(path.join(dir, f.name));
                else if (f.name.endsWith('.dds')) {
                    ddsFiles.push(path.relative(root, path.join(dir, f.name)).replace(/\\/g, '/'));
                }
            }
        };
        scan(scanDir);

        let content = 'spriteTypes = {\n';
        for (const dds of ddsFiles) {
            const name = prefix + path.basename(dds, '.dds');
            content += `\tspriteType = {\n\t\tname = "${name}"\n\t\ttexturefile = "${dds}"\n\t}\n`;
        }
        content += '}\n';

        const outFile = path.join(root, args.output_file || 'interface/generated_sprites.gfx');
        await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
        await fs.promises.writeFile(outFile, content, 'utf-8');

        return { success: true, file: path.relative(root, outFile), sprites_generated: ddsFiles.length, dds_files: ddsFiles };
    }

    // ── Phase 5: Script Intelligence ──

    async scriptParseFile(args) {
        const filePath = path.join(this.modIndexer.root, args.file);
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.file}` };
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const tree = parseClausewitz(content);

        function trimTree(node, depth, maxDepth) {
            if (maxDepth && depth >= maxDepth) {
                if (node.children) return { ...node, children: `[${node.children.length} children]` };
                return node;
            }
            if (node.children && Array.isArray(node.children)) {
                return { ...node, children: node.children.map(c => trimTree(c, depth + 1, maxDepth)) };
            }
            return node;
        }

        const result = args.max_depth ? trimTree(tree, 0, args.max_depth) : tree;
        return { file: args.file, lines: content.split('\n').length, ast: result };
    }

    async scriptSearch(args) {
        const results = await this.modIndexer.searchFiles(args.pattern, {
            caseSensitive: args.case_sensitive || false,
            maxResults: args.max_results || 100,
            filePattern: args.file_pattern
        });
        return { pattern: args.pattern, total: results.length, matches: results };
    }

    async scriptGetDefinitions(args) {
        let results;
        if (args.query) {
            results = this.modIndexer.searchDefinitions(args.query, args.type ? [args.type] : null);
        } else {
            results = this.modIndexer.findDefinitionsByType(args.type);
        }
        return { type: args.type, total: results.length, definitions: results };
    }

    async scriptGetReferences(args) {
        const results = await this.modIndexer.findReferences(args.name);
        return { name: args.name, total: results.length, references: results };
    }

    async scriptValidateFile(args) {
        const filePath = path.join(this.modIndexer.root, args.file);
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.file}` };
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const errors = [], warnings = [];

        // Bracket matching
        let depth = 0, inQuote = false;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (let j = 0; j < line.length; j++) {
                if (line[j] === '"' && (j === 0 || line[j-1] !== '\\')) inQuote = !inQuote;
                if (inQuote) continue;
                if (line[j] === '#') break;
                if (line[j] === '{') depth++;
                if (line[j] === '}') { depth--; if (depth < 0) errors.push({ line: i + 1, type: 'bracket', message: 'Unexpected closing brace' }); }
            }
        }
        if (depth > 0) errors.push({ line: lines.length, type: 'bracket', message: `${depth} unclosed brace(s)` });
        if (depth < 0) errors.push({ line: lines.length, type: 'bracket', message: `${-depth} extra closing brace(s)` });

        // Undefined event references
        const eventRefs = content.matchAll(/(?:country_event|news_event|state_event)\s*=\s*\{\s*id\s*=\s*([a-zA-Z0-9_.]+)/g);
        for (const m of eventRefs) {
            const defs = this.modIndexer.findDefinition(m[1]);
            if (!defs.some(d => d.type === 'event')) {
                const line = content.substring(0, m.index).split('\n').length;
                warnings.push({ line, type: 'undefined_ref', message: `Event '${m[1]}' not found in mod`, name: m[1] });
            }
        }

        // Undefined focus references
        const focusRefs = content.matchAll(/(?:prerequisite|mutually_exclusive)\s*=\s*\{\s*focus\s*=\s*([a-zA-Z0-9_]+)/g);
        for (const m of focusRefs) {
            const defs = this.modIndexer.findDefinition(m[1]);
            if (!defs.some(d => d.type === 'focus')) {
                const line = content.substring(0, m.index).split('\n').length;
                warnings.push({ line, type: 'undefined_ref', message: `Focus '${m[1]}' not found in mod`, name: m[1] });
            }
        }

        // Undefined idea references
        const ideaRefs = content.matchAll(/(?:add_ideas|remove_ideas|has_idea)\s*=\s*([a-zA-Z0-9_]+)/g);
        for (const m of ideaRefs) {
            const defs = this.modIndexer.findDefinition(m[1]);
            if (!defs.some(d => d.type === 'idea')) {
                const line = content.substring(0, m.index).split('\n').length;
                warnings.push({ line, type: 'undefined_ref', message: `Idea '${m[1]}' not found in mod`, name: m[1] });
            }
        }

        // Missing localization keys
        const locRefs = content.matchAll(/(?:title|desc|name)\s*=\s*([a-zA-Z0-9_.]+)/g);
        for (const m of locRefs) {
            const key = m[1];
            if (key.match(/^[A-Z]{3}$/) || key === 'yes' || key === 'no') continue;
            if (!this.modIndexer.localizations.has(key)) {
                const line = content.substring(0, m.index).split('\n').length;
                warnings.push({ line, type: 'missing_loc', message: `Localization key '${key}' not found`, key });
            }
        }

        // Empty blocks
        const emptyBlocks = content.matchAll(/(\w+)\s*=\s*\{\s*\}/g);
        for (const m of emptyBlocks) {
            const line = content.substring(0, m.index).split('\n').length;
            warnings.push({ line, type: 'empty_block', message: `Empty block: ${m[1]} = { }` });
        }

        return { file: args.file, valid: errors.length === 0, errors, warnings, summary: { errors: errors.length, warnings: warnings.length } };
    }

    async scriptGetScopeContext(args) {
        const filePath = path.join(this.modIndexer.root, args.file);
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.file}` };
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const scope = analyzeScope(content, args.line);

        const db = getWikiDB();
        const validEffects = db.filter(e => e.type === 'effect' && (e.scope === scope.current_scope || e.scope === 'any')).map(e => e.name);
        const validTriggers = db.filter(e => e.type === 'trigger' && (e.scope === scope.current_scope || e.scope === 'any')).map(e => e.name);

        return {
            file: args.file, line: args.line, ...scope,
            valid_effects_count: validEffects.length, valid_triggers_count: validTriggers.length,
            example_effects: validEffects.slice(0, 15), example_triggers: validTriggers.slice(0, 15)
        };
    }

    scriptLookupEffect(args) {
        const db = getWikiDB();
        let results;

        if (args.name) {
            results = db.filter(e => e.name === args.name);
            if (results.length === 0) {
                const lower = args.name.toLowerCase();
                results = db.filter(e => e.name.toLowerCase().includes(lower));
            }
        } else if (args.search) {
            const lower = args.search.toLowerCase();
            results = db.filter(e => e.name.toLowerCase().includes(lower) || (e.description && e.description.toLowerCase().includes(lower)));
        } else {
            results = db;
        }

        if (args.type_filter) results = results.filter(e => e.type === args.type_filter);
        if (args.category_filter) results = results.filter(e => e.category === args.category_filter);
        if (args.scope_filter) results = results.filter(e => e.scope === args.scope_filter || e.scope === 'any');

        return { total: results.length, results: results.slice(0, 50), categories: [...new Set(results.map(r => r.category))], types: [...new Set(results.map(r => r.type))] };
    }

    async modGetStructure() {
        const structure = { directories: {}, total_files: 0, total_lines: 0, total_size: 0 };
        const root = this.modIndexer.root;

        async function scan(dir, rel) {
            if (!fs.existsSync(dir)) return;
            let entries;
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    await scan(path.join(dir, entry.name), entryRel);
                } else {
                    const cat = rel.split('/')[0] || 'root';
                    if (!structure.directories[cat]) structure.directories[cat] = { files: 0, lines: 0, size: 0, extensions: {} };
                    const stat = await fs.promises.stat(path.join(dir, entry.name));
                    structure.directories[cat].files++;
                    structure.directories[cat].size += stat.size;
                    const ext = path.extname(entry.name) || 'no_ext';
                    structure.directories[cat].extensions[ext] = (structure.directories[cat].extensions[ext] || 0) + 1;
                    structure.total_files++;
                    structure.total_size += stat.size;
                    if (/\.(txt|yml|gui|gfx)$/.test(entry.name)) {
                        try {
                            const content = await fs.promises.readFile(path.join(dir, entry.name), 'utf-8');
                            const lc = content.split('\n').length;
                            structure.directories[cat].lines += lc;
                            structure.total_lines += lc;
                        } catch (e) { /* skip */ }
                    }
                }
            }
        }

        await scan(root, '');
        structure.definition_counts = {};
        for (const [, defs] of this.modIndexer.definitions) {
            for (const d of defs) { structure.definition_counts[d.type] = (structure.definition_counts[d.type] || 0) + 1; }
        }
        structure.localization_keys = this.modIndexer.localizations.size;
        return structure;
    }

    async modGetFile(args) {
        const filePath = path.join(this.modIndexer.root, args.file);
        if (!fs.existsSync(filePath)) return { error: `File not found: ${args.file}` };
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(1, args.start_line || 1);
        const end = Math.min(lines.length, args.end_line || lines.length);
        const numbered = [];
        for (let i = start - 1; i < end; i++) { numbered.push({ line: i + 1, text: lines[i] }); }
        return { file: args.file, total_lines: lines.length, start_line: start, end_line: end, content: numbered };
    }

    locSearch(args) {
        const results = [];
        const lower = args.query.toLowerCase();
        const max = args.max_results || 50;
        for (const [key, entries] of this.modIndexer.localizations) {
            if (results.length >= max) break;
            const matching = entries.filter(e => {
                if (args.language && e.language !== args.language) return false;
                return key.toLowerCase().includes(lower) || e.value.toLowerCase().includes(lower);
            });
            if (matching.length > 0) results.push({ key, entries: matching });
        }
        return { query: args.query, total: results.length, results };
    }

    locGet(args) {
        const entries = this.modIndexer.localizations.get(args.key);
        if (!entries) return { key: args.key, found: false, entries: [] };
        return { key: args.key, found: true, entries };
    }

    async locValidate(args) {
        const checkMissing = args.check_missing_refs !== false;
        const checkLanguages = args.check_languages !== false;
        const issues = [];

        if (checkMissing) {
            const locRefPatterns = [/title\s*=\s*([a-zA-Z0-9_.]+)/g, /desc\s*=\s*([a-zA-Z0-9_.]+)/g, /name\s*=\s*([a-zA-Z0-9_.]+)/g];
            for (const rel of this.modIndexer.files) {
                try {
                    const content = await fs.promises.readFile(path.join(this.modIndexer.root, rel), 'utf-8');
                    for (const pat of locRefPatterns) {
                        let m;
                        while ((m = pat.exec(content)) !== null) {
                            const key = m[1];
                            if (key.match(/^[A-Z]{3}$/) || key === 'yes' || key === 'no' || key.match(/^\d+$/)) continue;
                            if (!this.modIndexer.localizations.has(key)) {
                                issues.push({ type: 'missing', key, file: rel, message: `Key '${key}' used but not in localization` });
                            }
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }

        if (checkLanguages) {
            const langCounts = {};
            for (const [key, entries] of this.modIndexer.localizations) {
                const langs = new Set(entries.map(e => e.language));
                for (const lang of langs) { langCounts[lang] = (langCounts[lang] || 0) + 1; }
                if (langs.has('english') && langs.size === 1) {
                    issues.push({ type: 'missing_translation', key, languages_present: ['english'], message: `Key '${key}' only in English` });
                }
            }
            issues.push({ type: 'language_summary', counts: langCounts });
        }

        return { total_issues: issues.filter(i => i.type !== 'language_summary').length, issues: issues.slice(0, 200) };
    }

    // ── Phase 3: Write Tools ──

    async _autoBackup(label) {
        try {
            return await this.loader.createBackup(label || `auto_${Date.now()}`);
        } catch (e) {
            console.error('[MapMCP] Backup failed:', e.message);
            return null;
        }
    }

    async editState(args) {
        const state = this.loader.states[args.state_id];
        if (!state) return { error: `State ${args.state_id} not found` };

        const backup = await this._autoBackup(`edit_state_${args.state_id}`);

        const updates = {};
        if (args.owner !== undefined) updates.owner = args.owner;
        if (args.manpower !== undefined) updates.manpower = args.manpower;
        if (args.category !== undefined) updates.category = args.category;
        if (args.resources !== undefined) updates.resources = args.resources;
        if (args.buildings !== undefined) updates.buildings = args.buildings;
        if (args.add_cores) updates.addCores = args.add_cores;
        if (args.remove_cores) updates.removeCores = args.remove_cores;

        const success = await this.loader.updateStateFile(args.state_id, updates);
        if (!success) return { error: 'Failed to update state file' };

        // Return updated state
        const updated = this.loader.states[args.state_id];
        return {
            success: true,
            backup: backup,
            state: {
                id: updated.id, name: updated.name, owner: updated.owner,
                manpower: updated.manpower, category: updated.category,
                provinces: updated.provinces, resources: updated.resources,
                buildings: updated.buildings, cores: updated.cores
            }
        };
    }

    async createState(args) {
        if (!args.name || !args.provinces || args.provinces.length === 0) {
            return { error: 'Name and at least one province required' };
        }

        const backup = await this._autoBackup(`create_state_${args.name}`);
        const stateId = args.state_id || this.loader.getNextStateId();

        const result = await this.loader.createStateFile({
            id: stateId,
            name: args.name,
            provinces: args.provinces,
            owner: args.owner || '',
            manpower: args.manpower || 0,
            category: args.category || 'rural'
        });

        if (!result.success) return { error: result.error || 'Failed to create state' };

        return {
            success: true,
            backup: backup,
            state_id: stateId,
            name: args.name,
            provinces: args.provinces,
            transferred_vps: result.transferredVPs || {},
            vp_count: result.vpCount || 0
        };
    }

    async transferProvinces(args) {
        if (!args.province_ids || args.province_ids.length === 0) {
            return { error: 'At least one province_id required' };
        }
        const target = this.loader.states[args.target_state_id];
        if (!target) return { error: `Target state ${args.target_state_id} not found` };

        const backup = await this._autoBackup(`transfer_to_${args.target_state_id}`);

        // Record source states before move
        const { provinceToState } = this._buildLookups();
        const sources = {};
        for (const pid of args.province_ids) {
            const srcId = provinceToState[pid];
            if (srcId !== undefined && srcId !== args.target_state_id) {
                if (!sources[srcId]) sources[srcId] = [];
                sources[srcId].push(pid);
            }
        }

        const success = await this.loader.moveProvincesToState(args.province_ids, args.target_state_id);
        if (!success) return { error: 'Failed to transfer provinces' };

        // Clear lookups cache
        this._lookups = null;

        return {
            success: true,
            backup: backup,
            moved: args.province_ids,
            target_state: args.target_state_id,
            from_states: sources
        };
    }

    async editVictoryPoint(args) {
        const { provinceToState } = this._buildLookups();
        let stateId = args.state_id;
        if (stateId === undefined) {
            stateId = provinceToState[args.province_id];
            if (stateId === undefined) return { error: `Province ${args.province_id} not assigned to any state` };
        }

        const backup = await this._autoBackup(`vp_${args.province_id}`);

        let success;
        if (args.value <= 0) {
            success = await this.loader.removeVictoryPoint(stateId, args.province_id);
        } else {
            success = await this.loader.addVictoryPoint(stateId, args.province_id, args.value);
        }
        if (!success) return { error: 'Failed to update victory point' };

        return {
            success: true,
            backup: backup,
            province_id: args.province_id,
            state_id: stateId,
            value: args.value,
            action: args.value <= 0 ? 'removed' : 'set'
        };
    }

    async editRailway(args) {
        switch (args.action) {
            case 'list': {
                return {
                    railways: this.loader.railways.map((r, i) => ({
                        index: i, level: r.level, provinces: r.provinces, province_count: r.provinces.length
                    })),
                    count: this.loader.railways.length
                };
            }
            case 'add': {
                if (!args.provinces || args.provinces.length < 2) return { error: 'Need at least 2 provinces' };
                const backup = await this._autoBackup('add_railway');
                const result = await this.loader.addRailway(args.level || 1, args.provinces);
                if (result.error) return result;
                return { ...result, backup };
            }
            case 'remove': {
                if (args.index === undefined) return { error: 'Index required for remove' };
                const backup = await this._autoBackup('remove_railway');
                const result = await this.loader.removeRailway(args.index);
                if (result.error) return result;
                return { ...result, backup };
            }
            case 'update_level': {
                if (args.index === undefined || !args.level) return { error: 'Index and level required' };
                const backup = await this._autoBackup('update_railway');
                const result = await this.loader.updateRailwayLevel(args.index, args.level);
                if (result.error) return result;
                return { ...result, backup };
            }
            default: return { error: `Unknown action: ${args.action}. Use: add, remove, update_level, list` };
        }
    }

    async editSupplyNode(args) {
        const backup = await this._autoBackup(`supply_${args.province_id}`);
        let result;
        switch (args.action) {
            case 'add':
                result = await this.loader.addSupplyNode(args.level || 1, args.province_id);
                break;
            case 'remove':
                result = await this.loader.removeSupplyNode(args.province_id);
                break;
            default:
                return { error: `Unknown action: ${args.action}. Use: add, remove` };
        }
        if (result.error) return result;
        return { ...result, backup, action: args.action, province_id: args.province_id };
    }

    async editStrategicRegion(args) {
        const region = this.loader.strategicRegions[args.region_id];
        if (!region) return { error: `Strategic region ${args.region_id} not found` };

        const backup = await this._autoBackup(`region_${args.region_id}`);
        const updates = {};
        if (args.name !== undefined) updates.name = args.name;
        if (args.provinces !== undefined) updates.provinces = args.provinces;
        if (args.naval_terrain !== undefined) updates.naval_terrain = args.naval_terrain;

        const result = await this.loader.updateStrategicRegion(args.region_id, updates);
        if (result.error) return result;

        const updated = this.loader.strategicRegions[args.region_id];
        return {
            success: true,
            backup: backup,
            region: {
                id: updated.id, name: updated.name, provinces: updated.provinces,
                province_count: updated.provinces.length, naval_terrain: updated.navalTerrain
            }
        };
    }

    async editProvince(args) {
        const prov = this.loader.provinces[args.province_id];
        if (!prov) return { error: `Province ${args.province_id} not found` };

        const backup = await this._autoBackup(`province_${args.province_id}`);
        const updates = {};
        if (args.type !== undefined) updates.type = args.type;
        if (args.terrain !== undefined) updates.terrain = args.terrain;
        if (args.coastal !== undefined) updates.coastal = args.coastal;
        if (args.continent !== undefined) updates.continent = args.continent;

        const success = await this.loader.updateProvinceDefinition(args.province_id, updates);
        if (!success) return { error: 'Failed to update province definition' };

        return {
            success: true,
            backup: backup,
            province_id: args.province_id,
            updates: updates
        };
    }

    async bulkEdit(args) {
        if (!args.operations || args.operations.length === 0) {
            return { error: 'No operations provided' };
        }

        // Create a single backup for the entire batch
        const backup = await this._autoBackup(`bulk_${args.operations.length}_ops`);

        if (args.dry_run) {
            // Validate only
            const validations = [];
            for (const op of args.operations) {
                const toolName = `map_${op.tool}`;
                const valid = TOOLS.some(t => t.name === toolName);
                validations.push({
                    tool: op.tool,
                    valid: valid,
                    error: valid ? null : `Unknown tool: ${op.tool}`
                });
            }
            return { dry_run: true, validations, operation_count: args.operations.length };
        }

        // Execute all operations
        const results = [];
        for (let i = 0; i < args.operations.length; i++) {
            const op = args.operations[i];
            const toolName = `map_${op.tool}`;
            try {
                // Skip backup for individual ops since we already backed up
                const result = await this.handle(toolName, op.args || {});
                results.push({ index: i, tool: op.tool, success: !result.error, result });
            } catch (e) {
                results.push({ index: i, tool: op.tool, success: false, error: e.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        return {
            backup: backup,
            total: args.operations.length,
            succeeded: successCount,
            failed: args.operations.length - successCount,
            results: results
        };
    }

    async createBackup(args) {
        const backup = await this.loader.createBackup(args.label);
        return { success: true, backup_path: backup };
    }

    // ── Phase 2: Snapshot Rendering ──

    // Color helpers (same algorithms as webview map editor)
    _hashColor(value) {
        const hue = (value * 137.508) % 360;
        return this._hslToRgb(hue / 360, 0.65, 0.5);
    }

    _hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) { r = g = b = l; }
        else {
            const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
        }
        return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    }

    _gradientColor(ratio) {
        ratio = Math.max(0, Math.min(1, ratio));
        if (ratio < 0.5) { const r = Math.floor(510 * ratio); return (r << 16) | (0xFF << 8); }
        else { const g = Math.floor(510 * (1 - ratio)); return (0xFF << 16) | (g << 8); }
    }

    _defaultTerrainColors() {
        return {
            'plains': 0x7CB342, 'forest': 0x2E7D32, 'jungle': 0x1B5E20, 'marsh': 0x5D8A4E,
            'mountain': 0x8D6E63, 'hills': 0xA1887F, 'desert': 0xD4A437, 'urban': 0x757575,
            'ocean': 0x1a3a5c, 'lakes': 0x2196F3, 'unknown': 0x444444
        };
    }

    _categoryColors() {
        return {
            'wasteland': 0x2D2D2D, 'enclave': 0x4A4A4A, 'tiny_island': 0x5C8A8A,
            'pastoral': 0x90EE90, 'small_island': 0x20B2AA, 'rural': 0x7CB342,
            'town': 0xDAA520, 'large_town': 0xCD853F, 'city': 0xFF8C00,
            'large_city': 0xFF4500, 'metropolis': 0xDC143C, 'megalopolis': 0x8B0000
        };
    }

    _buildLookups() {
        if (this._lookups) return this._lookups;
        const provinceToState = {}, provinceToRegion = {}, countryByTag = {};
        for (const s of this.loader.states.filter(Boolean)) {
            for (const pId of s.provinces) provinceToState[pId] = s.id;
        }
        for (const r of this.loader.strategicRegions.filter(Boolean)) {
            for (const pId of r.provinces) provinceToRegion[pId] = r.id;
        }
        for (const c of this.loader.countries) countryByTag[c.tag] = c;
        this._lookups = { provinceToState, provinceToRegion, countryByTag };
        return this._lookups;
    }

    _getProvinceViewColor(province, view) {
        if (!province) return 0x1a1a1a;
        const { provinceToState, countryByTag } = this._buildLookups();
        const terrainColors = this._defaultTerrainColors();
        const catColors = this._categoryColors();

        switch (view) {
            case 'provinces': return province.color;
            case 'political': {
                if (province.type !== 'land') return 0x1a3a5c;
                const sId = provinceToState[province.id];
                if (sId === undefined) return 0x333333;
                const state = this.loader.states[sId];
                if (!state || !state.owner) return 0x333333;
                const country = countryByTag[state.owner];
                return country ? country.color : this._hashColor(state.owner.charCodeAt(0));
            }
            case 'terrain': {
                if (province.type === 'sea') return terrainColors['ocean'];
                if (province.type === 'lake') return terrainColors['lakes'];
                const t = (province.terrain || 'unknown').toLowerCase();
                return terrainColors[t] || terrainColors['unknown'];
            }
            case 'type':
                if (province.type === 'land') return province.coastal ? 0x40E0D0 : 0x7FFF00;
                if (province.type === 'lake') return 0x00BFFF;
                return 0x1a3a5c;
            case 'manpower': {
                if (province.type !== 'land') return 0x1a1a40;
                const sId = provinceToState[province.id];
                if (sId === undefined) return 0x333333;
                const state = this.loader.states[sId];
                if (!state) return 0x333333;
                const maxMp = Math.max(1, ...this.loader.states.filter(Boolean).map(s => s.manpower || 0));
                return this._gradientColor(state.manpower / maxMp);
            }
            case 'industry': {
                if (province.type !== 'land') return 0x1a1a40;
                const sId = provinceToState[province.id];
                if (sId === undefined) return 0x333333;
                const state = this.loader.states[sId];
                if (!state || !state.buildings) return 0x333333;
                const total = (state.buildings.industrial_complex || 0) + (state.buildings.arms_factory || 0) + (state.buildings.dockyard || 0);
                if (total >= 20) return 0xFF0000; if (total >= 15) return 0xFF4500;
                if (total >= 10) return 0xFF8C00; if (total >= 5) return 0xFFD700;
                if (total >= 1) return 0xADFF2F; return 0x333333;
            }
            case 'victory_points': {
                if (province.type !== 'land') return 0x1a1a40;
                const sId = provinceToState[province.id];
                if (sId === undefined) return 0x333333;
                const state = this.loader.states[sId];
                if (!state) return 0x333333;
                const vp = state.victoryPoints ? state.victoryPoints[province.id] : undefined;
                if (vp === undefined) return 0x444444;
                if (vp >= 20) return 0xFF0000; if (vp >= 10) return 0xFF6600;
                if (vp >= 5) return 0xFFAA00; return 0xFFFF00;
            }
            case 'state_category': {
                if (province.type !== 'land') return 0x1a1a40;
                const sId = provinceToState[province.id];
                if (sId === undefined) return 0x333333;
                const state = this.loader.states[sId];
                if (!state) return 0x333333;
                return catColors[state.category] || 0x666666;
            }
            default: return province.color;
        }
    }

    /**
     * Core rendering: builds a raw RGB pixel buffer for a map region
     */
    _renderRegion(mapX1, mapY1, mapW, mapH, view, opts = {}) {
        const { showBorders = true, highlights = [], showRailways = false, showSupplyNodes = false } = opts;
        const { provinceToState } = this._buildLookups();

        // Build pixel buffer at 1:1 map resolution
        const pixels = Buffer.alloc(mapW * mapH * 3, 0x1a); // dark gray default

        // Build highlight sets
        const highlightProvinces = new Map(); // province_id -> {color, outline}
        const highlightStates = new Map(); // state_id -> {color, outline}
        for (const h of highlights) {
            if (h.province_id !== undefined) highlightProvinces.set(h.province_id, h);
            if (h.state_id !== undefined) highlightStates.set(h.state_id, h);
        }

        // Expand state highlights to provinces
        for (const [stateId, hl] of highlightStates) {
            const state = this.loader.states[stateId];
            if (state && !hl.outline) {
                for (const pId of state.provinces) {
                    if (!highlightProvinces.has(pId)) highlightProvinces.set(pId, hl);
                }
            }
        }

        // Render provinces using BMP data (pixel-accurate)
        if (this.loader.bmpData) {
            for (let ly = 0; ly < mapH; ly++) {
                const my = mapY1 + ly;
                if (my < 0 || my >= this.loader.mapHeight) continue;
                for (let lx = 0; lx < mapW; lx++) {
                    const mx = mapX1 + lx;
                    if (mx < 0 || mx >= this.loader.mapWidth) continue;

                    const bmpIdx = (my * this.loader.mapWidth + mx) * 3;
                    const r = this.loader.bmpData[bmpIdx];
                    const g = this.loader.bmpData[bmpIdx + 1];
                    const b = this.loader.bmpData[bmpIdx + 2];
                    const packed = (r << 16) | (g << 8) | b;
                    const provId = this.loader.colorToProvinceId.get(packed);

                    if (provId === undefined) continue;
                    const prov = this.loader.provinces[provId];
                    if (!prov) continue;

                    let color;
                    const hl = highlightProvinces.get(provId);
                    if (hl && !hl.outline) {
                        color = parseInt((hl.color || '#ff0000').replace('#', ''), 16);
                    } else {
                        color = this._getProvinceViewColor(prov, view);
                    }

                    const pIdx = (ly * mapW + lx) * 3;
                    pixels[pIdx] = (color >> 16) & 0xFF;
                    pixels[pIdx + 1] = (color >> 8) & 0xFF;
                    pixels[pIdx + 2] = color & 0xFF;
                }
            }
        }

        // Draw state borders
        if (showBorders && this.loader.bmpData) {
            for (let ly = 0; ly < mapH; ly++) {
                const my = mapY1 + ly;
                if (my < 0 || my >= this.loader.mapHeight) continue;
                for (let lx = 0; lx < mapW; lx++) {
                    const mx = mapX1 + lx;
                    if (mx < 0 || mx >= this.loader.mapWidth) continue;

                    // Check 4-connected neighbors for state boundary
                    const bmpIdx = (my * this.loader.mapWidth + mx) * 3;
                    const r = this.loader.bmpData[bmpIdx], g = this.loader.bmpData[bmpIdx + 1], b = this.loader.bmpData[bmpIdx + 2];
                    const packed = (r << 16) | (g << 8) | b;
                    const myProvId = this.loader.colorToProvinceId.get(packed);
                    if (myProvId === undefined) continue;
                    const myStateId = provinceToState[myProvId];

                    const neighbors = [[mx + 1, my], [mx, my + 1]];
                    for (const [nx, ny] of neighbors) {
                        if (nx < 0 || nx >= this.loader.mapWidth || ny < 0 || ny >= this.loader.mapHeight) continue;
                        const nBmpIdx = (ny * this.loader.mapWidth + nx) * 3;
                        const nr = this.loader.bmpData[nBmpIdx], ng = this.loader.bmpData[nBmpIdx + 1], nb = this.loader.bmpData[nBmpIdx + 2];
                        const nPacked = (nr << 16) | (ng << 8) | nb;
                        const nProvId = this.loader.colorToProvinceId.get(nPacked);
                        if (nProvId === undefined || nProvId === myProvId) continue;
                        const nStateId = provinceToState[nProvId];
                        if (myStateId !== nStateId) {
                            const pIdx = (ly * mapW + lx) * 3;
                            pixels[pIdx] = 200; pixels[pIdx + 1] = 200; pixels[pIdx + 2] = 200;
                            break;
                        }
                    }
                }
            }
        }

        // Draw highlight outlines
        for (const [stateId, hl] of highlightStates) {
            if (!hl.outline) continue;
            const state = this.loader.states[stateId];
            if (!state) continue;
            const provSet = new Set(state.provinces);
            const outColor = parseInt((hl.color || '#ffff00').replace('#', ''), 16);

            // Scan for border pixels between highlighted and non-highlighted provinces
            if (this.loader.bmpData) {
                for (let ly = 0; ly < mapH; ly++) {
                    const my = mapY1 + ly;
                    if (my < 0 || my >= this.loader.mapHeight) continue;
                    for (let lx = 0; lx < mapW; lx++) {
                        const mx = mapX1 + lx;
                        if (mx < 0 || mx >= this.loader.mapWidth) continue;
                        const bmpIdx = (my * this.loader.mapWidth + mx) * 3;
                        const rr = this.loader.bmpData[bmpIdx], gg = this.loader.bmpData[bmpIdx + 1], bb = this.loader.bmpData[bmpIdx + 2];
                        const myProv = this.loader.colorToProvinceId.get((rr << 16) | (gg << 8) | bb);
                        if (!provSet.has(myProv)) continue;

                        // Check neighbors
                        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                            const nx = mx + dx, ny = my + dy;
                            if (nx < 0 || nx >= this.loader.mapWidth || ny < 0 || ny >= this.loader.mapHeight) { 
                                // At map edge = border
                                const pIdx = (ly * mapW + lx) * 3;
                                pixels[pIdx] = (outColor >> 16) & 0xFF; pixels[pIdx + 1] = (outColor >> 8) & 0xFF; pixels[pIdx + 2] = outColor & 0xFF;
                                break;
                            }
                            const nIdx = (ny * this.loader.mapWidth + nx) * 3;
                            const nProv = this.loader.colorToProvinceId.get((this.loader.bmpData[nIdx] << 16) | (this.loader.bmpData[nIdx + 1] << 8) | this.loader.bmpData[nIdx + 2]);
                            if (!provSet.has(nProv)) {
                                const pIdx = (ly * mapW + lx) * 3;
                                pixels[pIdx] = (outColor >> 16) & 0xFF; pixels[pIdx + 1] = (outColor >> 8) & 0xFF; pixels[pIdx + 2] = outColor & 0xFF;
                                break;
                            }
                        }
                    }
                }
            }
        }

        return pixels;
    }

    /**
     * Build an SVG overlay for labels, railways, supply nodes
     */
    _buildSvgOverlay(mapX1, mapY1, mapW, mapH, zoom, opts = {}) {
        const { showLabels = false, showRailways = false, showSupplyNodes = false, highlights = [] } = opts;
        const { provinceToState } = this._buildLookups();
        const elements = [];

        // Railway lines
        if (showRailways && this.loader.railways) {
            for (const rail of this.loader.railways) {
                const points = [];
                for (const pId of rail.provinces) {
                    const p = this.loader.provinces[pId];
                    if (!p) continue;
                    const sx = (p.centerOfMass.x - mapX1) * zoom;
                    const sy = (p.centerOfMass.y - mapY1) * zoom;
                    points.push(`${sx},${sy}`);
                }
                if (points.length >= 2) {
                    const strokeW = Math.max(1, rail.level * 0.8 * zoom * 0.5);
                    elements.push(`<polyline points="${points.join(' ')}" fill="none" stroke="#FFD700" stroke-width="${strokeW}" stroke-opacity="0.7" stroke-linecap="round" stroke-linejoin="round"/>`);
                }
            }
        }

        // Supply node markers
        if (showSupplyNodes && this.loader.supplyNodes) {
            for (const node of this.loader.supplyNodes) {
                const p = this.loader.provinces[node.province];
                if (!p) continue;
                const sx = (p.centerOfMass.x - mapX1) * zoom;
                const sy = (p.centerOfMass.y - mapY1) * zoom;
                const r = Math.max(3, zoom * 2);
                elements.push(`<circle cx="${sx}" cy="${sy}" r="${r}" fill="#FF4444" stroke="white" stroke-width="1" opacity="0.9"/>`);
            }
        }

        // State labels
        if (showLabels) {
            const labeledStates = new Set();
            for (const s of this.loader.states.filter(Boolean)) {
                const center = this.loader.calculateStateCenterOfMass(s);
                const sx = (center.x - mapX1) * zoom;
                const sy = (center.y - mapY1) * zoom;
                // Check if in viewport
                if (sx < -50 || sx > mapW * zoom + 50 || sy < -20 || sy > mapH * zoom + 20) continue;
                const fontSize = Math.max(8, Math.min(14, zoom * 3));
                let displayName = s.name;
                if (this.loader.stateNames) {
                    const loc = this.loader.stateNames.get ? this.loader.stateNames.get(s.name) : this.loader.stateNames[s.name];
                    if (loc) displayName = loc;
                }
                // Escape XML entities
                displayName = displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                elements.push(`<text x="${sx}" y="${sy}" font-size="${fontSize}" fill="white" font-family="sans-serif" text-anchor="middle" stroke="black" stroke-width="0.5" paint-order="stroke">${displayName}</text>`);
                if (s.owner) {
                    elements.push(`<text x="${sx}" y="${sy + fontSize + 1}" font-size="${Math.max(7, fontSize - 2)}" fill="#aaa" font-family="sans-serif" text-anchor="middle" stroke="black" stroke-width="0.3" paint-order="stroke">${s.owner}</text>`);
                }
            }
        }

        // Highlight labels
        for (const hl of highlights) {
            if (!hl.label) continue;
            let cx, cy;
            if (hl.province_id !== undefined) {
                const p = this.loader.provinces[hl.province_id];
                if (p) { cx = p.centerOfMass.x; cy = p.centerOfMass.y; }
            } else if (hl.state_id !== undefined) {
                const s = this.loader.states[hl.state_id];
                if (s) { const c = this.loader.calculateStateCenterOfMass(s); cx = c.x; cy = c.y; }
            }
            if (cx !== undefined) {
                const sx = (cx - mapX1) * zoom;
                const sy = (cy - mapY1) * zoom;
                const label = hl.label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const fontSize = Math.max(10, zoom * 4);
                elements.push(`<text x="${sx}" y="${sy}" font-size="${fontSize}" fill="${hl.color || '#ffff00'}" font-family="sans-serif" text-anchor="middle" font-weight="bold" stroke="black" stroke-width="1" paint-order="stroke">${label}</text>`);
            }
        }

        if (elements.length === 0) return null;
        const svgW = mapW * zoom;
        const svgH = mapH * zoom;
        return Buffer.from(`<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">${elements.join('')}</svg>`);
    }

    async renderSnapshot(args) {
        if (!sharpAvailable) return { error: 'Sharp not installed. Install with: npm install sharp' };

        const zoom = Math.max(1, Math.min(8, args.zoom || 2));
        const outW = Math.min(2000, args.width || 800);
        const outH = Math.min(1500, args.height || 600);
        const view = args.view || 'political';
        const showBorders = args.show_borders !== false;
        const showLabels = args.show_labels || false;
        const showRailways = args.show_railways || false;
        const showSupplyNodes = args.show_supply_nodes || false;
        const highlights = args.highlights || [];

        // Calculate map region
        const mapW = Math.ceil(outW / zoom);
        const mapH = Math.ceil(outH / zoom);
        let cx, cy;

        if (args.center_province !== undefined) {
            const p = this.loader.provinces[args.center_province];
            if (!p) return { error: `Province ${args.center_province} not found` };
            cx = p.centerOfMass.x; cy = p.centerOfMass.y;
        } else if (args.center_state !== undefined) {
            const s = this.loader.states[args.center_state];
            if (!s) return { error: `State ${args.center_state} not found` };
            const c = this.loader.calculateStateCenterOfMass(s);
            cx = c.x; cy = c.y;
        } else if (args.center) {
            cx = args.center.x; cy = args.center.y;
        } else {
            cx = Math.floor(this.loader.mapWidth / 2);
            cy = Math.floor(this.loader.mapHeight / 2);
        }

        const mapX1 = Math.floor(cx - mapW / 2);
        const mapY1 = Math.floor(cy - mapH / 2);

        // Render base pixels
        const pixels = this._renderRegion(mapX1, mapY1, mapW, mapH, view, { showBorders, highlights, showRailways, showSupplyNodes });

        // Build image with sharp
        let image = sharp(pixels, { raw: { width: mapW, height: mapH, channels: 3 } })
            .resize(outW, outH, { kernel: 'nearest' });

        // Add SVG overlay
        const svg = this._buildSvgOverlay(mapX1, mapY1, mapW, mapH, zoom, { showLabels, showRailways, showSupplyNodes, highlights });
        if (svg) {
            image = sharp(await image.png().toBuffer())
                .composite([{ input: svg, top: 0, left: 0 }]);
        }

        const pngBuffer = await image.png().toBuffer();
        const base64 = pngBuffer.toString('base64');

        return {
            image_base64: base64,
            image_size: pngBuffer.length,
            dimensions: { width: outW, height: outH },
            map_bounds: { x1: mapX1, y1: mapY1, x2: mapX1 + mapW, y2: mapY1 + mapH },
            center: { x: cx, y: cy },
            zoom: zoom,
            view: view
        };
    }

    async renderStateView(args) {
        if (!sharpAvailable) return { error: 'Sharp not installed. Install with: npm install sharp' };

        const state = this.loader.states[args.state_id];
        if (!state) return { error: `State ${args.state_id} not found` };

        const padding = args.padding || 20;
        const showNeighbors = args.show_neighbors !== false;
        const showRailways = args.show_railways !== false;
        const showDetails = args.show_details !== false;

        // Calculate bounding box of all state provinces
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pId of state.provinces) {
            const p = this.loader.provinces[pId];
            if (!p) continue;
            const bb = p.boundingBox;
            if (bb.x < minX) minX = bb.x;
            if (bb.y < minY) minY = bb.y;
            if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
            if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
        }

        const stateW = maxX - minX;
        const stateH = maxY - minY;

        // Auto-calculate zoom to fit ~800px width
        const targetW = 800;
        const zoom = Math.max(1, Math.min(8, Math.floor(targetW / (stateW + padding * 2))));
        const mapX1 = minX - padding;
        const mapY1 = minY - padding;
        const mapW = stateW + padding * 2;
        const mapH = stateH + padding * 2;
        const outW = Math.min(2000, mapW * zoom);
        const outH = Math.min(1500, mapH * zoom);

        // Build highlights
        const highlights = [{
            state_id: args.state_id,
            outline: true,
            color: '#ffff00'
        }];

        // Add VP markers
        if (showDetails && state.victoryPoints) {
            for (const [pId, vp] of Object.entries(state.victoryPoints)) {
                highlights.push({
                    province_id: parseInt(pId),
                    color: vp >= 10 ? '#ff4444' : '#ffaa00',
                    label: `VP:${vp}`,
                    outline: false
                });
            }
        }

        // Render
        const pixels = this._renderRegion(mapX1, mapY1, mapW, mapH, 'political', {
            showBorders: true, highlights, showRailways, showSupplyNodes: true
        });

        let image = sharp(pixels, { raw: { width: mapW, height: mapH, channels: 3 } })
            .resize(outW, outH, { kernel: 'nearest' });

        const svg = this._buildSvgOverlay(mapX1, mapY1, mapW, mapH, zoom, {
            showLabels: showDetails, showRailways, showSupplyNodes: true, highlights
        });
        if (svg) {
            image = sharp(await image.png().toBuffer())
                .composite([{ input: svg, top: 0, left: 0 }]);
        }

        const pngBuffer = await image.png().toBuffer();

        return {
            image_base64: pngBuffer.toString('base64'),
            image_size: pngBuffer.length,
            dimensions: { width: outW, height: outH },
            state: { id: state.id, name: state.name, owner: state.owner },
            map_bounds: { x1: mapX1, y1: mapY1, x2: mapX1 + mapW, y2: mapY1 + mapH },
            zoom: zoom
        };
    }

    async renderMinimap(args) {
        if (!sharpAvailable) return { error: 'Sharp not installed. Install with: npm install sharp' };

        const targetW = Math.min(2000, args.width || 800);
        const view = args.view || 'political';
        const highlightStates = args.highlight_states || [];
        const highlightProvinces = args.highlight_provinces || [];

        const mapW = this.loader.mapWidth;
        const mapH = this.loader.mapHeight;
        const zoom = targetW / mapW;
        const outW = targetW;
        const outH = Math.round(mapH * zoom);

        // Build highlights
        const highlights = [];
        for (const sId of highlightStates) {
            highlights.push({ state_id: sId, outline: true, color: '#ffff00' });
        }
        for (const pId of highlightProvinces) {
            highlights.push({ province_id: pId, color: '#ff4444', outline: false });
        }

        // Render full map at 1:1
        const pixels = this._renderRegion(0, 0, mapW, mapH, view, { showBorders: true, highlights });

        // Downscale to target width
        const pngBuffer = await sharp(pixels, { raw: { width: mapW, height: mapH, channels: 3 } })
            .resize(outW, outH, { kernel: 'lanczos3' })
            .png()
            .toBuffer();

        return {
            image_base64: pngBuffer.toString('base64'),
            image_size: pngBuffer.length,
            dimensions: { width: outW, height: outH },
            map_dimensions: { width: mapW, height: mapH },
            view: view
        };
    }

    renderAscii(args) {
        const view = args.view || 'states';
        const radius = args.radius || 30;
        const step = args.sample_step || 4;

        // Determine center
        let cx, cy;
        if (args.center_province) {
            const p = this.loader.provinces[args.center_province];
            if (!p) return { error: `Province ${args.center_province} not found` };
            cx = p.centerOfMass.x;
            cy = p.centerOfMass.y;
        } else if (args.center) {
            cx = args.center.x;
            cy = args.center.y;
        } else {
            cx = Math.floor(this.loader.mapWidth / 2);
            cy = Math.floor(this.loader.mapHeight / 2);
        }

        // Build province-to-state and province-to-region maps
        const provinceToState = {};
        for (const s of this.loader.states.filter(Boolean)) {
            for (const pId of s.provinces) provinceToState[pId] = s.id;
        }

        // Render grid
        const halfW = radius;
        const halfH = Math.floor(radius * 0.6); // Aspect ratio correction
        const x1 = cx - halfW;
        const y1 = cy - halfH;
        const x2 = cx + halfW;
        const y2 = cy + halfH;

        const cols = Math.floor((x2 - x1) / step);
        const rows = Math.floor((y2 - y1) / step);
        const grid = [];
        const legend = new Map();

        for (let row = 0; row < rows; row++) {
            let line = '';
            for (let col = 0; col < cols; col++) {
                const mapX = x1 + col * step;
                const mapY = y1 + row * step;

                if (mapX < 0 || mapX >= this.loader.mapWidth || mapY < 0 || mapY >= this.loader.mapHeight) {
                    line += '  ';
                    continue;
                }

                // Look up province at this pixel from BMP data
                const idx = mapY * this.loader.mapWidth + mapX;
                const bmpIdx = idx * 3;
                let provinceId = null;

                if (this.loader.bmpData && bmpIdx + 2 < this.loader.bmpData.length) {
                    const r = this.loader.bmpData[bmpIdx];
                    const g = this.loader.bmpData[bmpIdx + 1];
                    const b = this.loader.bmpData[bmpIdx + 2];
                    const packed = (r << 16) | (g << 8) | b;
                    provinceId = this.loader.colorToProvinceId.get(packed);
                }

                if (provinceId === undefined || provinceId === null) {
                    line += '..';
                    continue;
                }

                const prov = this.loader.provinces[provinceId];
                if (!prov) { line += '..'; continue; }

                let cell;
                switch (view) {
                    case 'states': {
                        const sId = provinceToState[provinceId];
                        if (sId !== undefined) {
                            cell = String(sId % 100).padStart(2, ' ');
                            if (!legend.has(sId)) {
                                const st = this.loader.states[sId];
                                legend.set(sId, `${sId}=${st ? st.name : '?'}${st && st.owner ? '(' + st.owner + ')' : ''}`);
                            }
                        } else if (prov.type === 'sea') {
                            cell = '~~';
                        } else {
                            cell = '??';
                        }
                        break;
                    }
                    case 'terrain': {
                        const t = (prov.terrain || '?')[0].toUpperCase() + (prov.terrain || '?')[1];
                        cell = t.substring(0, 2);
                        if (!legend.has(prov.terrain)) legend.set(prov.terrain, prov.terrain);
                        break;
                    }
                    case 'type': {
                        cell = prov.type === 'sea' ? '~~' : prov.type === 'lake' ? 'LK' : 'LL';
                        break;
                    }
                    case 'provinces': {
                        cell = String(provinceId % 100).padStart(2, '0');
                        break;
                    }
                    default:
                        cell = '..';
                }
                line += cell;
            }
            grid.push(line);
        }

        // Build legend string
        const legendLines = [];
        for (const [key, val] of legend) {
            legendLines.push(val);
        }

        return {
            ascii: grid.join('\n'),
            legend: legendLines.slice(0, 30), // Cap legend size
            center: { x: cx, y: cy },
            bounds: { x1, y1, x2, y2 },
            view: view,
            note: view === 'states' ? 'Numbers show state_id % 100. Use map_get_state for full details.' :
                  view === 'terrain' ? 'First 2 letters of terrain type. Pl=plains, Fo=forest, Mo=mountain, etc.' :
                  view === 'provinces' ? 'Province ID % 100. Use map_get_province for details.' :
                  '~~ = sea, LK = lake, LL = land'
        };
    }
}

// ─── MCP Server Setup ─────────────────────────────────────────────────────────

async function startServer(workspacePath) {
    if (!mcpAvailable) {
        console.error('[MapMCP] MCP SDK not installed. Install with:');
        console.error('  npm install @modelcontextprotocol/sdk');
        console.error('Then restart the server.');
        process.exit(1);
    }

    console.error(`[MapMCP] Starting HOI4 Map MCP Server for: ${workspacePath}`);

    const loader = new MapDataLoader(workspacePath);
    const handler = new MapMcpToolHandler(loader);

    const server = new Server(
        { name: 'hoi4-map', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );

    // Register tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOLS };
    });

    // Register tool call handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            const result = await handler.handle(name, args || {});

            // For snapshot tools, return image + metadata as separate content blocks
            if (result.image_base64) {
                const { image_base64, ...metadata } = result;
                return {
                    content: [
                        {
                            type: 'image',
                            data: image_base64,
                            mimeType: 'image/png'
                        },
                        {
                            type: 'text',
                            text: JSON.stringify(metadata, null, 2)
                        }
                    ]
                };
            }

            // For image-to-map tools, return preview image + text metadata
            if (result._image) {
                return {
                    content: [
                        {
                            type: 'image',
                            data: result._image,
                            mimeType: 'image/png'
                        },
                        {
                            type: 'text',
                            text: result._text || JSON.stringify({ ...result, _image: undefined, _text: undefined }, null, 2)
                        }
                    ]
                };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ error: error.message })
                }],
                isError: true
            };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MapMCP] Server connected and ready');
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (require.main === module) {
    const workspacePath = process.argv[2];
    if (!workspacePath) {
        console.error('Usage: node mapMcpServer.js /path/to/hoi4/mod');
        console.error('');
        console.error('The path should point to your HOI4 mod directory containing:');
        console.error('  map/provinces.bmp, map/definition.csv, history/states/, etc.');
        process.exit(1);
    }

    const resolved = path.resolve(workspacePath);
    startServer(resolved).catch(err => {
        console.error('[MapMCP] Fatal error:', err);
        process.exit(1);
    });
}

// Export for extension integration
exports.MapMcpToolHandler = MapMcpToolHandler;
exports.startServer = startServer;
exports.TOOLS = TOOLS;
exports.mcpAvailable = mcpAvailable;
exports.sharpAvailable = sharpAvailable;
