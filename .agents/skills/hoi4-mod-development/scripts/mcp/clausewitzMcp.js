"use strict";
/**
 * Clausewitz Script Intelligence for MCP Server (Phase 5)
 * 
 * Provides:
 * - Generic Clausewitz file parser (key-value + nested blocks)
 * - Mod-wide definition indexer (events, focuses, decisions, ideas, etc.)
 * - File search (grep-like) across entire mod
 * - Effect/trigger reference database (from wiki server data)
 * - Localization search/read/write
 * - Scope context analysis
 */

const fs = require('fs');
const path = require('path');

// ─── Clausewitz Parser ─────────────────────────────────────────────────────────

/**
 * Tokenize + parse a Clausewitz script file into a structured tree.
 * Handles: key = value, key = { block }, comments (#), quoted strings, 
 * comparisons (< > <=  >=), lists of values in blocks.
 */
function parseClausewitz(text) {
    const root = { type: 'root', children: [], comments: [] };
    const stack = [root];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const lineNum = i + 1;

        // Extract comment
        let comment = null;
        const commentIdx = findCommentStart(line);
        if (commentIdx >= 0) {
            comment = line.substring(commentIdx + 1).trim();
            line = line.substring(0, commentIdx);
        }

        line = line.trim();
        if (!line && comment) {
            root.comments.push({ line: lineNum, text: comment });
            continue;
        }
        if (!line) continue;

        // Process tokens on this line
        let pos = 0;
        while (pos < line.length) {
            // Skip whitespace
            while (pos < line.length && /\s/.test(line[pos])) pos++;
            if (pos >= line.length) break;

            const current = stack[stack.length - 1];

            // Closing brace
            if (line[pos] === '}') {
                if (stack.length > 1) stack.pop();
                pos++;
                continue;
            }

            // Read a token (key or value)
            const token = readToken(line, pos);
            if (!token) { pos++; continue; }
            pos = token.end;

            // Skip whitespace
            while (pos < line.length && /\s/.test(line[pos])) pos++;

            // Check for operator
            let operator = '=';
            if (pos < line.length && (line[pos] === '=' || line[pos] === '<' || line[pos] === '>')) {
                operator = line[pos];
                pos++;
                if (pos < line.length && line[pos] === '=') { operator += '='; pos++; }
                // Skip whitespace after operator
                while (pos < line.length && /\s/.test(line[pos])) pos++;

                // Read value or opening brace
                if (pos < line.length && line[pos] === '{') {
                    // Block
                    const block = { type: 'block', key: token.value, line: lineNum, operator, children: [], comment };
                    current.children.push(block);
                    stack.push(block);
                    pos++;
                } else if (pos < line.length) {
                    const valToken = readToken(line, pos);
                    if (valToken) {
                        current.children.push({ type: 'kv', key: token.value, value: valToken.value, operator, line: lineNum, comment });
                        pos = valToken.end;
                    }
                }
            } else {
                // Bare value (inside a list block, e.g., provinces = { 1 2 3 })
                current.children.push({ type: 'value', value: token.value, line: lineNum });
            }
        }
    }

    return root;
}

function findCommentStart(line) {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuote = !inQuote;
        if (line[i] === '#' && !inQuote) return i;
    }
    return -1;
}

