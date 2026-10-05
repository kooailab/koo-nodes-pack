import random
import re


PROMPT_SLOTS = 6
MAX_SEED = 0xFFFFFFFFFFFFFFFF
SEED_MODES = ("Fixed", "Increment", "Random Per Prompt")
DEFAULT_PREFIX = "KoO_Carousel"
SCENE_DELIMITER = "---SCENE---"
INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_int(value, default=0):
    try:
        return int(round(float(value)))
    except Exception:
        return default


def _clamp(value, low, high):
    return max(low, min(high, _safe_int(value, low)))


def _clamp_seed(value):
    return _clamp(value, 0, MAX_SEED)


def _sanitize_filename_part(value):
    text = str(value if value is not None else DEFAULT_PREFIX)
    text = INVALID_FILENAME_CHARS.sub("_", text)
    text = text.rstrip(". ")
    return text or DEFAULT_PREFIX


def _active_prompt_values(active_prompts, prompts):
    active_count = _clamp(active_prompts, 1, PROMPT_SLOTS)
    return active_count, [str(value if value is not None else "") for value in prompts[:active_count]]


def _parse_scene_script(scene_script):
    text = str(scene_script if scene_script is not None else "")
    if SCENE_DELIMITER not in text:
        return []
    return [block.strip() for block in text.split(SCENE_DELIMITER)[1:] if block.strip()]


def _seed_sequence(base_seed, seed_mode, active_count):
    base = _clamp_seed(base_seed)
    mode = seed_mode if seed_mode in SEED_MODES else "Fixed"
    if mode == "Increment":
        return [min(MAX_SEED, base + index) for index in range(active_count)]
    if mode == "Random Per Prompt":
        generator = random.SystemRandom()
        return [generator.randint(0, MAX_SEED) for _ in range(active_count)]
    return [base for _ in range(active_count)]


