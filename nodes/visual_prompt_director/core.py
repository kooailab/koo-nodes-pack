"""Prompt assembly and backend orchestration, independent of ComfyUI UI code."""

import base64
from dataclasses import dataclass, replace
import hashlib

from .backends.factory import create_backend
from .backends.ollama import DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL
from .config import load_config
from .director_profiles import canonical_prompt_model, infer_prompt_model_family, resolve_director_config
from .diagnostics import debug_prompts_enabled, log_evidence_result, resolved_scene_sha256
from .evidence import (
    EVIDENCE_ANALYSIS_SYSTEM_PROMPT,
    build_resolved_scene,
    cache_evidence,
    evidence_analysis_user_message,
    evidence_cache_key,
    get_cached_evidence,
    parse_image_evidence,
)
from .image_utils import EncodedImage, encode_comfy_image
from .models import get_model_adapter
from .modes import get_mode_adapter, get_vision_mode_adapter
from .presets import DEFAULT_DIRECTOR_PRESET, get_director_preset, legacy_preset_for_mode
from .reference_map import reference_map_from_mapping, resolve_reference_map
from .system_prompt import (
    CORE_SYSTEM_PROMPT,
    OUTPUT_CONTRACT,
    PRIORITY_CONTRACT,
    TEXT_ONLY_PRIORITY_CONTRACT,
)

CREATIVITY_NAMES = ("Strict", "Balanced", "Creative", "Dice")
PROMPT_LENGTH_NAMES = ("Short", "Medium", "Detailed", "Maximum Detail", "Maximum")
REFERENCE_ROLE_NAMES = ("Auto", "Subject", "Scene", "Style", "Pose", "Composition", "Lighting")
RUNTIME_NAMES = ("LLAMA.CPP", "OLLAMA")

_CREATIVITY_ADAPTERS = {
    "Strict": "Creativity — Strict: preserve the user's concept closely. Add only information required for clarity and coherence; do not invent important content or change the camera.",
    "Balanced": "Creativity — Balanced: fill reasonable missing visual information while preserving the concept and avoiding conspicuous invention.",
    "Creative": "Creativity — Creative: add tasteful, coherent visual direction where unspecified, but respect every active preservation constraint.",
    "Dice": "Creativity — Dice (v0.1 soft level): invent one coherent visual concept from minimal input. Make decisive but internally consistent choices while respecting explicit preservation constraints. This adapter is structured for future Soft, Wild, and Total Chaos levels.",
}

_MAXIMUM_DETAIL_GUIDANCE = (
    "Prompt length — Maximum Detail: produce a substantially longer, densely descriptive natural-language prompt. "
    "Exhaustively cover every relevant, supported visual decision: subject identity, count, age presentation when "
    "visually relevant, overall appearance, facial structure, eyes, expression, gaze, hair, skin, anatomy, body shape, "
    "pose, limbs, hands, gesture, and action; garment construction, seams, folds, fit, styling, accessories, fabrics, "
    "textures, finishes, roughness, reflectivity, translucency, and other material response; foreground, midground, "
    "background, meaningful objects, spatial relationships, scale, overlap, and occlusion; composition, framing, "
    "camera height, angle, perspective, lens behavior, depth, focus plane, and focus hierarchy; key, fill, rim, and "
    "practical light where supported, including direction, softness, contrast, shadows, highlights, reflections, and "
    "exposure; palette, color relationships, grading, atmosphere, mood, and the relevant photographic, commercial, "
    "editorial, cinematic, rendered, or artistic character. Clearly distinguish observable or user-specified facts "
    "from coherent creative additions, and keep every addition compatible with the central concept and active "
    "Reference Map and Preserve constraints. Do not repeat details, stack synonyms, use generic quality slogans, "
    "invent unsupported evidence, or pad with filler. Omit irrelevant or unavailable categories instead of "
    "hallucinating them; never force 35mm, film grain, or ControlNet terminology when it was not requested or observed."
)