function readToken(line, pos) {
    if (pos >= line.length) return null;
    // Quoted string
    if (line[pos] === '"') {
        let end = pos + 1;
        while (end < line.length && line[end] !== '"') end++;
        if (end < line.length) end++; // include closing quote
        return { value: line.substring(pos + 1, end - 1), end, quoted: true };
    }
    // Unquoted token
    let end = pos;
    while (end < line.length && !/[\s=<>{}#]/.test(line[end])) end++;
    if (end === pos) return null;
    return { value: line.substring(pos, end), end, quoted: false };
}

// ─── Mod Indexer ────────────────────────────────────────────────────────────────

class ModIndexer {
    constructor(workspaceRoot) {
        this.root = workspaceRoot;
        this.definitions = new Map(); // name -> [{type, file, line, extra}]
        this.files = []; // all indexed file paths
        this.localizations = new Map(); // key -> [{language, value, file, line}]
        this.loaded = false;
    }

    async ensureLoaded() {
        if (this.loaded) return;
        console.error('[ClausewitzMCP] Indexing mod files...');
        const t0 = Date.now();
        await this.indexAll();
        console.error(`[ClausewitzMCP] Indexed ${this.definitions.size} definitions, ${this.localizations.size} loc keys from ${this.files.length} files in ${Date.now() - t0}ms`);
        this.loaded = true;
    }

    async indexAll() {
        await this._indexDirectory('');
        await this._indexLocalizations();
    }

    async _indexDirectory(rel) {
        const dir = path.join(this.root, rel);
        if (!fs.existsSync(dir)) return;
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
        catch (e) { return; }

        for (const entry of entries) {
            const entryRel = path.join(rel, entry.name);
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            if (entry.isDirectory()) {
                await this._indexDirectory(entryRel);
            } else if (entry.name.endsWith('.txt')) {
                await this._indexFile(entryRel);
            }
        }
    }

    async _indexFile(rel) {
        const filePath = path.join(this.root, rel);
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            this.files.push(rel);
            const lower = rel.toLowerCase().replace(/\\/g, '/');

            // Events
            if (lower.includes('event') || content.includes('country_event') || content.includes('news_event')) {
                this._indexEvents(content, rel);
            }
            // Focus trees
            if (lower.includes('national_focus') || lower.includes('focus')) {
                this._indexFocuses(content, rel);
            }
            // Decisions
            if (lower.includes('decisions')) {
                this._indexDecisions(content, rel);
            }
            // Ideas
            if (lower.includes('common/ideas') || lower.includes('common\\ideas')) {
                this._indexIdeas(content, rel);
            }
            // Scripted effects
            if (lower.includes('scripted_effects')) {
                this._indexScriptedBlocks(content, rel, 'scripted_effect');
            }
            // Scripted triggers
            if (lower.includes('scripted_triggers')) {
                this._indexScriptedBlocks(content, rel, 'scripted_trigger');
            }
            // Scripted GUIs - nested inside scripted_gui = { name = { ... } }
            if (lower.includes('scripted_guis')) {
                this._indexNestedBlocks(content, rel, 'scripted_gui', 'scripted_gui');
            }
            // Technologies
            if (lower.includes('technologies')) {
                this._indexScriptedBlocks(content, rel, 'technology');
            }
            // On actions
            if (lower.includes('on_actions')) {
                this._indexScriptedBlocks(content, rel, 'on_action');
            }
            // Characters
            if (lower.includes('characters')) {
                this._indexCharacters(content, rel);
            }
            // Country history
            if (lower.includes('history/countries') || lower.includes('history\\countries')) {
                this._indexCountryHistory(content, rel);
            }
            // Always index flags
            this._indexFlags(content, rel);
        } catch (e) {
            // skip unreadable files
        }
    }

    _addDef(name, type, rel, line, extra) {
        const existing = this.definitions.get(name) || [];
        existing.push({ type, file: rel, line, ...extra });
        this.definitions.set(name, existing);
    }

    _indexEvents(content, rel) {
        const regex = /^\s*(country_event|news_event|state_event|unit_leader_event)\s*=\s*\{/gm;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const line = content.substring(0, match.index).split('\n').length;
            // Find id within the block
            const blockStart = content.indexOf('{', match.index);
            const idMatch = content.substring(blockStart, blockStart + 500).match(/id\s*=\s*([a-zA-Z0-9_.]+)/);
            if (idMatch) {
                this._addDef(idMatch[1], 'event', rel, line, { eventType: match[1] });
            }
        }
    }

    _indexFocuses(content, rel) {
        const regex = /^\s*focus\s*=\s*\{/gm;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const line = content.substring(0, match.index).split('\n').length;
            const blockStart = content.indexOf('{', match.index);
            const idMatch = content.substring(blockStart, blockStart + 500).match(/id\s*=\s*([a-zA-Z0-9_]+)/);
            if (idMatch) {
                this._addDef(idMatch[1], 'focus', rel, line);
            }
        }
    }

    _indexDecisions(content, rel) {
        const lines = content.split('\n');
        let depth = 0;
        let inCategory = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.replace(/#.*$/, '').trim();

            for (const ch of trimmed) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }

            // Decision categories are at depth 1, decisions at depth 2
            if (depth >= 2) {
                const decMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*\{/);
                if (decMatch && !['icon', 'allowed', 'available', 'visible', 'complete_effect', 'remove_effect', 'modifier', 'cost', 'fire_only_once', 'days_remove', 'days_re_enable', 'ai_will_do', 'targets', 'target_trigger', 'target_root_trigger'].includes(decMatch[1])) {
                    this._addDef(decMatch[1], 'decision', rel, i + 1);
                }
            }
        }
    }

    _indexIdeas(content, rel) {
        const lines = content.split('\n');
        let depth = 0;
        // idea categories to skip (these are container blocks, not actual ideas)
        const categories = ['ideas', 'country', 'advisor', 'hidden_ideas', 'tank_manufacturer', 'naval_manufacturer',
            'aircraft_manufacturer', 'industrial_concern', 'materiel_manufacturer', 'political_advisor',
            'army_chief', 'navy_chief', 'air_chief', 'high_command', 'theorist', 'laws', 'mobilization_laws',
            'trade_laws', 'economy', 'consciousness_laws'];
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].replace(/#.*$/, '').trim();
            for (const ch of trimmed) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            if (depth >= 2) {
                const m = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*\{/);
                if (m && !categories.includes(m[1]) && !['modifier', 'equipment_bonus', 'research_bonus', 'allowed', 'visible', 'available', 'on_add', 'on_remove', 'ai_will_do', 'cancel', 'removal_cost', 'picture', 'traits'].includes(m[1])) {
                    this._addDef(m[1], 'idea', rel, i + 1);
                }
            }
        }
    }

    _indexScriptedBlocks(content, rel, type) {
        const lines = content.split('\n');
        let depth = 0;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].replace(/#.*$/, '').trim();
            const prevDepth = depth;
            for (const ch of trimmed) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            // Top-level definitions
            if (prevDepth === 0) {
                const m = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*\{/);
                if (m) {
                    this._addDef(m[1], type, rel, i + 1);
                }
            }
        }
    }

    /** Index nested blocks like scripted_gui = { actual_name = { ... } } */
    _indexNestedBlocks(content, rel, type, wrapperKeyword) {
        const lines = content.split('\n');
        let depth = 0;
        let inWrapper = false;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].replace(/#.*$/, '').trim();
            const prevDepth = depth;
            for (const ch of trimmed) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            if (prevDepth === 0 && trimmed.startsWith(wrapperKeyword)) {
                inWrapper = true;
                continue;
            }
            // Depth 1 inside wrapper = actual definitions
            if (inWrapper && prevDepth === 1) {
                const m = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*\{/);
                if (m && !['context_type', 'window_name', 'visible', 'effects', 'triggers', 'properties', 'ai_enabled', 'ai_test', 'ai_weights'].includes(m[1])) {
                    this._addDef(m[1], type, rel, i + 1);
                }
            }
            if (depth === 0) inWrapper = false;
        }
    }

    _indexCharacters(content, rel) {
        const regex = /^\s*([a-zA-Z0-9_]+)\s*=\s*\{[^}]*?name\s*=/gm;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const line = content.substring(0, match.index).split('\n').length;
            this._addDef(match[1], 'character', rel, line);
        }
    }

    _indexCountryHistory(content, rel) {
        const basename = path.basename(rel, '.txt');
        const tagMatch = basename.match(/^([A-Z]{3})/);
        if (tagMatch) {
            this._addDef(tagMatch[1], 'country_history', rel, 1);
        }
    }

    _indexFlags(content, rel) {
        const flagPatterns = [
            { regex: /(?:set|has|clr)_country_flag\s*=\s*(?:\{\s*flag\s*=\s*)?([a-zA-Z0-9_]+)/g, type: 'country_flag' },
            { regex: /(?:set|has|clr)_global_flag\s*=\s*(?:\{\s*flag\s*=\s*)?([a-zA-Z0-9_]+)/g, type: 'global_flag' },
            { regex: /(?:set|has|clr)_state_flag\s*=\s*(?:\{\s*flag\s*=\s*)?([a-zA-Z0-9_]+)/g, type: 'state_flag' },
            { regex: /set_variable\s*=\s*\{\s*(?:var\s*=\s*)?([a-zA-Z0-9_]+)/g, type: 'variable' },
            { regex: /check_variable\s*=\s*\{\s*(?:var\s*=\s*)?([a-zA-Z0-9_]+)/g, type: 'variable' },
        ];
        for (const p of flagPatterns) {
            let m;
            while ((m = p.regex.exec(content)) !== null) {
                const line = content.substring(0, m.index).split('\n').length;
                this._addDef(m[1], p.type, rel, line);
            }
        }
    }

    // ── Localization ──

    async _indexLocalizations() {
        const locDirs = ['localisation', 'localization'];
        for (const locDir of locDirs) {
            await this._indexLocDir(path.join(this.root, locDir), '');
        }
    }

    async _indexLocDir(dir, langOverride) {
        if (!fs.existsSync(dir)) return;
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                await this._indexLocDir(path.join(dir, entry.name), entry.name);
            } else if (entry.name.endsWith('.yml')) {
                await this._indexLocFile(path.join(dir, entry.name), langOverride);
            }
        }
    }

    async _indexLocFile(filePath, langHint) {
        try {
            let text = await fs.promises.readFile(filePath, 'utf-8');
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const rel = path.relative(this.root, filePath);

            const languages = ['english', 'german', 'french', 'spanish', 'russian', 'polish', 'braz_por', 'japanese', 'simp_chinese'];
            let currentLang = langHint && languages.includes(langHint) ? langHint : null;

            // Detect from filename
            if (!currentLang) {
                const suffixMatch = path.basename(filePath).match(/_l_([a-z_]+)\.yml$/);
                if (suffixMatch && languages.includes(suffixMatch[1])) currentLang = suffixMatch[1];
            }

            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const langMatch = lines[i].match(/^\s*l_([a-z_]+):/);
                if (langMatch) { currentLang = langMatch[1]; continue; }

                const entryMatch = lines[i].match(/^\s*([a-zA-Z0-9_.\-]+):(\d*)\s*"(.*)"/);
                if (entryMatch) {
                    const key = entryMatch[1];
                    const value = entryMatch[3];
                    const lang = currentLang || 'english';
                    const existing = this.localizations.get(key) || [];
                    existing.push({ language: lang, value, file: rel, line: i + 1 });
                    this.localizations.set(key, existing);
                }
            }
        } catch (e) { /* skip */ }
    }

    // ── Search ──

    searchDefinitions(query, types) {
        const results = [];
        const lower = query.toLowerCase();
        for (const [name, defs] of this.definitions) {
            if (name.toLowerCase().includes(lower)) {
                for (const def of defs) {
                    if (!types || types.includes(def.type)) {
                        results.push({ name, ...def });
                    }
                }
            }
        }
        return results;
    }

    findDefinition(name) {
        return this.definitions.get(name) || [];
    }

    findDefinitionsByType(type) {
        const results = [];
        for (const [name, defs] of this.definitions) {
            for (const def of defs) {
                if (def.type === type) results.push({ name, ...def });
            }
        }
        return results;
    }

    async searchFiles(pattern, options = {}) {
        const regex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
        const results = [];
        const maxResults = options.maxResults || 100;
        const fileFilter = options.filePattern ? new RegExp(options.filePattern, 'i') : null;

        for (const rel of this.files) {
            if (fileFilter && !fileFilter.test(rel)) continue;
            try {
                const content = await fs.promises.readFile(path.join(this.root, rel), 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        results.push({
                            file: rel,
                            line: i + 1,
                            text: lines[i].trim(),
                            context: {
                                before: i > 0 ? lines[i - 1].trim() : null,
                                after: i < lines.length - 1 ? lines[i + 1].trim() : null
                            }
                        });
                        if (results.length >= maxResults) return results;
                    }
                    regex.lastIndex = 0;
                }
            } catch (e) { /* skip */ }
        }
        return results;
    }

    async findReferences(name) {
        return this.searchFiles(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, { maxResults: 200 });
    }
}

