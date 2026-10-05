# KoO Nodes Pack

Resolution, cropping, sampling, noise, latent conversion, image finishing and workflow utilities for ComfyUI. All existing nodes remain in this package. KoO Apes Prompter is a separate optional project and is not required.

Version **1.0.2**, GitHub source release; Registry publication pending. Licensed under the KoO Open Customisation License v1.0, Copyright (c) 2026 KoO.Ai. See [LICENSE](LICENSE). Registry publisher: **KoO.Ai** (`koo-ai`). GitHub repository: [koo-nodes-pack](https://github.com/kevintronchin-blip/koo-nodes-pack).

## Install

1. Download the source ZIP from [koo-nodes-pack](https://github.com/kevintronchin-blip/koo-nodes-pack).
2. Extract the project as `ComfyUI/custom_nodes/koo-nodes-pack`. Make sure `__init__.py` is directly inside that folder, not inside a second nested folder.
3. Use ComfyUI's Python environment to install `requirements.txt` if the listed libraries are missing, then restart ComfyUI and refresh your browser.
4. Add a node from the KoO categories.

For regular Python/venv ComfyUI, run from this node folder:

```sh
python -m pip install -r requirements.txt
```

For Windows portable, run from the portable root:

```bat
python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\koo-nodes-pack\requirements.txt
```

These are manual setup commands; the plugin never installs Python packages at runtime. After publication, this project can also be installed through ComfyUI Manager or Registry under package ID `koo-nodes-pack`. That ID has not been registered or reserved.

## Requirements

A compatible, updated ComfyUI installation with Python 3.10 or newer. `torch`, `numpy`, `Pillow` and `aiohttp` are declared dependencies and normally already supplied by ComfyUI. ComfyUI modules (`folder_paths`, `comfy`, `server`, `nodes`, `node_helpers`, `comfy_api.latest`) come from ComfyUI itself. Keep ComfyUI's compatible PyTorch build; do not install an unrelated system Python build.

LUTs, GGUF models and AI servers are optional feature resources. Missing AI backends do not prevent package import. Tkinter is imported only when the desktop folder picker is used; if it is absent, enter the folder manually. The retained developer-only `installer/` is excluded from Registry and manual runtime packages; it is never run during plugin installation or import.

## Included nodes

| Workflow node ID | Display name |
| --- | --- |
| `IdeogramLayoutComposer` | KoO.IdeogramBoxy (Legacy) |
| `KoO4DToKreaStillLatent` | KoO 4D → Krea Still Latent |
| `KoOCarouselPromptExecutor` | KoO Carousel Executor |
| `KoOCarouselPromptManager` | KoO Carousel Prompt Manager |
| `KoOCarouselUnlimited` | KoO Carousel Unlimited |
| `KoODiffusionEQ` | KoO Diffusion EQ [Experimental] |
| `KoOFinisher` | KoO Finisher |
| `KoOMultipleAdapter` | KoO Multiple Adapter |
| `KoOFrequencyNoiseMixer` | KoO Frequency Noise Mixer |
| `KoOIdeogramBoxy` | KoO.IdeogramBoxy |
| `KoOKreaStillLatentTo4D` | KoO Krea Still Latent → 4D |
| `KoOLatentNoiseInjector` | KoO Latent Noise Injector |
| `KoONoiseMaskBuilder` | KoO Noise Mask Builder |
| `KoONoisePreview` | KoO Noise Preview |
| `KoONoiseStatistics` | KoO Noise Statistics |
| `KoOOnOffManager` | KoO On/Off Manager |
| `KoOResolution` | KoO.Resolution |
| `KoOResolutionNext` | KoO.Resolution Next |
| `KoOSigmaEqualizer` | KoO Sigma Schedule Designer |
| `KoOTileMerger` | KoO Tile Merger |
| `KoOTileSplitter` | KoO Tile Splitter |
| `KoOVisualPromptDirector` | KoO Visual Prompt Director |
| `KoOWorkflowPresetManager` | KoO Workflow Preset Manager |
| `KoO_CropDataUnpack` | KoO Crop Data Unpack |
| `KoO_LoadImageCropNext` | KoO.Load Image & Crop Next |
| `KooLoadImageCrop` | KoO.Load Image & Crop |

All node IDs, display names and saved workflow behavior are retained. Legacy aliases remain included.

## Basic examples

- Connect an image loader to **KoO.Load Image & Crop**, then connect IMAGE to an image preview or your image conditioning node.
- Use **KoO.Resolution Next** for dimension planning and feed its width/height into compatible generation nodes.
- Pass IMAGE through **KoO Finisher**, preview the adjustments and save the resulting image.
- Use **KoO Krea Still Latent → 4D** when a single-frame Krea latent needs the normal 4D latent representation.
- **KoO Carousel Prompt Manager** supplies prompts to the included executor. A minimal API graph is provided in `docs/examples/`.

Existing Ideogram layout workflows and the carousel API example are retained in [docs/examples](docs/examples). Read the [node guide](docs/node-guide.md) for detailed Prompt Director configuration and node behavior. API-format JSON examples are for API submission; they are not all drag-and-drop frontend workflows.

Finisher stores new LUT folder settings in ComfyUI user data under `KoO/finisher/settings.json`. Existing `nodes/koo_finisher/config/settings.json` remains a read-only fallback until new settings are saved. Personal settings are excluded from Git and Registry packaging.

## Troubleshooting

- **Node missing:** inspect the ComfyUI startup log, install declared dependencies using ComfyUI's Python and confirm that there is no nested project folder.
- **Frontend controls missing:** refresh the browser after restart; check the browser console. This package exports `WEB_DIRECTORY = "./web"`.
- **Duplicate node IDs:** use one copy of this package. Older separately installed KoO node folders may register the same IDs; back up those folders and disable redundant copies before testing.
- **Prompt Director unavailable:** configure the selected external provider or llama-server and a compatible model. Other nodes remain usable.
- **LUTs missing:** set your own LUT folder; no developer LUT path is included in the release.
- **Desktop folder buttons unavailable remotely:** open ComfyUI locally through localhost, or enter your output folder manually. The folder dialog/open actions are local-only; cross-origin writes are rejected.

## Update

For a Git installation, pull this project's repository and restart ComfyUI. For a ZIP installation, replace its source files while preserving your ComfyUI user data and any legacy private configuration. Install changed requirements with ComfyUI's Python, then refresh the browser. Back up workflows before updates.

## Release preparation

See [CHANGELOG.md](CHANGELOG.md) and [RELEASE_TODO.md](RELEASE_TODO.md). The publishing workflow is manual-only (`workflow_dispatch`) and refuses the placeholder publisher and repository. No token is included. The two KoO projects publish from separate repositories and use separate Registry IDs.

## Frontend qualification

The current custom canvas interface requires the Legacy / LiteGraph renderer.
In ComfyUI frontend 1.51.10, Nodes 2.0 skips node-level canvas drawing and mouse
hooks used by this project. Nodes 2.0 compatibility is blocked pending a focused
frontend adaptation and real browser qualification. Backend registration and
automated frontend tests do not certify rendering, DPI layout or interaction.
The same RC is supplied for both renderers; no alternate build or V3 migration
has been made. Complete the manual checklist in the accompanying release report
before a public release.

## Attribution and customised editions

Original product by **KoO.Ai**: https://youtube.com/@kooai-o9t. Personal and commercial use, modifications, forks and redistribution are permitted under LICENSE. Modified editions must keep the original KoO product name, append their own edition name, retain attribution and the channel link, and clearly identify themselves as unofficial.