_LENGTH_ADAPTERS = {
    "Short": "Prompt length — Short: one compact prompt focused on the most consequential visual information.",
    "Medium": "Prompt length — Medium: a balanced prompt with enough detail to direct subject, composition, lighting, and materials without bloat.",
    "Detailed": "Prompt length — Detailed: a rich but disciplined prompt covering relevant visual, spatial, material, camera, lighting, and temporal details.",
    "Maximum Detail": _MAXIMUM_DETAIL_GUIDANCE,
    # Saved workflows from the pre-release Maximum label remain executable.
    "Maximum": _MAXIMUM_DETAIL_GUIDANCE,
}

_PRESERVATION_ADAPTERS = {
    "subject": "Preserve subject: do not change subject identity, type, count, key attributes, clothing, or defining features unless explicitly requested.",
    "composition": "Preserve composition: do not rearrange the scene, layout, spatial relationships, crop, or framing unless explicitly requested.",
    "camera": "Preserve camera: do not invent a different viewpoint, camera height, angle, framing, focal length, or camera movement unless explicitly requested.",
    "materials": "Preserve materials: do not replace specified materials, finishes, texture character, roughness, or surface response.",
    "lighting": "Preserve lighting: do not replace the stated light sources, direction, time-of-day character, contrast, or exposure intent.",
    "colors": "Preserve colors: do not replace the stated palette, object colors, material colors, or color-grading intent.",
}


def _image_descriptor(image):
    if image is None:
        return "NONE"
    if not isinstance(image, EncodedImage):
        return f"unencoded {type(image).__name__}"
    try:
        payload = base64.b64decode(image.data, validate=False)
    except (ValueError, TypeError):
        payload = str(image.data).encode("utf-8", errors="replace")
    digest = hashlib.sha256(payload).hexdigest()
    return f"{image.media_type} {image.width}x{image.height} sha256={digest}"


def _log_image_order(request):
    if request.image is None and request.image_2 is None:
        return
    print("[KoO IMAGE ORDER]", flush=True)
    print(f"Image 1 = {_image_descriptor(request.image)}", flush=True)
    print(f"Image 2 = {_image_descriptor(request.image_2)}", flush=True)


def _preservation_section(request, resolved_reference_map, has_image):
    if has_image:
        locked = [item for item in resolved_reference_map.attributes if item.preserve]
        if not locked:
            return "PRESERVATION CONSTRAINTS\nNo attribute-level Preserve locks are enabled."
        return (
            "PRESERVATION CONSTRAINTS\n- "
            + "\n- ".join(
                f"Preserve {item.label} from {item.source} strictly. "
                "This lock controls strictness only and does not change any other attribute's resolved source."
                for item in locked
            )
        )

    enabled = [
        text
        for field, text in _PRESERVATION_ADAPTERS.items()
        if getattr(request, f"preserve_{field}")
    ]
    return (
        "PRESERVATION CONSTRAINTS\n- " + "\n- ".join(enabled)
        if enabled
        else "PRESERVATION CONSTRAINTS\nNone beyond the selected mode and the user's explicit wording."
    )

def _as_bool(value):
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _reference_role(value):
    candidate = str(value or "Auto").strip().casefold()
    return next((role for role in REFERENCE_ROLE_NAMES if role.casefold() == candidate), "Auto")