class KoOCarouselPromptManager:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "active_prompts": ("INT", {"default": PROMPT_SLOTS, "min": 1, "max": PROMPT_SLOTS, "step": 1}),
        }
        for index in range(1, PROMPT_SLOTS + 1):
            required[f"prompt_{index}"] = (
                "STRING",
                {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "placeholder": f"Prompt {index}",
                },
            )
        required.update(
            {
                "base_seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": MAX_SEED,
                        "step": 1,
                        "control_after_generate": True,
                    },
                ),
                "seed_mode": (SEED_MODES, {"default": "Fixed"}),
                "filename_prefix": ("STRING", {"default": DEFAULT_PREFIX, "multiline": False}),
            }
        )
        return {"required": required}

    RETURN_TYPES = ("STRING", "INT", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("prompts", "seeds", "filenames", "indices", "active_count", "status")
    OUTPUT_IS_LIST = (True, True, True, True, False, False)
    FUNCTION = "build"
    CATEGORY = "KoO Tools / Prompt"

    @classmethod
    def IS_CHANGED(
        cls,
        active_prompts,
        prompt_1,
        prompt_2,
        prompt_3,
        prompt_4,
        prompt_5,
        prompt_6,
        base_seed,
        seed_mode,
        filename_prefix,
    ):
        if seed_mode == "Random Per Prompt":
            return random.random()
        active_count, prompts = _active_prompt_values(
            active_prompts,
            (prompt_1, prompt_2, prompt_3, prompt_4, prompt_5, prompt_6),
        )
        return (
            active_count,
            tuple(prompts),
            _clamp_seed(base_seed),
            seed_mode if seed_mode in SEED_MODES else "Fixed",
            _sanitize_filename_part(filename_prefix),
        )

    def build(
        self,
        active_prompts,
        prompt_1,
        prompt_2,
        prompt_3,
        prompt_4,
        prompt_5,
        prompt_6,
        base_seed,
        seed_mode,
        filename_prefix,
    ):
        active_count, prompts = _active_prompt_values(
            active_prompts,
            (prompt_1, prompt_2, prompt_3, prompt_4, prompt_5, prompt_6),
        )
        indices = list(range(1, active_count + 1))
        seeds = _seed_sequence(base_seed, seed_mode, active_count)
        prefix = _sanitize_filename_part(filename_prefix)
        filenames = [f"{prefix}_{index:02d}" for index in indices]

        empty_slots = [str(index) for index, prompt in zip(indices, prompts) if prompt == ""]
        if empty_slots:
            warning = f"Warning: active prompt slot(s) empty: {', '.join(empty_slots)}"
            print(f"[KoO Carousel Prompt Manager] {warning}")
        else:
            warning = "Ready"

        mode = seed_mode if seed_mode in SEED_MODES else "Fixed"
        status = f"{active_count} prompts active | seed mode {mode} | prefix {prefix}"
        if warning != "Ready":
            status = f"{status} | {warning}"

        return {
            "ui": {"text": [status]},
            "result": (prompts, seeds, filenames, indices, active_count, status),
        }


class KoOCarouselUnlimited:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "scene_script": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "dynamicPrompts": False,
                        "placeholder": (
                            "---SCENE---\n"
                            "photorealistic full-body frontal view of the character...\n\n"
                            "---SCENE---\n"
                            "photorealistic three-quarter full-body view of the same character..."
                        ),
                    },
                ),
                "base_seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": MAX_SEED,
                        "step": 1,
                        "control_after_generate": True,
                    },
                ),
                "seed_mode": (SEED_MODES, {"default": "Fixed"}),
                "filename_prefix": ("STRING", {"default": DEFAULT_PREFIX, "multiline": False}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("prompts", "seeds", "filenames", "indices", "active_count", "status")
    OUTPUT_IS_LIST = (True, True, True, True, False, False)
    FUNCTION = "build"
    CATEGORY = "KoO Tools / Prompt"

    @classmethod
    def IS_CHANGED(cls, scene_script, base_seed, seed_mode, filename_prefix):
        if seed_mode == "Random Per Prompt":
            return random.random()
        scenes = _parse_scene_script(scene_script)
        return (
            tuple(scenes),
            _clamp_seed(base_seed),
            seed_mode if seed_mode in SEED_MODES else "Fixed",
            _sanitize_filename_part(filename_prefix),
        )

    def build(self, scene_script, base_seed, seed_mode, filename_prefix):
        prompts = _parse_scene_script(scene_script)
        active_count = len(prompts)
        indices = list(range(1, active_count + 1))
        seeds = _seed_sequence(base_seed, seed_mode, active_count)
        prefix = _sanitize_filename_part(filename_prefix)
        filenames = [f"{prefix}_{index:02d}" for index in indices]

        mode = seed_mode if seed_mode in SEED_MODES else "Fixed"
        if active_count:
            status = f"{active_count} scenes detected | seed mode {mode} | prefix {prefix}"
        else:
            status = f"0 scenes detected | add {SCENE_DELIMITER} before each scene"

        return {
            "ui": {"text": [status]},
            "result": (prompts, seeds, filenames, indices, active_count, status),
        }



def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _first_int(value, default=None):
    values = _as_list(value)
    if not values:
        return default
    try:
        return int(round(float(values[0])))
    except Exception:
        return default


def _executor_filename(prefix, index):
    safe_prefix = _sanitize_filename_part(prefix or DEFAULT_PREFIX)
    return f"{safe_prefix}_{index:02d}"


class KoOCarouselPromptExecutor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompts": ("STRING", {"forceInput": True}),
                "seeds": ("INT", {"forceInput": True}),
                "filenames": ("STRING", {"forceInput": True}),
                "indices": ("INT", {"forceInput": True}),
                "active_count": ("INT", {"forceInput": True}),
                "status": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("prompt", "seed", "filename_prefix", "index", "total", "status")
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True, True, True, True, True, True)
    FUNCTION = "execute"
    CATEGORY = "KoO/Carousel"

    def execute(self, prompts, seeds, filenames, indices, active_count, status):
        prompt_list = [str(value if value is not None else "") for value in _as_list(prompts)]
        seed_list = _as_list(seeds)
        filename_list = _as_list(filenames)
        index_list = _as_list(indices)

        requested_count = _first_int(active_count, len(prompt_list))
        if requested_count is None:
            requested_count = len(prompt_list)
        if requested_count < 0:
            raise ValueError("KoO Carousel Executor: active_count must not be negative.")

        candidate_count = min(requested_count, len(prompt_list))
        if candidate_count == 0:
            raise ValueError("KoO Carousel Executor: no enabled prompts were provided.")

        if len(seed_list) < candidate_count:
            raise ValueError(
                "KoO Carousel Executor: missing seed values. "
                f"Received {len(seed_list)} seed(s) for {candidate_count} enabled prompt(s)."
            )
        if len(index_list) < candidate_count:
            raise ValueError(
                "KoO Carousel Executor: missing prompt index values. "
                f"Received {len(index_list)} index value(s) for {candidate_count} enabled prompt(s)."
            )

        source_status = " | ".join(str(value) for value in _as_list(status) if value not in (None, ""))
        skipped = []
        out_prompts = []
        out_seeds = []
        out_filenames = []
        out_indices = []

        for position in range(candidate_count):
            prompt = prompt_list[position]
            prompt_index = _safe_int(index_list[position], position + 1)
            if prompt_index < 1:
                raise ValueError(f"KoO Carousel Executor: invalid prompt index at position {position + 1}.")

            if prompt.strip() == "":
                skipped.append(prompt_index)
                continue

            seed = _clamp_seed(seed_list[position])
            if position < len(filename_list) and str(filename_list[position] if filename_list[position] is not None else "") != "":
                filename = str(filename_list[position])
            else:
                filename = _executor_filename(DEFAULT_PREFIX, prompt_index)

            out_prompts.append(prompt)
            out_seeds.append(seed)
            out_filenames.append(filename)
            out_indices.append(prompt_index)

        if not out_prompts:
            raise ValueError("KoO Carousel Executor: every enabled prompt is empty or whitespace only.")

        total = len(out_prompts)
        note_parts = []
        if skipped:
            note_parts.append(f"skipped empty prompt(s): {', '.join(str(index) for index in skipped)}")
        if requested_count != len(prompt_list):
            note_parts.append(f"active_count {requested_count} with {len(prompt_list)} prompt value(s)")
        if source_status:
            note_parts.append(source_status)
        note = f" | {' | '.join(note_parts)}" if note_parts else ""
        out_total = [total] * total
        out_status = [
            f"Carousel {position + 1}/{total} - Prompt {prompt_index}{note}"
            for position, prompt_index in enumerate(out_indices)
        ]

        lengths = {len(out_prompts), len(out_seeds), len(out_filenames), len(out_indices), len(out_total), len(out_status)}
        if len(lengths) != 1:
            raise ValueError("KoO Carousel Executor: internal output list length mismatch.")

        return (out_prompts, out_seeds, out_filenames, out_indices, out_total, out_status)


NODE_CLASS_MAPPINGS = {
    "KoOCarouselPromptManager": KoOCarouselPromptManager,
    "KoOCarouselUnlimited": KoOCarouselUnlimited,
    "KoOCarouselPromptExecutor": KoOCarouselPromptExecutor,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOCarouselPromptManager": "KoO Carousel Prompt Manager",
    "KoOCarouselUnlimited": "KoO Carousel Unlimited",
    "KoOCarouselPromptExecutor": "KoO Carousel Executor",
}
