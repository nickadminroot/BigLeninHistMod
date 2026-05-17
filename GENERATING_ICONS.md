
## Generating Icons - !!Does not work right now!!

### Single Icon Generation

Use `scripts/generate-single-focus-icon.py` to generate a custom focus or idea icon via ComfyUI (Z-Image GGUF model). The script handles the full pipeline: generation, background removal, transparent margin cropping, alpha hole filling, DDS conversion, and .gfx registration.

**Prerequisites:**
- ComfyUI running on `http://127.0.0.1:8188`
- `rembg` Python package installed (`pip install rembg`)
- Z-Image GGUF model available in ComfyUI (`z-image-Q8_0.gguf`)

**Usage — Focus icon (with medal frame, laurel branches):**

```bash
python3 scripts/generate-single-focus-icon.py \
  --focus \
  --sprite-name "GFX_focus_custom_MY_FOCUS_ID" \
  --desc "A Soviet T-34 tank breaking through a shattered defensive line, artillery flashes in the background, red banner rising behind the tank"
```

**Usage — Idea icon (no frame, no laurels, just the symbol):**

```bash
python3 scripts/generate-single-focus-icon.py \
  --idea \
  --sprite-name "GFX_idea_custom_MY_IDEA_ID" \
  --desc "A steel M35 helmet covered in thick snow and icicles hanging from the brim"
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `--focus` | No | Generate a focus icon with medal frame and laurel branches (default). |
| `--idea` | No | Generate an idea icon — no frame, no medallion, no laurels. |
| `--sprite-name` | Yes | GFX sprite name. For `--focus` must start with `GFX_focus_custom_`; for `--idea` must start with `GFX_idea_custom_`. |
| `--desc` | Yes | Description of the central image/object. Be specific — name concrete objects, not abstract concepts. |
| `--seed` | No | Random seed (0=random). Use a fixed seed to reproduce results. |
| `--steps` | No | Sampler steps (default: 35). |
| `--cfg` | No | CFG scale (default: 4.0). |
| `--ai-size` | No | Generation resolution (default: 512). Use 1024 for higher quality. |
| `--force` | No | Regenerate even if DDS already exists. |

**What the script does:**
1. Generates a 512x512 (or 1024x1024) image via ComfyUI using Z-Image GGUF
2. Removes background with `rembg`
3. Crops transparent margins at full resolution (preserves detail)
4. Fills internal alpha holes (prevents cutouts inside the icon)
5. Downsizes to DDS — 100x88 for focus icons, 65x67 for idea icons (ARGB8888, no compression)
6. Appends a `SpriteType` entry to `BigLeninHistMod/interface/custom_focus_icons.gfx` (for `--focus`) or `BigLeninHistMod/interface/custom_idea_icons.gfx` (for `--idea`)

**Writing good descriptions:**

Each description should describe **ONE concrete visual object** — not abstract concepts. The model generates better results when given specific, visualizable subjects.

| Bad (abstract) | Good (concrete) |
|----------------|-----------------|
| "preparation for winter, equipment, snow" | "a steel M35 helmet covered in thick snow and icicles hanging from the brim" |
| "final blow, artillery attack, battle" | "a 150mm howitzer firing, muzzle flash and powder smoke" |
| "victory or death, decisive attack" | "a military banner with an Iron Cross, fabric tearing in the wind" |
| "supply routes, logistics" | "a long freight train with tanker cars crossing a railway bridge" |

**Description template:**
```
[Theme name]. Central image: [concrete object 1], [concrete object 2], [background element].
```

Example:
```
Operation Bagration. Central image: a Soviet T-34 tank breaking through a shattered enemy defensive line, with a torn front-line map beneath it, artillery flashes in the background, and a red banner rising behind the tank.
```

**After generation:**
- Focus DDS: `BigLeninHistMod/gfx/interface/goals/focus_custom_{ID}.dds`, registered in `custom_focus_icons.gfx`
- Idea DDS: `BigLeninHistMod/gfx/interface/ideas/idea_custom_{ID}.dds`, registered in `custom_idea_icons.gfx`
- Reference in focus: `icon = GFX_focus_custom_MY_FOCUS_ID`
- Reference in idea: `picture = custom_MY_IDEA_ID` (engine auto-prepends `GFX_idea_`)

### Batch Icon Generation

For generating many icons at once, use `scripts/generate-zimage-focus-icons.py`. It reads focus IDs from `focuses.txt` and generates icons for all pending ones.

```bash
# Check what's already generated vs pending
python3 scripts/generate-zimage-focus-icons.py --list-done
python3 scripts/generate-zimage-focus-icons.py --list-pending

# Generate a batch of 5 icons
python3 scripts/generate-zimage-focus-icons.py --batch-size 5

# Continue from a specific position
python3 scripts/generate-zimage-focus-icons.py --batch-start 10 --batch-size 5

# Regenerate specific icons with new descriptions
python3 scripts/generate-zimage-focus-icons.py --force --ids "FOCUS_ID_1,FOCUS_ID_2"

# Rebuild .gfx from all existing DDS files
python3 scripts/generate-zimage-focus-icons.py --build-gfx
```

Each icon takes ~4 minutes to generate. Run in batches of 5-10 to avoid timeouts.