@dataclass(frozen=True)
class PromptDirectorRequest:
    idea: str
    mode: str = "Enhance"
    target_model: str = "Generic"
    creativity: str = "Balanced"
    prompt_model: str = "Qwen 3.5 9B"
    director_preset: str = DEFAULT_DIRECTOR_PRESET
    director_ai: str = ""
    director_profile: str = ""
    director_model_path: str = ""
    director_mmproj_path: str = ""
    director_llama_server: str = ""
    director_context_size: int = 8192
    director_image_min_tokens: int = 1024
    director_max_tokens: int = 768
    director_gpu_layers: str = "auto"
    director_keep_model_loaded: bool = False
    preserve_subject: bool = True
    preserve_composition: bool = False
    preserve_camera: bool = False
    preserve_materials: bool = False
    preserve_lighting: bool = False
    preserve_colors: bool = False
    prompt_length: str = "Medium"
    custom_instructions: str = ""
    system_prompt_override: str = ""
    reference_map: object = None
    image: object = None
    image_2: object = None
    image_1_role: str = "Auto"
    image_2_role: str = "Auto"
    runtime: str = "LLAMA.CPP"
    ollama_model: str = DEFAULT_OLLAMA_MODEL
    ollama_endpoint: str = DEFAULT_OLLAMA_ENDPOINT

    @property
    def selected_prompt_model(self):
        return canonical_prompt_model(self.director_ai or self.prompt_model)

    @classmethod
    def from_mapping(cls, values):
        values = values or {}
        legacy_payload = "prompt_model" not in values and "director_ai" in values
        preset_value = values.get("director_preset") or (
            legacy_preset_for_mode(values.get("mode")) if legacy_payload else DEFAULT_DIRECTOR_PRESET
        )
        return cls(
            idea=str(values.get("idea") or ""),
            mode=str(values.get("mode") or "Enhance"),
            target_model=str(values.get("target_model") or "Generic"),
            creativity=str(values.get("creativity") or "Balanced"),
            prompt_model=str(values.get("prompt_model") or values.get("director_ai") or "Qwen 3.5 9B"),
            director_preset=str(preset_value),
            director_profile=str(values.get("director_profile") or ""),
            director_model_path=str(values.get("director_model_path") or ""),
            director_mmproj_path=str(values.get("director_mmproj_path") or ""),
            director_llama_server=str(values.get("director_llama_server") or ""),
            director_context_size=int(values.get("director_context_size", 8192)),
            director_image_min_tokens=int(values.get("director_image_min_tokens", 1024)),
            director_max_tokens=int(values.get("director_max_tokens", 768)),
            director_gpu_layers=str(values.get("director_gpu_layers") or "auto"),
            director_keep_model_loaded=_as_bool(values.get("director_keep_model_loaded", False)),
            preserve_subject=_as_bool(values.get("preserve_subject", True)),
            preserve_composition=_as_bool(values.get("preserve_composition", False)),
            preserve_camera=_as_bool(values.get("preserve_camera", False)),
            preserve_materials=_as_bool(values.get("preserve_materials", False)),
            preserve_lighting=_as_bool(values.get("preserve_lighting", False)),
            preserve_colors=_as_bool(values.get("preserve_colors", False)),
            prompt_length=str(values.get("prompt_length") or "Medium"),
            custom_instructions=str(values.get("custom_instructions") or ""),
            system_prompt_override=str(values.get("system_prompt_override") or ""),
            runtime=str(values.get("runtime") or "LLAMA.CPP"),
            ollama_model=str(values.get("ollama_model") or DEFAULT_OLLAMA_MODEL),
            ollama_endpoint=str(values.get("ollama_endpoint") or DEFAULT_OLLAMA_ENDPOINT),
            reference_map=reference_map_from_mapping(values),
            image_1_role=_reference_role(values.get("image_1_role")),
            image_2_role=_reference_role(values.get("image_2_role")),
        )


@dataclass(frozen=True)
class PromptInstruction:
    system_message: str
    user_message: str
    image: EncodedImage = None
    image_2: EncodedImage = None
    image_1_role: str = "Auto"
    image_2_role: str = "Auto"
    reference_map: object = None
    resolved_scene: object = None
    model_family: str = "qwen"
    director_preset: str = DEFAULT_DIRECTOR_PRESET
    image_label: str = "Image 1"
    diagnostic_stage: str = "final"
    diagnostic_context: object = None

    def _user_content(self, text):
        if self.image is None and self.image_2 is None:
            return text
        content = [{"type": "text", "text": text}]
        if self.image is not None:
            content[0]["text"] += (
                f"\n\n{self.image_label.upper()} — REFERENCE\n"
                f"The next image content part is {self.image_label}."
            )
            content.append({"type": "image_url", "image_url": {"url": self.image.data_url}})
        if self.image_2 is not None:
            content.append({
                "type": "text",
                "text": "IMAGE 2 — REFERENCE\nThe next image content part is Image 2.",
            })
            content.append({"type": "image_url", "image_url": {"url": self.image_2.data_url}})
        return content

    def to_messages(self):
        if self.model_family == "gemma":
            folded = (
                "SYSTEM-STYLE INSTRUCTIONS:\n"
                f"{self.system_message}\n\n"
                "USER REQUEST:\n"
                f"{self.user_message}"
            )
            return [{"role": "user", "content": self._user_content(folded)}]
        return [
            {"role": "system", "content": self.system_message},
            {"role": "user", "content": self._user_content(self.user_message)},
        ]


