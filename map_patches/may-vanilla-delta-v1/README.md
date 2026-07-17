# May-vanilla → current-mod map delta snapshot

Captured from Git commit `cc07087` before any vanilla-map reset.

This is a semantic/raw snapshot, not a Git diff.

## Preserved geometry

- May vanilla provinces: **13,382** (`0..13381`)
- Current mod provinces: **13,387** (`0..13386`)
- Custom province IDs: **13382–13386**
- Changed pixels in `provinces.bmp`: **2,043**
- Pixel transition records: **37**, represented by **297 exact row runs**
- Verification: applying all transition runs to May `provinces.bmp` reconstructs the current mod bitmap exactly.

| Province | RGB | Pixels | Current state | Current strategic region |
|---:|---|---:|---:|---:|
| 13382 | 57,52,104 | 268 | 907 | 128 |
| 13383 | 204,88,176 | 145 | 452 | 299 |
| 13384 | 175,99,119 | 221 | 907 | 128 |
| 13385 | 199,182,227 | 99 | 663 | 299 |
| 13386 | 193,100,141 | 205 | 452 | 299 |

## State topology changes

No new state IDs were created. Province membership changed in seven existing states:

- 118 Gibraltar
- 169 Sevilla
- 273 Italian Africa
- 452 Marsa Matruh
- 552 Western Egypt
- 663 Cyrenaica
- 907 Cairo

Exact added/removed province sets are in `state-topology-delta.json`.

## Strategic-region topology changes

- Added region IDs: **299 Western Egypt**, **300 Southern Egypt**
- Existing-region membership changed: **127, 128, 173, 207, 225**
- Region 173→207 moves province 2455 into the Danish Belts.

Exact memberships and raw files are preserved in `strategic-region-topology-delta.json` and `snapshot/`.

## Reference safety data

`id-references.json` preserves every textual occurrence of custom province IDs, affected state IDs, and affected/new strategic-region IDs. It intentionally contains false positives; later remapping must classify them rather than silently omit possible references.

## Raw snapshots

`snapshot/base/` and `snapshot/mod/` contain both sides of:

- `map/provinces.bmp`, `definition.csv`, adjacency/position/building/supply/railway/unitstack files;
- all state files;
- all strategic-region files.

Every copied file has SHA-256 and size in `manifest.json`.
