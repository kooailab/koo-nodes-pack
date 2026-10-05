# KoO Nodes

KoO Nodes v1.0.2 is a unified ComfyUI custom-node package assembled from the current KoO development package.

This package is prepared for future GitHub, ComfyUI Registry, and ComfyUI-Manager publication, but it has not been published and no Registry availability is claimed.

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
- `KoOVisualPromptDirector` - KoO Visual Prompt Director
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

## Visual Prompt Director — Director AI iteration

`KoO Visual Prompt Director` turns a rough image or video idea into a model-aware prompt. It supports text-only direction and an optional normal ComfyUI `IMAGE` socket for grounded VLM generation. With no IMAGE, the Generate button stores a text-only result in the hidden `generated_prompt` widget and queueing emits it as a normal `STRING`. With IMAGE connected, queue execution always calls a vision-capable backend and deliberately ignores the cached text-only preview.

The default installation has no globally imported LLM dependency and still loads safely. A `config.json` remains available for backend/runtime setup, but installed local model pairs can now be selected without editing model paths in that file.

### Director AI profiles

The compact `Director AI` control is independent of Mode, Target Model, and Creativity:

- `Default` selects the discovered Qwen3.5-9B standard profile.
- `Uncensored` selects the discovered Qwen3.5-9B HauhauCS aggressive profile.
- `Custom` exposes discovered generic folders and manual overrides inside Advanced.

Prompt Director scans `ComfyUI/models/LLM` recursively. Each folder is treated as one profile: a non-`mmproj` GGUF is paired with an `mmproj` GGUF from the same folder. When several files exist, recommended quant names are preferred deterministically and the choice is reported as a warning. Incomplete folders remain visible under Custom but are marked as not vision-ready.

`Refresh` in Advanced clears the discovery cache and rescans immediately; ComfyUI does not need to restart when model files are added. Recognized Qwen profiles apply the maintained defaults `reasoning=off`, `image_min_tokens=1024`, `max_tokens=768`, `context_size=8192`, `gpu_layers=auto`, `keep_model_loaded=true`, and loopback host binding.

### Mock backend

Use this configuration to verify UI interaction, instruction assembly, routing, and STRING output without an LLM or network access:

```json
{
  "backend": "mock"
}
```

The Mock backend deliberately returns `[Mock Prompt Director]` followed by the source idea; it does not simulate prompt intelligence.
The Mock backend is text-only. Connecting IMAGE while Mock is selected returns a clear capability error rather than silently ignoring the image.

### OpenAI-compatible backend

Any server exposing an OpenAI-compatible `/chat/completions` endpoint can be configured without an extra Python dependency:

```json
{
  "backend": "openai_compatible",
  "openai_compatible": {
    "base_url": "http://127.0.0.1:1234/v1",
    "model": "your-model-name",
    "api_key_env": "KOO_PROMPT_DIRECTOR_API_KEY",
    "temperature": 0.5,
    "timeout": 90
  }
}
```

Set the key in the environment that launches ComfyUI when the endpoint requires one. For example, use `$env:KOO_PROMPT_DIRECTOR_API_KEY="..."` in PowerShell or `export KOO_PROMPT_DIRECTOR_API_KEY="..."` in a POSIX shell. Local endpoints that do not require authentication may leave the variable unset. A different config location can be selected with `KOO_PROMPT_DIRECTOR_CONFIG`.

For IMAGE requests, Prompt Director sends the user content as OpenAI-compatible `text` plus `image_url` content parts. The configured endpoint and selected model must actually support vision. The first image in a ComfyUI batch is converted to RGB PNG in memory, keeps its aspect ratio, and is reduced to a maximum edge of 1344 pixels by default. Adjust `vision.max_image_dimension` only when the VLM requires a different size.

### Local llama.cpp VLM backend

The optional `local_llama_cpp` backend launches the official `llama-server` executable directly with `shell=False`; it does not install or import a llama.cpp Python package. Current llama.cpp documents multimodal chat through `/v1/chat/completions`, using `--model` with a matching `--mmproj`. See the [official multimodal guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md) and [server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

Recommended first model folder:

```text
ComfyUI/models/LLM/Qwen3.5-9B/
  Qwen3.5-9B-Q4_K_M.gguf
  mmproj-Qwen3.5-9B-BF16.gguf
```

Obtain a matching model/projector pair from the same trusted release. Prompt Director requires both files, requires the projector filename to contain `mmproj`, and requires both to be in the same folder. It never guesses a projector from an unrelated model.

Example configuration:

```json
{
  "backend": "local_llama_cpp",
  "vision": { "max_image_dimension": 1344 },
  "local_llama_cpp": {
    "model_path": "LLM/Qwen3.5-9B/Qwen3.5-9B-Q4_K_M.gguf",
    "mmproj_path": "LLM/Qwen3.5-9B/mmproj-Qwen3.5-9B-BF16.gguf",
    "llama_server": "llama-server",
    "host": "127.0.0.1",
    "port": 8189,
    "context_size": 8192,
    "reasoning": "off",
    "image_min_tokens": 1024,
    "max_tokens": 768,
    "gpu_layers": "auto",
    "keep_model_loaded": false,
    "startup_timeout": 180,
    "timeout": 180
  }
}
```

For Default and Uncensored, discovered profile paths replace the example `model_path` and `mmproj_path` automatically. The explicit paths remain the legacy fallback and Custom/manual path. Paths are resolved relative to ComfyUI's real models directory through `folder_paths`. `models_dir` or `KOO_COMFYUI_MODELS_DIR` can be used only when running outside a normal ComfyUI environment. `llama_server` may be an absolute/relative executable path or a command available on `PATH`.

The server binds to loopback only. Prompt Director waits on llama.cpp's `/health` endpoint and sends the request only after the model is ready. With `keep_model_loaded: false` (default), the owned child is terminated after generation to release VRAM. With it enabled, the same owned server is reused. On ComfyUI/Python exit, all remaining children owned by Prompt Director are cleaned up. Existing user-started llama.cpp processes are never reused or terminated; an occupied configured port produces an error.

### Multimodal execution and UI limitation

Connected IMAGE tensors exist only during queued graph execution. The canvas Generate button therefore remains an honest text-only preview: when IMAGE is connected, its status explicitly says to queue the graph for image grounding. It does not inspect upstream graph state or fake VLM output. Queue-time execution has priority and always regenerates from IMAGE even if a text preview is cached.

Mode-specific grounding is applied for Archviz, Image Edit, Photography, Video, and Dataset Caption. The instruction separates observed image content from requested changes and protects visible content unless the mode or user explicitly requests modification.

### Manual local installation

1. Install a current official llama.cpp build containing `llama-server`.
2. Place the matching model and mmproj files together under `ComfyUI/models/LLM/Qwen3.5-9B/`.
3. Copy `config.example.json` to `config.json` and configure `llama_server` only if it is not already on `PATH`.
4. Select Default, Uncensored, or Custom in the node. Model/mmproj paths are discovered from the folder pair.
5. Restart ComfyUI so the updated node and route load.
6. Add `KoO Visual Prompt Director`, optionally connect an IMAGE, enter direction, and queue the graph.
7. Connect its `prompt` STRING output to the normal prompt-consuming node in the workflow.

## Versioning
The optional Prompt Director setup executable is versioned separately from this package release.

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
