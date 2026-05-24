---
name: hoi4-map
description: "Query and edit HOI4 map data: provinces, states, strategic regions, terrain, railways, supply nodes, victory points. Generate map snapshots and ASCII renders. Create, transfer, and edit states and provinces. Convert images to HOI4 maps."
---

# HOI4 Map Tools

Uses the CLI tool `scripts/hoi4-mcp-cli.js` from the project root.

## Setup

```bash
cd /path/to/mod
```

## Basic Queries

### Map Summary

```bash
node scripts/hoi4-mcp-cli.js map_get_summary
```

### Province Info

```bash
node scripts/hoi4-mcp-cli.js map_get_province --province_id <ID>
```

Fields: RGB color, type (land/sea/lake), terrain, coastal, continent, center, pixels, neighbors, state_id, strategic_region_id, victory_points.

### Search Provinces

```bash
node scripts/hoi4-mcp-cli.js map_search_provinces --terrain plains --limit 20
node scripts/hoi4-mcp-cli.js map_search_provinces --type land --coastal true --has_victory_points true
```

Filters: `type`, `terrain`, `coastal`, `continent`, `state_id`, `strategic_region_id`, `min_pixels`, `has_victory_points`, `adjacent_to`, `limit` (default 100).

### State Info

```bash
node scripts/hoi4-mcp-cli.js map_get_state --state_id <ID>
```

Fields: name, owner, manpower, category, provinces, resources, victory_points, buildings, cores, center_of_mass.

### Search States

```bash
node scripts/hoi4-mcp-cli.js map_search_states --owner GER --category city
node scripts/hoi4-mcp-cli.js map_search_states --has_resource oil --min_manpower 100000
```

Filters: `owner`, `category`, `has_resource`, `min_manpower`, `has_core`, `min_victory_points`, `impassable`, `limit`.

### Strategic Region

```bash
node scripts/hoi4-mcp-cli.js map_get_strategic_region --region_id <ID>
```

### Province Adjacencies

```bash
node scripts/hoi4-mcp-cli.js map_get_adjacencies --province_id <ID>
node scripts/hoi4-mcp-cli.js map_get_adjacencies --province_id <ID> --include_sea false
```

### Supply Network

```bash
node scripts/hoi4-mcp-cli.js map_get_supply_network
node scripts/hoi4-mcp-cli.js map_get_supply_network --state_id <ID>
```

### Countries

```bash
node scripts/hoi4-mcp-cli.js map_get_countries
node scripts/hoi4-mcp-cli.js map_get_countries --tag GER
```

### Map Validation

```bash
node scripts/hoi4-mcp-cli.js map_validate
node scripts/hoi4-mcp-cli.js map_validate --category provinces
```

Categories: `all` (default), `provinces`, `states`, `supply`, `adjacency`.

### Terrain Types

```bash
node scripts/hoi4-mcp-cli.js map_get_terrain_info
```

## Visualization

### ASCII Render

```bash
node scripts/hoi4-mcp-cli.js map_render_ascii --center_province <ID> --radius 30 --view states
node scripts/hoi4-mcp-cli.js map_render_ascii --center_province <ID> --view terrain --sample_step 6
```

`view` modes: `states` (default), `provinces`, `terrain`, `type`.

### Map Snapshot (PNG, base64)

```bash
node scripts/hoi4-mcp-cli.js map_render_snapshot --center_province <ID> --zoom 2 --view political
node scripts/hoi4-mcp-cli.js map_render_snapshot --center_state <ID> --view terrain --show_labels true --show_railways true
```

Parameters: `center_province`, `center_state`, `center` (x,y), `zoom` (1-8, default 2), `width` (default 800), `height` (default 600), `view` (political, terrain, provinces, type, manpower, industry, victory_points, state_category), `show_borders`, `show_labels`, `show_railways`, `show_supply_nodes`, `highlights` (array of {province_id, state_id, color, outline, label}).

### State Focus View

```bash
node scripts/hoi4-mcp-cli.js map_render_state_view --state_id <ID>
node scripts/hoi4-mcp-cli.js map_render_state_view --state_id <ID> --show_neighbors false --show_railways true
```

### Minimap

```bash
node scripts/hoi4-mcp-cli.js map_render_minimap --view political
node scripts/hoi4-mcp-cli.js map_render_minimap --highlight_states [1,2,3]
```

## Editing

> **Warning:** All edit commands create a backup before writing.

### Edit State

```bash
node scripts/hoi4-mcp-cli.js map_edit_state --state_id <ID> --owner GER --manpower 500000
node scripts/hoi4-mcp-cli.js map_edit_state --state_id <ID> --resources '{"steel":10,"oil":5}' --category metropolis
```

Fields: `owner`, `manpower`, `category`, `resources`, `buildings`, `add_cores`, `remove_cores`.

### Create State

```bash
node scripts/hoi4-mcp-cli.js map_create_state --name "New State" --provinces [1,2,3] --owner GER
```

### Transfer Provinces

```bash
node scripts/hoi4-mcp-cli.js map_transfer_provinces --province_ids [1,2,3] --target_state_id <ID>
```

### Victory Point

```bash
node scripts/hoi4-mcp-cli.js map_edit_victory_point --province_id <ID> --value 10
node scripts/hoi4-mcp-cli.js map_edit_victory_point --province_id <ID> --value 0  # remove
```

### Railways

```bash
node scripts/hoi4-mcp-cli.js map_edit_railway --action list
node scripts/hoi4-mcp-cli.js map_edit_railway --action add --level 3 --provinces [1,2,3]
node scripts/hoi4-mcp-cli.js map_edit_railway --action remove --index 0
```

### Supply Nodes

```bash
node scripts/hoi4-mcp-cli.js map_edit_supply_node --action add --province_id <ID> --level 5
node scripts/hoi4-mcp-cli.js map_edit_supply_node --action remove --province_id <ID>
```

### Strategic Region

```bash
node scripts/hoi4-mcp-cli.js map_edit_strategic_region --region_id <ID> --name "New Name"
node scripts/hoi4-mcp-cli.js map_edit_strategic_region --region_id <ID> --provinces [1,2,3] --naval_terrain null
```

### Province

```bash
node scripts/hoi4-mcp-cli.js map_edit_province --province_id <ID> --terrain forest --coastal true
```

### Bulk Edit

```bash
node scripts/hoi4-mcp-cli.js map_bulk_edit --operations '[{"tool":"edit_state","args":{"state_id":1,"owner":"GER"}}]' --dry_run true
```

### Manual Backup

```bash
node scripts/hoi4-mcp-cli.js map_create_backup
node scripts/hoi4-mcp-cli.js map_create_backup --label "before_big_change"
```

## Image to Map Conversion

```bash
node scripts/hoi4-mcp-cli.js map_preview_image_regions --image_path "C:/path/to/image.png"
node scripts/hoi4-mcp-cli.js map_generate_from_image --image_path "C:/path/to/image.png" --output_dir "C:/output/mod"
```

> **Note:** `map_generate_from_image` and `map_preview_image_regions` require the `sharp` package in `scripts/mcp/node_modules/`.

## Interactive Mode

```bash
node scripts/hoi4-mcp-cli.js --interactive
```

## Help

```bash
node scripts/hoi4-mcp-cli.js --help
node scripts/hoi4-mcp-cli.js --list
```
