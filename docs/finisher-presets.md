# Finisher presets and lens controls

KoO Finisher uses the approved Legacy / LiteGraph interface. The new preset row
is below DETAIL / EFFECTS and above EXPORT. Existing finishing and export controls
remain available. The minimum height increases from 1084 to 1132 graph units;
width, fonts, accent and existing row spacing stay unchanged.

Choose **+ New Preset** at the top of the dropdown, enter a name and confirm.
Cancel creates nothing. **Save** updates only the selected preset; modified looks
show `*`. **… → Save As** creates an independent preset. With no selection, the
muted placeholder reads **No Preset**; there is no selectable Custom entry.
Save without a selection also asks for a name.
The preset dropdown loads a saved look; **… → Rename** and **Delete** operate on
the selected preset. Deleting a preset leaves the current image settings intact.

To share a preset:

1. Save or select the preset.
2. Choose **… → Export**. Your browser downloads one UTF-8 `.json` file; its download
   settings determine the destination.
3. Send that file to the other user.
4. They choose **… → Import**, select the JSON file, and the imported look is saved
   and applied. A duplicate name gets a suffix such as ` (2)`.

Presets are stored beneath `folder_paths.get_user_directory()` in
`KoO/finisher/presets/`. On older hosts without that helper, the fallback is
`<ComfyUI base_path>/user/KoO/finisher/presets/`. There is no repository storage
fallback. Files use generated IDs so Unicode display names never become paths.
Updates to the custom-node code leave user presets intact.

The human-readable format is:

```json
{
  "schema_version": 2,
  "name": "Soft Editorial",
  "finisher_version": "1.0.2",
  "settings": {
    "lut": "Film / Warm",
    "lut_strength": 75,
    "exposure": 0.25,
    "contrast": 0,
    "highlights": 0,
    "midtones": 0,
    "shadows": 0,
    "whites": 0,
    "blacks": 0,
    "temperature": 0,
    "tint": 0,
    "vibrance": 0,
    "saturation": 0,
    "clarity": 0,
    "sharpen": 0,
    "soft_lens": 20,
    "vignette": 0,
    "chromatic_aberration": 10,
    "grain": 0
  }
}
```

Only these look fields are stored. Export location, filename prefix, image format,
quality, Auto Save, Bypass, preview images, A/B state and transient UI state are
excluded. Applying a preset leaves those current node settings untouched.
Missing numeric fields default to zero, LUT defaults to none and LUT strength to
100. Unknown fields are ignored. Schema versions other than 2, malformed JSON,
nonfinite/non-numeric settings, unsafe paths, and files above 64 KiB are rejected.
Out-of-range numeric values are clamped to the existing control ranges.

LUT files are never embedded. A preset carries a portable LUT name/reference
relative to the recipient's configured LUT folder. If it cannot be found, the
other settings still load and the node shows **LUT not found**. Select a replacement
using the existing LUT dropdown; share/install the `.cube` separately if needed.

**Exposure** is photographic EV on linear light: standard piecewise sRGB decode,
multiply by `2 ** exposure`, then sRGB encode. No clipping occurs between those
steps; the existing display-domain finishing pipeline still clamps to `[0, 1]`.
At +1 EV display 0.5 becomes approximately 0.685836 (previously 1.0).
At 0 EV the transfer functions are bypassed exactly. Old workflows with nonzero
Exposure change visually in this pre-release correction. Other controls retain
their existing semantics. Slider dragging uses −2 to +2 EV, step 0.05; numeric
entry and restored workflow values retain −5 to +5 EV. Values outside the drag
range display at the track endpoint without changing their stored EV value.

The verified normal ComfyUI pipeline supplies display RGB: LoadImage converts
Pillow RGB to float /255, standard VAE encode/decode normalizes this image domain
without a transfer conversion, and Finisher caches a clone without linearizing.
IMAGE carries no color-space metadata; arbitrary custom producers that emit
linear light cannot be identified automatically. This Finisher targets the
standard display/sRGB-like image domain, using the standard sRGB approximation.

**Soft Lens** (0–100) uses response `(strength / 100) ** 0.65`, blend `0.90 * response`,
and radius `1 + round(3 * response)` (2/3/4 pixels at 25/50/100).
An edge-aware neighborhood average reduces microcontrast and fine detail;
major-edge detail attenuation is limited to 9% at 100. It adds no bloom.
**Chromatic Aberration** (0–100) uses explicit opposite radial red/blue pixel
offsets, unchanged green and a protected central region. Maximum per-channel
radial displacement is `min(96, 0.025 * shorter_dimension) * (strength / 100) ** 1.5`.
Normalized frame radius uses `smoothstep(0.10, 1.0, radius)` to increase displacement
outward without the former cubic suppression. At 1368 short-side, requested maxima
are 4.275 / 12.092 / 34.200 px at 25/50/100; visible edge separation depends on
position and orientation. Preview and export use their respective dimensions.
Both effects bypass all new processing exactly at 0 and preserve dimensions.

Preset **schema 2** marks corrected Exposure and recalibrated lens semantics.
Schema 1 is rejected rather than silently reinterpreted; there are no existing
user presets to migrate. The package version remains 1.0.2. Stored values are
only EV and semantic 0–100 strengths, never internal radius, pixels or multipliers.

The same operations run through the existing reduced preview and full-resolution
save pipelines. Preview size limit, debounce, cancellation and A/B caching remain
unchanged. Preset saving/renaming/exporting does not process an image; applying a
look schedules one debounced processed preview.
