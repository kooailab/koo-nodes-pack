"""Preset metadata for the KoO Sigma Equalizer.

The values in this module are intentionally UI-agnostic.  Curves are expressed as
normalised ``(progress, remaining_sigma)`` anchors so the same shape scales to a
14.6 full schedule, a 1.6 refinement tail, or any other usable input range.
"""

WORKFLOW_MODES = (
    "AUTO",
    "FIRST SAMPLER",
    "SECOND SAMPLER",
    "IMG2IMG REFINE",
    "CUSTOM",
)

LEGACY_MODES = ("Auto", "TXT2IMG", "IMG2IMG", "Manual")
MODES = WORKFLOW_MODES + LEGACY_MODES

SIGMA_RANGE_MODES = ("FULL RANGE", "HIGH SIGMA", "LOW SIGMA")
RANGE_SOURCES = ("AUTO / INPUT", "MODEL FULL RANGE", "CUSTOM MAX SIGMA")
INTERPOLATION_TYPES = ("Smoothstep", "Linear", "Cosine", "Exponential", "Sigmoid")
INPUT_CROPPED_STATES = ("Auto", "Yes", "No")
UI_COMPLEXITIES = ("BASIC", "PRO")


def _anchors(exponent):
    """Create a compact, smooth power-curve template."""
    return tuple((x, (1.0 - x) ** exponent) for x in (0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0))


# These settings are deliberately distinct curve shapes, not merely labels.
# A smaller high-sigma exponent retains large sigmas longer.  A larger low-sigma
# exponent descends early and allocates more evaluations to the fine-detail tail.
PRESETS = {
    "Balanced Generation": {
        "family": "high",
        "workflow": "FIRST SAMPLER",
        "range_mode": "HIGH SIGMA",
        "anchors": _anchors(0.92),
        "controls": (56, 52, 48, 44, 72, 25, 30),
    },
    "Creative Expansion": {
        "family": "high",
        "workflow": "FIRST SAMPLER",
        "range_mode": "HIGH SIGMA",
        "anchors": _anchors(0.66),
        "controls": (76, 45, 42, 36, 84, 18, 24),
    },
    "Structural Lock": {
        "family": "high",
        "workflow": "FIRST SAMPLER",
        "range_mode": "HIGH SIGMA",
        "anchors": ((0.0, 1.0), (0.18, 0.90), (0.42, 0.68), (0.70, 0.36), (1.0, 0.0)),
        "controls": (70, 60, 38, 32, 78, 30, 42),
    },
    "Architectural Base": {
        "family": "high",
        "workflow": "FIRST SAMPLER",
        "range_mode": "HIGH SIGMA",
        "anchors": ((0.0, 1.0), (0.14, 0.88), (0.34, 0.70), (0.58, 0.47), (0.80, 0.24), (1.0, 0.0)),
        "controls": (62, 74, 42, 38, 74, 38, 52),
    },
    "Photoreal Base": {
        "family": "high",
        "workflow": "FIRST SAMPLER",
        "range_mode": "HIGH SIGMA",
        "anchors": _anchors(1.08),
        "controls": (54, 66, 55, 48, 72, 48, 58),
    },
    "Fast Composition": {
        "family": "high",
        "workflow": "FIRST SAMPLER",
        "range_mode": "HIGH SIGMA",
        "anchors": _anchors(1.55),
        "controls": (45, 52, 40, 35, 76, 20, 28),
    },
    "Early Handoff": {
        "family": "high",
        "workflow": "FIRST SAMPLER",
        "range_mode": "HIGH SIGMA",
        "anchors": ((0.0, 1.0), (0.20, 0.84), (0.48, 0.55), (0.76, 0.25), (1.0, 0.0)),
        "controls": (58, 56, 44, 34, 80, 28, 44),
    },
    "Detail Refiner": {
        "family": "low",
        "workflow": "SECOND SAMPLER",
        "range_mode": "LOW SIGMA",
        # At 1.6 this yields approximately 1.6, 1.15, .82, .58, .40,
        # .26, .14, .055, 0 while remaining scale-independent.
        "anchors": ((0.0, 1.0), (0.125, 0.71875), (0.25, 0.5125), (0.375, 0.3625), (0.5, 0.25), (0.625, 0.1625), (0.75, 0.0875), (0.875, 0.034375), (1.0, 0.0)),
        "controls": (30, 60, 72, 68, 86, 22, 48),
    },
    "Material Polish": {
        "family": "low",
        "workflow": "SECOND SAMPLER",
        "range_mode": "LOW SIGMA",
        "anchors": _anchors(2.15),
        "controls": (28, 78, 62, 58, 80, 34, 52),
    },
    "Microdetail": {
        "family": "low",
        "workflow": "SECOND SAMPLER",
        "range_mode": "LOW SIGMA",
        "anchors": _anchors(2.85),
        "controls": (22, 55, 86, 62, 88, 20, 46),
    },
    "Final Cleanup": {
        "family": "low",
        "workflow": "SECOND SAMPLER",
        "range_mode": "LOW SIGMA",
        "anchors": _anchors(3.35),
        "controls": (18, 46, 64, 88, 84, 30, 64),
    },
    "Turbo Tail": {
        "family": "low",
        "workflow": "SECOND SAMPLER",
        "range_mode": "LOW SIGMA",
        "anchors": _anchors(4.0),
        "controls": (18, 42, 82, 78, 92, 12, 30),
    },
    "Skin Detail": {
        "family": "low",
        "workflow": "SECOND SAMPLER",
        "range_mode": "LOW SIGMA",
        "anchors": _anchors(2.40),
        "controls": (16, 50, 78, 70, 76, 58, 68),
    },
    "Identity Refine": {
        "family": "low",
        "workflow": "IMG2IMG REFINE",
        "range_mode": "LOW SIGMA",
        "anchors": _anchors(1.75),
        "controls": (10, 48, 56, 70, 58, 74, 72),
    },
    "Conservative Refine": {
        "family": "low",
        "workflow": "IMG2IMG REFINE",
        "range_mode": "LOW SIGMA",
        "anchors": _anchors(1.55),
        "controls": (14, 52, 58, 74, 52, 82, 76),
    },
}


LEGACY_PRESET_ALIASES = {
    "Balanced TXT2IMG": "Balanced Generation",
    "Photoreal TXT2IMG": "Photoreal Base",
    "Creative TXT2IMG": "Creative Expansion",
    "Balanced IMG2IMG": "Detail Refiner",
    "Conservative Enhance": "Conservative Refine",
    "Skin Detail Enhance": "Skin Detail",
    "Architectural Materials": "Architectural Base",
    "Identity Preservation": "Identity Refine",
    "Reference / Bypass": "Reference / Bypass",
}

PROFILES = tuple(PRESETS) + tuple(LEGACY_PRESET_ALIASES) + ("Custom",)


def resolve_preset(name):
    """Return a preset and its canonical name while accepting legacy names."""
    canonical = LEGACY_PRESET_ALIASES.get(name, name)
    if canonical == "Reference / Bypass":
        return None, canonical
    return PRESETS.get(canonical), canonical


def preset_defaults(name):
    preset, canonical = resolve_preset(name)
    if not preset:
        return {}, canonical
    structure, materials, microdetail, cleanup, strength, reference, smoothness = preset["controls"]
    return {
        "mode": preset["workflow"],
        "sigma_range_mode": preset["range_mode"],
        "structure_creativity": structure,
        "shapes_materials": materials,
        "microdetail": microdetail,
        "final_cleanup": cleanup,
        "curve_strength": strength,
        "reference_blend": reference,
        "smoothness": smoothness,
    }, canonical
