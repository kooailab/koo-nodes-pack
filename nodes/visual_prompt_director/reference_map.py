"""Deterministic, target-independent reference attribute resolution."""

from dataclasses import dataclass
import re


REFERENCE_ATTRIBUTES = (
    ("subject", "Subject"),
    ("face", "Face / Identity"),
    ("outfit", "Outfit"),
    ("pose", "Pose"),
    ("composition", "Composition"),
    ("camera", "Camera"),
    ("scene", "Scene / Environment"),
    ("lighting", "Lighting"),
    ("colors", "Colors"),
    ("mood", "Mood / Style"),
    ("materials", "Materials"),
)
REFERENCE_SOURCE_NAMES = ("Auto", "Image 1", "Image 2", "Blend")
REFERENCE_MAP_FIELDS = tuple(f"reference_{key}_source" for key, _label in REFERENCE_ATTRIBUTES)

_ATTRIBUTE_LABELS = dict(REFERENCE_ATTRIBUTES)
_PRESERVE_ATTRIBUTES = {
    # Outfit is intentionally independent: preserving a subject must not pull
    # clothing back from the subject source when Outfit has its own assignment.
    "subject": ("subject", "face"),
    "composition": ("composition",),
    "camera": ("camera",),
    "materials": ("materials",),
    "lighting": ("lighting",),
    "colors": ("colors",),
}
_LEGACY_ROLE_ATTRIBUTES = {
    "Subject": ("subject", "face", "outfit", "pose"),
    "Scene": ("scene", "composition", "camera"),
    "Style": ("mood", "colors", "materials"),
    "Pose": ("pose",),
    "Composition": ("composition", "camera"),
    "Lighting": ("lighting", "colors", "mood"),
}
_SECONDARY_AUTO_ATTRIBUTES = {"lighting", "colors", "mood"}
_PRIMARY_DIRECTORS = {"Reverse Engineer", "Surgical Edit"}

_MANUAL_CONSTRAINTS = {
    "subject": "Use the subject from {source}. Do not use a conflicting subject from {other}.",
    "face": "Use face and identity from {source}. Do not use conflicting identity features from {other}.",
    "outfit": "Use clothing/outfit from {source}. Do not use conflicting clothing from {other}.",
    "pose": "Use pose and action from {source}. Do not use the conflicting pose or action from {other}.",
    "composition": "Use composition and framing from {source}. Do not use conflicting composition or framing from {other}.",
    "camera": "Use camera viewpoint and perspective from {source}. Do not use a conflicting camera setup from {other}.",
    "scene": "Use environment/background from {source}. Do not retain the conflicting environment from {other}.",
    "lighting": "Use lighting from {source}. Do not use the conflicting lighting treatment from {other}.",
    "colors": "Use the dominant color treatment/palette from {source}. Do not use the conflicting palette from {other}.",
    "mood": "Use mood/style from {source}. Do not use the conflicting mood/style treatment from {other}.",
    "materials": "Use materials and surface treatment from {source}. Do not use conflicting materials from {other}.",
}

_EXPLICIT_PATTERNS = {
    "subject": (
        r"\b(?:add|remove|replace|swap|change)\b.{0,48}\b(?:subject|person|character|woman|man|girl|boy|animal|object)\b",
        r"\b(?:turn|make)\b.{0,32}\b(?:her|him|them|subject|person|character)\b",
    ),
    "face": (
        r"\b(?:change|replace|swap|alter|use)\b.{0,40}\b(?:face|identity|likeness|facial features|hair)\b",
        r"\bface\s+(?:from|of)\s+(?:image|reference)\b",
    ),
    "outfit": (
        r"\b(?:change|replace|swap|dress|redress|use)\b.{0,48}\b(?:outfit|clothes|clothing|wardrobe|dress|shirt|jacket|coat|uniform)\b",
        r"\b(?:wearing|wears|dressed in)\b",
    ),
    "pose": (
        r"\b(?:change|replace|match|use|adopt)\b.{0,40}\b(?:pose|posture|gesture|action|stance)\b",
        r"\b(?:make|have)\b.{0,28}\b(?:sit|stand|walk|run|kneel|turn|look|reach|hold)\b",
    ),
    "composition": (
        r"\b(?:change|replace|match|use|reframe|crop)\b.{0,44}\b(?:composition|framing|crop|layout|placement)\b",
        r"\b(?:center|reposition|reframe|recrop)\b",
    ),
    "camera": (
        r"\b(?:change|replace|match|use|switch)\b.{0,44}\b(?:camera|angle|viewpoint|perspective|lens|shot)\b",
        r"\b(?:low-angle|high-angle|close-up|wide shot|overhead view|eye-level)\b",
    ),
    "scene": (
        r"\b(?:change|replace|swap|remove)\b.{0,52}\b(?:scene|environment|background|location|room|setting)\b",
        r"\b(?:put|place|move|set)\b.{0,60}\b(?:in|into|at|on)\s+(?!(?:this|that)\b)",
    ),
    "lighting": (
        r"\b(?:change|replace|match|use|transfer|make)\b.{0,44}\b(?:light|lighting|illumination|shadows|exposure)\b",
        r"\b(?:relight|backlight|front-light)\b",
    ),
    "colors": (
        r"\b(?:change|replace|match|use|transfer|make)\b.{0,44}\b(?:color|colour|palette|hue|grading|tones?)\b",
        r"\b(?:recolor|colourize|colorize)\b",
    ),
    "mood": (
        r"\b(?:change|replace|match|use|transfer|make)\b.{0,44}\b(?:mood|style|aesthetic|atmosphere|look)\b",
        r"\b(?:cinematic|editorial|dreamy|moody|playful|ominous)\b",
    ),
    "materials": (
        r"\b(?:change|replace|match|use|transfer|make)\b.{0,44}\b(?:material|fabric|wood|metal|stone|glass|texture|finish|surface)\b",
        r"\b(?:retexture|resurface)\b",
    ),
}