@dataclass(frozen=True)
class GenerationResult:
    prompt: str
    backend_name: str
    instruction: PromptInstruction
    director_profile: str = ""
    prompt_model: str = ""
    director_preset: str = ""
    warning: str = ""


def assemble_instruction(
    request,
    model_family=None,
    resolved_scene=None,
    resolved_reference_map=None,
    text_only=False,
):
    idea = request.idea.strip()
    has_raw_image = request.image is not None or request.image_2 is not None
    has_visual_context = has_raw_image or resolved_scene is not None
    if not idea and not has_visual_context:
        raise ValueError("Idea / Prompt cannot be empty.")

    preset = get_director_preset(request.director_preset)
    resolved_reference_map = None if text_only else (
        resolved_reference_map
        or (resolved_scene.reference_map if resolved_scene is not None else None)
        or resolve_reference_map(request, preset.label)
    )
    if has_raw_image and resolved_scene is None:
        _log_image_order(request)
    active_director_instructions = request.system_prompt_override.strip() or preset.instructions
    sections = [
        CORE_SYSTEM_PROMPT,
        TEXT_ONLY_PRIORITY_CONTRACT if text_only else PRIORITY_CONTRACT,
    ]
    if has_visual_context:
        sections.append(f"VISUAL GROUNDING\n{get_vision_mode_adapter(request.mode)}")
    sections.extend([
        f"MODE ADAPTER\n{get_mode_adapter(request.mode)}",
        f"TARGET MODEL ADAPTER\n{get_model_adapter(request.target_model)}",
        "USER SETTINGS",
        _CREATIVITY_ADAPTERS.get(request.creativity, _CREATIVITY_ADAPTERS["Balanced"]),
        _LENGTH_ADAPTERS.get(request.prompt_length, _LENGTH_ADAPTERS["Medium"]),
    ])

    sections.append(_preservation_section(request, resolved_reference_map, has_visual_context))

    sections.append(f"DIRECTOR BEHAVIOR — {preset.label}\n{active_director_instructions}")
    if request.custom_instructions.strip():
        sections.append(f"WORKFLOW RULES\n{request.custom_instructions.strip()}")

    if resolved_scene is not None:
        compiler_input = resolved_scene.compiler_input(request.target_model)
        sections.append(compiler_input)
        if debug_prompts_enabled():
            print("[KoO FINAL COMPILER INPUT]", flush=True)
            print(compiler_input, flush=True)
    elif has_raw_image:
        reference_constraints = resolved_reference_map.to_instructions()
        sections.append(reference_constraints)
        print("[KoO DIRECTOR CONSTRAINTS]", flush=True)
        print(resolved_reference_map.director_constraints(), flush=True)

    sections.append(OUTPUT_CONTRACT)

    if has_visual_context:
        user_message = (
            "USER REQUESTED CHANGES / DIRECTION:\n" + idea
            if idea
            else "USER REQUESTED CHANGES / DIRECTION:\nNo additional change requested; follow the selected mode using only observed image content."
        )
    else:
        user_message = idea
    return PromptInstruction(
        system_message="\n\n".join(sections),
        user_message=user_message,
        image=None if resolved_scene is not None else request.image,
        image_2=None if resolved_scene is not None else request.image_2,
        image_1_role=_reference_role(request.image_1_role),
        image_2_role=_reference_role(request.image_2_role),
        reference_map=resolved_reference_map,
        resolved_scene=resolved_scene,
        model_family=model_family or infer_prompt_model_family(request.selected_prompt_model),
        director_preset=preset.label,
    )