// ─── Wiki Database ──────────────────────────────────────────────────────────────

// Load the wiki database from the extension's hoi4WikiServer.js
let wikiDB = null;
function getWikiDB() {
    if (wikiDB) return wikiDB;
    try {
        // The wiki server exports the DB as part of the class, we need to extract it
        const wikiPath = path.join(__dirname, 'hoi4WikiServer.js');
        const wikiSource = fs.readFileSync(wikiPath, 'utf-8');
        // Extract the DB array - it's between "const DB = [" and "];"
        const dbStart = wikiSource.indexOf('const DB = [');
        if (dbStart < 0) return [];
        const arrayStart = wikiSource.indexOf('[', dbStart);
        let depth = 0, end = arrayStart;
        for (let i = arrayStart; i < wikiSource.length; i++) {
            if (wikiSource[i] === '[') depth++;
            if (wikiSource[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        const dbStr = wikiSource.substring(arrayStart, end);
        // Evaluate the array (it's valid JS)
        wikiDB = eval(dbStr);
        console.error(`[ClausewitzMCP] Loaded ${wikiDB.length} wiki entries`);
        return wikiDB;
    } catch (e) {
        console.error('[ClausewitzMCP] Failed to load wiki DB:', e.message);
        return [];
    }
}

// ─── Scope Analyzer ─────────────────────────────────────────────────────────────

const SCOPE_TRANSITIONS = {
    // Effects that change scope
    'every_country': 'country', 'random_country': 'country', 'every_enemy_country': 'country',
    'every_allied_country': 'country', 'every_neighbor_country': 'country',
    'every_state': 'state', 'random_state': 'state', 'every_owned_state': 'state',
    'every_controlled_state': 'state', 'every_neighbor_state': 'state',
    'every_unit_leader': 'unit_leader', 'random_unit_leader': 'unit_leader',
    'every_army_leader': 'unit_leader', 'every_navy_leader': 'unit_leader',
    'every_operative': 'operative', 'random_operative': 'operative',
    'controller': 'country', 'owner': 'country', 'OWNER': 'country',
    'FROM': 'country', 'ROOT': 'country', 'PREV': 'country', 'THIS': 'country',
    'capital_scope': 'state', 'any_state': 'state', 'any_owned_state': 'state',
};

function analyzeScope(content, targetLine) {
    const lines = content.split('\n');
    const scopes = [{ scope: 'unknown', line: 0 }];

    // Determine root scope from file context
    for (let i = 0; i < Math.min(20, lines.length); i++) {
        const line = lines[i].trim();
        if (/^(country_event|news_event)\s*=/.test(line)) { scopes[0] = { scope: 'country', line: i + 1 }; break; }
        if (/^state_event\s*=/.test(line)) { scopes[0] = { scope: 'state', line: i + 1 }; break; }
        if (/^focus\s*=/.test(line)) { scopes[0] = { scope: 'country', line: i + 1 }; break; }
        if (/^state\s*=\s*\{/.test(line)) { scopes[0] = { scope: 'state', line: i + 1 }; break; }
    }

    let depth = 0;
    const scopeStack = [scopes[0].scope];

    for (let i = 0; i < lines.length && i < targetLine; i++) {
        const line = lines[i].replace(/#.*$/, '').trim();
        for (let j = 0; j < line.length; j++) {
            if (line[j] === '{') {
                // Check if a scope transition keyword precedes this brace
                const before = line.substring(0, j).trim();
                const keyMatch = before.match(/(\w+)\s*=\s*$/);
                if (keyMatch && SCOPE_TRANSITIONS[keyMatch[1]]) {
                    scopeStack.push(SCOPE_TRANSITIONS[keyMatch[1]]);
                } else {
                    scopeStack.push(scopeStack[scopeStack.length - 1]);
                }
                depth++;
            }
            if (line[j] === '}') {
                if (scopeStack.length > 1) scopeStack.pop();
                depth--;
            }
        }
    }

    return {
        current_scope: scopeStack[scopeStack.length - 1],
        scope_stack: scopeStack,
        depth: depth
    };
}

// ─── Exports ────────────────────────────────────────────────────────────────────

exports.parseClausewitz = parseClausewitz;
exports.ModIndexer = ModIndexer;
exports.getWikiDB = getWikiDB;
exports.analyzeScope = analyzeScope;
exports.SCOPE_TRANSITIONS = SCOPE_TRANSITIONS;