def normalize_reference_source(value):
    compact = re.sub(r"[^a-z0-9]+", "", str(value or "Auto").casefold())
    aliases = {
        "auto": "Auto",
        "1": "Image 1",
        "image1": "Image 1",
        "reference1": "Image 1",
        "2": "Image 2",
        "image2": "Image 2",
        "reference2": "Image 2",
        "blend": "Blend",
        "both": "Blend",
    }
    return aliases.get(compact, "Auto")


def _diagnostic_source(source):
    return {
        "Auto": "auto",
        "Image 1": "image_1",
        "Image 2": "image_2",
        "Blend": "blend",
        "User Prompt": "user_prompt",
    }.get(source, str(source or "unknown"))


def _log_section(title, lines):
    print(title, flush=True)
    for line in lines:
        print(line, flush=True)


def reference_map_from_mapping(values):
    values = values if isinstance(values, dict) else {}
    return {
        key: normalize_reference_source(values.get(f"reference_{key}_source"))
        for key, _label in REFERENCE_ATTRIBUTES
    }


def _explicit_user_attributes(text):
    value = str(text or "").casefold()
    return {
        attribute
        for attribute, patterns in _EXPLICIT_PATTERNS.items()
        if any(re.search(pattern, value) for pattern in patterns)
    }


def _legacy_assignments(image_1_role, image_2_role, has_image_1, has_image_2):
    assignments = {}
    for role, source, available in (
        (str(image_1_role or "Auto"), "Image 1", has_image_1),
        (str(image_2_role or "Auto"), "Image 2", has_image_2),
    ):
        if not available:
            continue
        for attribute in _LEGACY_ROLE_ATTRIBUTES.get(role, ()):
            assignments.setdefault(attribute, source)
    return assignments


def _preserved_attributes(request):
    preserved = set()
    for field, attributes in _PRESERVE_ATTRIBUTES.items():
        if bool(getattr(request, f"preserve_{field}", False)):
            preserved.update(attributes)
    return preserved


def _validate_manual_source(attribute, source, has_image_1, has_image_2):
    label = _ATTRIBUTE_LABELS[attribute]
    if source == "Image 1" and not has_image_1:
        raise ValueError(f"Reference Map assigns {label} to Image 1, but Image 1 is not connected.")
    if source == "Image 2" and not has_image_2:
        raise ValueError(f"Reference Map assigns {label} to Image 2, but Image 2 is not connected.")
    if source == "Blend" and not (has_image_1 and has_image_2):
        raise ValueError(f"Reference Map assigns {label} to Blend, but both Image 1 and Image 2 are required.")


@dataclass(frozen=True)
class ResolvedReferenceAttribute:
    key: str
    label: str
    source: str
    preserve: bool
    reason: str