def _effective_model_family(request, profile, effective_config):
    if profile is not None:
        return profile.model_family
    ollama_settings = effective_config.get("ollama", {}) if isinstance(effective_config, dict) else {}
    ollama_identity = str(ollama_settings.get("model") or "").casefold()
    if "gemma" in ollama_identity:
        return "gemma"
    if "qwen" in ollama_identity:
        return "qwen"
    local_settings = effective_config.get("local_llama_cpp", {}) if isinstance(effective_config, dict) else {}
    identity = " ".join(
        str(local_settings.get(field) or "").casefold()
        for field in ("model_path", "mmproj_path")
    )
    if "gemma" in identity:
        return "gemma"
    if "qwen" in identity:
        return "qwen"
    return infer_prompt_model_family(request.selected_prompt_model)


def _analysis_model_identity(request, profile, effective_config):
    config = effective_config if isinstance(effective_config, dict) else {}
    backend_name = str(config.get("backend") or "unknown")
    selected = str(getattr(profile, "prompt_model", "") or request.selected_prompt_model)
    local = config.get("local_llama_cpp", {}) if isinstance(config.get("local_llama_cpp", {}), dict) else {}
    remote = config.get("openai_compatible", {}) if isinstance(config.get("openai_compatible", {}), dict) else {}
    ollama = config.get("ollama", {}) if isinstance(config.get("ollama", {}), dict) else {}
    critical = (
        local.get("model_path"), local.get("mmproj_path"), local.get("alias"),
        remote.get("model"), remote.get("base_url"),
        ollama.get("model"), ollama.get("base_url"),
    )
    return "|".join([backend_name, selected, *(str(value or "") for value in critical)])


def _diagnostic_context(request, evidence_digest="NONE"):
    return {
        "runtime": str(request.runtime or "LLAMA.CPP"),
        "model": request.selected_prompt_model,
        "preset": request.director_preset,
        "length": request.prompt_length,
        "target": request.target_model,
        "creativity": request.creativity,
        "director_override": bool(request.system_prompt_override.strip()),
        "workflow_rules": bool(request.custom_instructions.strip()),
        "image_references": int(request.image is not None) + int(request.image_2 is not None),
        "evidence_sha256": evidence_digest,
    }


def _analyze_image_evidence(backend, image, source_label, model_family, analysis_model, request):
    key = evidence_cache_key(image, analysis_model)
    evidence = get_cached_evidence(key)
    cache_state = "HIT"
    if evidence is None:
        cache_state = "MISS"
        instruction = PromptInstruction(
            system_message=EVIDENCE_ANALYSIS_SYSTEM_PROMPT,
            user_message=evidence_analysis_user_message(source_label),
            image=image,
            model_family=model_family,
            image_label=source_label,
            diagnostic_stage=f"evidence:{source_label.casefold().replace(' ', '_')}",
            diagnostic_context=_diagnostic_context(request),
        )
        backend.validate_instruction(instruction)
        raw_evidence = backend.generate(instruction)
        evidence = parse_image_evidence(raw_evidence, key[0])
        cache_evidence(key, evidence)
    log_evidence_result(source_label, evidence, cache_state)
    print(f"[KoO {source_label.upper()} EVIDENCE]", flush=True)
    print(f"Cache = {cache_state}; sha256={evidence.fingerprint}", flush=True)
    if debug_prompts_enabled():
        print(evidence.diagnostic_text(), flush=True)
    return evidence


