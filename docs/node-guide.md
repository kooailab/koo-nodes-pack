# KoO Nodes

KoO Nodes v1.0.3 is a unified ComfyUI custom-node package assembled from the current KoO development package.

Registry and ComfyUI Manager availability depend on moderation approval.

## Included Nodes
- `IdeogramLayoutComposer` - KoO.IdeogramBoxy (Legacy)
- `KoO4DToKreaStillLatent` - KoO 4D → Krea Still Latent
- `KoOCarouselPromptExecutor` - KoO Carousel Executor
- `KoOCarouselUnlimited` - KoO Carousel Unlimited
- `KoOCarouselPromptManager` - KoO Carousel Prompt Manager
- `KoODiffusionEQ` - KoO Diffusion EQ [Experimental]
- `KoOFinisher` - KoO Finisher
- `KoOMultipleAdapter` - KoO Multiple Adapter
- `KoOFrequencyNoiseMixer` - KoO Frequency Noise Mixer
- `KoOIdeogramBoxy` - KoO.IdeogramBoxy
- `KoOKreaStillLatentTo4D` - KoO Krea Still Latent → 4D
- `KoOLatentNoiseInjector` - KoO Latent Noise Injector
- `KoONoiseMaskBuilder` - KoO Noise Mask Builder
- `KoONoisePreview` - KoO Noise Preview
- `KoONoiseStatistics` - KoO Noise Statistics
- `KoOOnOffManager` - KoO On/Off Manager
- `KoOResolution` - KoO.Resolution
- `KoOResolutionNext` - KoO.Resolution Next
- `KoOSigmaEqualizer` - KoO Sigma Equalizer
- `KoOTileMerger` - KoO Tile Merger
- `KoOTileSplitter` - KoO Tile Splitter
- `KoOWorkflowPresetManager` - KoO Workflow Preset Manager
- `KoO_CropDataUnpack` - KoO Crop Data Unpack
- `KoO_LoadImageCropNext` - DISPLAY_NAME
- `KooLoadImageCrop` - KoO.Load Image & Crop

## Installation

### Manual Installation
Copy or clone this folder as `ComfyUI/custom_nodes/koo-nodes-pack`, then restart ComfyUI.

For final validation, install this unified package in a clean test ComfyUI environment where the original individual KoO development packages are not also active.

### ComfyUI Manager
Manager/Registry installation is planned for a later phase after clean-install validation and metadata finalization.

## Workflow Compatibility
The package preserves existing `NODE_CLASS_MAPPINGS` identifiers used by `KoONodesFullPack.json`. Widget names, sockets, frontend behavior, and node identifiers were preserved from the source packages except for release-only import/path adjustments required by consolidation.

## Dependencies
No extra pip packages are currently required beyond a normal ComfyUI runtime. See `requirements.txt`.

## KoO Finisher

KoO Finisher is an interactive grading and export node. Queue the workflow once
to cache its `image` input, then use the embedded UI for preview, `.cube` LUTs,
finishing controls, output-folder selection, and direct PNG/JPG/WEBP export.

The workflow-facing node identifier remains `KoOFinisher`, the display name
remains `KoO Finisher`, and its serialized `koo_finisher_state` property is
unchanged. Existing workflows therefore continue to load without conversion.
The backend API remains under `/koo/finisher/*`; new settings are stored in `ComfyUI/user/KoO/finisher/settings.json`; legacy package-relative settings remain readable.

## Versioning
Future versioning model:
- PATCH: bugfixes that preserve workflows.
- MINOR: backward-compatible features or new nodes.
- MAJOR: breaking workflow/API changes.

## Compatibility Notes
This package is designed for clean isolated installation and is verified as part of the release build. Do not validate by loading this unified package alongside the original individual KoO packages, because that can create duplicate registrations.

## License
KoO Open Customisation License v1.0. Copyright (c) 2026 KoO.Ai. See LICENSE and THIRD_PARTY_NOTICES.md.

## Credits
Built from the existing KoO node family development packages. Source traceability is recorded in `KOO_NODE_MANIFEST.md`.

## KoO Multiple Adapter

Round width/height using PLUS (up) or MINUS (down), a freely edited positive
multiple (default 16), and offset +0/+1 (default +0). Both selections persist
in workflows. LATENT is optional; incompatible target/grid combinations fail
clearly. Matching latents pass unchanged; resizing uses native bilinear/no-crop
latent interpolation and preserves compatible metadata and spatial masks.