@dataclass(frozen=True)
class ResolvedReferenceMap:
    attributes: tuple

    def source_for(self, attribute):
        return next(item.source for item in self.attributes if item.key == attribute)

    def reason_for(self, attribute):
        return next(item.reason for item in self.attributes if item.key == attribute)

    def hard_manual_constraints(self):
        constraints = []
        for item in self.attributes:
            if item.reason != "manual Reference Map assignment":
                continue
            if item.source == "Blend":
                constraints.append(
                    f"Blend {item.label.lower()} evidence from Image 1 and Image 2 only for this attribute; "
                    "do not blend unrelated attributes."
                )
                continue
            other = "Image 2" if item.source == "Image 1" else "Image 1"
            constraints.append(_MANUAL_CONSTRAINTS[item.key].format(source=item.source, other=other))
        return tuple(constraints)

    def director_constraints(self):
        lines = []
        for source in ("Image 1", "Image 2", "Blend", "User Prompt"):
            controlled = [item.label for item in self.attributes if item.source == source]
            if controlled:
                lines.append(f"{source} controls: " + ", ".join(controlled))
        hard = self.hard_manual_constraints()
        if hard:
            lines.append("Hard manual constraints:")
            lines.extend(f"- {constraint}" for constraint in hard)
        return "\n".join(lines)

    def to_instructions(self):
        lines = [
            "REFERENCE SOURCE MAP",
            "This attribute map was resolved before generation. Do not reinterpret it, assign a different source, or let target-model optimization change it.",
        ]
        for source in ("Image 1", "Image 2", "Blend", "User Prompt"):
            controlled = [item.label for item in self.attributes if item.source == source]
            if controlled:
                lines.append(f"{source} controls:\n- " + "\n- ".join(controlled))

        preserved = [f"{item.label} from {item.source}" for item in self.attributes if item.preserve]
        if preserved:
            lines.append(
                "PRESERVE LOCKS\n- " + "\n- ".join(preserved)
                + "\nKeep each locked attribute faithful to its resolved source except for the exact transformation explicitly requested by the user."
            )

        manual_constraints = self.hard_manual_constraints()
        if manual_constraints:
            lines.append(
                "HARD MANUAL SOURCE CONSTRAINTS\n- " + "\n- ".join(manual_constraints)
                + "\nThese are hard constraints. They override Auto resolution, primary-image bias, and Director preset defaults."
            )

        lines.append(
            "REFERENCE CONFLICT RULES\n"
            "- The explicit current transformation is authoritative only for the attributes it changes.\n"
            "- Manual Reference Map assignments are already resolved here and override automatic source selection.\n"
            "- When references conflict, use the assigned source for that attribute and do not borrow the conflicting version from another image.\n"
            "- Blend is intentional: combine compatible evidence from both images only for that named attribute; do not blend unrelated attributes or whole scenes.\n"
            "- Attributes assigned to User Prompt follow the requested transformation while unrelated reference-controlled attributes remain unchanged.\n"
            "- Do not invent readable text, brand names, labels, book titles, logos, or uncertain small details. Generalize or omit uncertain evidence instead of hallucinating."
        )
        return "\n\n".join(lines)


def resolve_reference_map(request, director_name=None):
    has_image_1 = request.image is not None
    has_image_2 = request.image_2 is not None
    manual = {
        key: normalize_reference_source(source)
        for key, source in (request.reference_map or {}).items()
        if key in _ATTRIBUTE_LABELS
    }
    manual = {key: manual.get(key, "Auto") for key, _label in REFERENCE_ATTRIBUTES}
    if has_image_1 or has_image_2:
        _log_section(
            "[KoO Reference Map INPUT]",
            [f"{label} = {_diagnostic_source(manual[key])}" for key, label in REFERENCE_ATTRIBUTES],
        )
    for attribute, source in manual.items():
        if source != "Auto":
            _validate_manual_source(attribute, source, has_image_1, has_image_2)

    explicit = _explicit_user_attributes(request.idea)
    legacy = _legacy_assignments(request.image_1_role, request.image_2_role, has_image_1, has_image_2)
    preserved = _preserved_attributes(request)
    primary = "Image 1" if has_image_1 else "Image 2" if has_image_2 else "User Prompt"

    resolved = []
    for attribute, label in REFERENCE_ATTRIBUTES:
        if attribute in explicit:
            source, reason = "User Prompt", "explicit user transformation"
        elif manual[attribute] != "Auto":
            source, reason = manual[attribute], "manual Reference Map assignment"
        elif attribute in legacy:
            source, reason = legacy[attribute], "legacy Image Role shortcut"
        elif attribute in preserved:
            source, reason = primary, "Preserve lock on primary reference"
        elif not has_image_1 and not has_image_2:
            source, reason = "User Prompt", "text-only request"
        elif has_image_1 and has_image_2 and director_name not in _PRIMARY_DIRECTORS and attribute in _SECONDARY_AUTO_ATTRIBUTES:
            source, reason = "Image 2", "automatic secondary-reference treatment source"
        else:
            source, reason = primary, "automatic primary-reference source"
        resolved.append(ResolvedReferenceAttribute(
            key=attribute,
            label=label,
            source=source,
            preserve=attribute in preserved,
            reason=reason,
        ))
    result = ResolvedReferenceMap(tuple(resolved))
    if has_image_1 or has_image_2:
        _log_section(
            "[KoO Reference Map RESOLVED]",
            [
                f"{item.label} = {_diagnostic_source(item.source)} "
                f"(preserve={'on' if item.preserve else 'off'}; {item.reason})"
                for item in result.attributes
            ],
        )
    return result