class PromptDirectorService:
    """Stateless facade that assembles instructions and resolves a backend per call."""

    def __init__(self, config=None, config_path=None):
        self._config = config
        self._config_path = config_path

    def assemble(
        self,
        request,
        model_family=None,
        resolved_scene=None,
        resolved_reference_map=None,
        text_only=False,
    ):
        return assemble_instruction(
            request,
            model_family=model_family,
            resolved_scene=resolved_scene,
            resolved_reference_map=resolved_reference_map,
            text_only=text_only,
        )

    def generate(self, request):
        return self._generate(request, text_only=False)

    def generate_text_only(self, request):
        """Generate from text settings without touching image/reference state."""
        if not str(request.idea or "").strip():
            raise ValueError("Enter a text prompt first.")
        sanitized = replace(
            request,
            image=None,
            image_2=None,
            reference_map=None,
            image_1_role="Auto",
            image_2_role="Auto",
            preserve_subject=False,
            preserve_composition=False,
            preserve_camera=False,
            preserve_materials=False,
            preserve_lighting=False,
            preserve_colors=False,
        )
        return self._generate(sanitized, text_only=True)

    def _generate(self, request, text_only=False):
        config = self._config if self._config is not None else load_config(self._config_path)
        effective_config, profile = resolve_director_config(config, request)
        backend = create_backend(effective_config)
        backend.validate_vision_input(request.image)
        backend.validate_vision_input(request.image_2)
        vision_config = effective_config.get("vision", {}) if isinstance(effective_config, dict) else {}
        if not isinstance(vision_config, dict):
            vision_config = {}
        max_dimension = vision_config.get("max_image_dimension", 1344)
        if request.image is not None and not isinstance(request.image, EncodedImage):
            encoded = encode_comfy_image(request.image, max_dimension=max_dimension)
            request = replace(request, image=encoded)
        if request.image_2 is not None and not isinstance(request.image_2, EncodedImage):
            encoded_2 = encode_comfy_image(request.image_2, max_dimension=max_dimension)
            request = replace(request, image_2=encoded_2)
        model_family = _effective_model_family(request, profile, effective_config)

        # One lifecycle session covers the complete operation. This keeps a
        # manual unload request deferred across evidence analysis, compilation,
        # and any current or future final enhancement pass.
        with backend.generation_session() as session_backend:
            if request.image is None and request.image_2 is None:
                instruction = self.assemble(
                    request,
                    model_family=model_family,
                    text_only=text_only,
                )
                instruction = replace(
                    instruction,
                    diagnostic_stage="final",
                    diagnostic_context=_diagnostic_context(request),
                )
                session_backend.validate_instruction(instruction)
                prompt = str(session_backend.generate(instruction) or "").strip()
            else:
                preset = get_director_preset(request.director_preset)
                resolved_reference_map = resolve_reference_map(request, preset.label)
                _log_image_order(request)
                analysis_model = _analysis_model_identity(request, profile, effective_config)
                image_1_evidence = (
                    _analyze_image_evidence(
                        session_backend, request.image, "Image 1", model_family, analysis_model, request,
                    )
                    if request.image is not None else None
                )
                image_2_evidence = (
                    _analyze_image_evidence(
                        session_backend, request.image_2, "Image 2", model_family, analysis_model, request,
                    )
                    if request.image_2 is not None else None
                )
                resolved_scene = build_resolved_scene(
                    resolved_reference_map,
                    image_1_evidence,
                    image_2_evidence,
                    request.idea,
                )
                if debug_prompts_enabled():
                    print("[KoO RESOLVED SCENE]", flush=True)
                    print(resolved_scene.diagnostic_text(), flush=True)
                instruction = self.assemble(
                    request,
                    model_family=model_family,
                    resolved_scene=resolved_scene,
                    resolved_reference_map=resolved_reference_map,
                )
                instruction = replace(
                    instruction,
                    diagnostic_stage="final",
                    diagnostic_context=_diagnostic_context(
                        request,
                        evidence_digest=resolved_scene_sha256(resolved_scene),
                    ),
                )
                session_backend.validate_instruction(instruction)
                prompt = str(session_backend.generate(instruction) or "").strip()
        if not prompt:
            raise RuntimeError("Prompt Director backend returned an empty prompt.")
        return GenerationResult(
            prompt=prompt,
            backend_name=backend.name,
            instruction=instruction,
            director_profile=profile.label if profile else "",
            prompt_model=(
                effective_config.get("ollama", {}).get("model")
                if backend.name == "ollama"
                else profile.prompt_model if profile else request.selected_prompt_model
            ),
            director_preset=instruction.director_preset,
            warning=str(getattr(backend, "last_warning", "") or ""),
        )
