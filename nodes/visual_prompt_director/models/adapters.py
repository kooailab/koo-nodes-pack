"""Independent target-model adapters, kept conservative for v0.1."""

TARGET_MODEL_NAMES = (
    "Generic",
    "Krea 2",
    "FLUX.2 Klein",
    "Z-Image",
    "Qwen Image",
    "MiniMax",
    "LTX 2.5",
)

_MODEL_ADAPTERS = {
    "Generic": """Generic target: write clean, coherent natural-language visual description without model-specific syntax or tag chains.""",
    "Krea 2": """Krea 2 target: favor coherent natural-language visual direction. Make subject, composition, material detail, realistic lighting, and photographic character clear; add mood or color grading only when useful. Avoid tag-like keyword piles.""",
    "FLUX.2 Klein": """FLUX.2 Klein target: use concise, precise natural-language instructions. For editing or enhancement, distinguish requested changes from protected content explicitly. Avoid bloated keyword chains.""",
    "Z-Image": """Z-Image target: use conservative, direct natural-language description with clear visual relationships. Avoid speculative special syntax so this adapter remains easy to tune after testing.""",
    "Qwen Image": """Qwen Image target: use clear structured natural language. State relationships among subjects, environment, composition, and requested modifications explicitly, especially for image editing.""",
    "MiniMax": """MiniMax target: use direct cinematic natural language. In Video mode, prioritize visible action, temporal order, camera motion, environmental motion, spatial continuity, and a clear end state.""",
    "LTX 2.5": """LTX 2.5 target: describe a clear shot in natural language. In Video mode, make chronological motion, camera behavior, subject movement, beginning-to-end progression, continuity, and final framing explicit.""",
}


def get_model_adapter(name):
    """Return the selected adapter, falling back to Generic."""
    return _MODEL_ADAPTERS.get(name, _MODEL_ADAPTERS["Generic"])
