import base64
from contextlib import redirect_stdout
from dataclasses import replace
import hashlib
from io import BytesIO, StringIO
import json
import importlib.util
import os
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PACKAGE_NAME = "koo_visual_prompt_director_test"
PACKAGE_DIR = Path(__file__).resolve().parents[1] / "nodes" / "visual_prompt_director"
FRONTEND_PATH = Path(__file__).resolve().parents[1] / "web" / "visual_prompt_director" / "koo_visual_prompt_director.js"
PACKAGE_SPEC = importlib.util.spec_from_file_location(
    PACKAGE_NAME,
    PACKAGE_DIR / "__init__.py",
    submodule_search_locations=[str(PACKAGE_DIR)],
)
PACKAGE = importlib.util.module_from_spec(PACKAGE_SPEC)
sys.modules[PACKAGE_NAME] = PACKAGE
PACKAGE_SPEC.loader.exec_module(PACKAGE)

from koo_visual_prompt_director_test.backends.base import (
    BackendCapabilityError,
    BackendConfigurationError,
    PromptDirectorBackend,
)
from koo_visual_prompt_director_test.backends.llama_cpp_process import (
    LlamaCppLaunchConfig,
    LlamaCppProcessManager,
    get_process_manager,
)
from koo_visual_prompt_director_test.backends.local_llama_cpp import LocalLlamaCppBackend
from koo_visual_prompt_director_test.backends.openai_compatible import OpenAICompatibleBackend
from koo_visual_prompt_director_test.core import (
    PROMPT_LENGTH_NAMES,
    PromptDirectorRequest,
    PromptDirectorService,
    REFERENCE_ROLE_NAMES,
    assemble_instruction,
)
from koo_visual_prompt_director_test.director_profiles import (
    PROMPT_MODEL_GEMMA,
    PROMPT_MODEL_NAMES,
    PROMPT_MODEL_QWEN,
    PROMPT_MODEL_QWEN_AGGRESSIVE,
    PROMPT_MODEL_QWEN_UNCENSORED,
    canonical_prompt_model,
    discover_director_profiles,
    resolve_director_config,
)
from koo_visual_prompt_director_test.image_utils import EncodedImage, encode_comfy_image
from koo_visual_prompt_director_test.evidence import (
    EVIDENCE_SCHEMA_VERSION,
    build_resolved_scene,
    clear_evidence_cache,
    evidence_cache_key,
    parse_image_evidence,
)
from koo_visual_prompt_director_test.config import resolve_config_path
from koo_visual_prompt_director_test.nodes import KoOVisualPromptDirector
from koo_visual_prompt_director_test.presets import (
    DEFAULT_DIRECTOR_PRESET,
    DIRECTOR_PRESET_NAMES,
    DIRECTOR_PRESETS,
    DirectorLibraryError,
    MODE_DIRECTOR_RECOMMENDATIONS,
    delete_user_director,
    discover_user_directors,
    get_director_preset,
    list_director_presets,
    recommended_director_for_mode,
    save_user_director,
)
from koo_visual_prompt_director_test.reference_map import (
    REFERENCE_ATTRIBUTES,
    REFERENCE_SOURCE_NAMES,
    resolve_reference_map,
)
from koo_visual_prompt_director_test.routes import TEXT_ROUTE_PATH, UNLOAD_ROUTE_PATH


class PromptAssemblyTests(unittest.TestCase):
    def test_requested_presets_are_structured_and_public(self):
        self.assertEqual(
            DIRECTOR_PRESET_NAMES,
            (
                "General Director",
                "Prompt Enhancer",
                "Reverse Engineer",
                "Surgical Edit",
                "Face Identity Analyst",
                "Subject Appearance Analyst",
                "Reference Composer",
                "Photography Director",
                "Smartphone Realism",
                "Arm's-Length Selfie",
                "Mirror Selfie",
                "First-Person POV",
                "Fashion Editorial",
                "Vintage / Analog",
                "Boudoir / Intimate",
                "Krea 2 High Detail",
                "Krea 2 Smartphone Realism",
                "Krea 2 Pose Lock",
                "Video Director",
                "MiniMax H3 Director",
                "Archviz Director",
                "Character Director",
                "Product Director",
                "Style Transfer Director",
                "Dataset Caption Director",
                "Maximum Detail Director",
            ),
        )
        with tempfile.TemporaryDirectory() as temporary:
            public, warnings = list_director_presets(temporary)
        self.assertEqual(warnings, [])
        self.assertEqual(len(public), 26)
        self.assertEqual(len(DIRECTOR_PRESET_NAMES), len(set(DIRECTOR_PRESET_NAMES)))
        for preset, mapping in zip(DIRECTOR_PRESETS, public):
            self.assertTrue(preset.id)
            self.assertTrue(preset.label)
            self.assertTrue(preset.description)
            self.assertGreater(len(preset.base_system_prompt), 300)
            self.assertEqual(mapping["base_system_prompt"], preset.base_system_prompt)
            self.assertEqual(mapping["instructions"], preset.instructions)
            self.assertEqual(mapping["source"], "builtin")
            self.assertTrue(mapping["protected"])
            self.assertEqual(get_director_preset(preset.label), preset)
            self.assertEqual(get_director_preset(preset.id), preset)

        reference = get_director_preset("reference_reconstruction").instructions
        for required in (
            "forensic visual reverse engineer",
            "medium or origin",
            "subject and defining appearance",
            "pose or action",
            "composition",
            "optics and perspective",
            "fidelity taking precedence over beautification",
            "shallow depth of field",
            "include a characteristic only when",
        ):
            self.assertIn(required, reference)

    def test_curated_directors_have_task_specific_behavior(self):
        required_phrases = {
            "Prompt Enhancer": ("rough text", "subject, action, environment", "different genre"),
            "Surgical Edit": ("adds an element", "removes an element", "explicitly targeted subject"),
            "Face Identity Analyst": ("eye shape and spacing", "distinctive asymmetries", "Omit body"),
            "Subject Appearance Analyst": ("reusable appearance descriptor", "invent hidden anatomy", "scene variables"),
            "Smartphone Realism": ("phone-like focal-length perspective", "computational exposure", "particular phone model"),
            "Arm's-Length Selfie": ("close wide-angle perspective", "phone itself must not appear", "arm geometry"),
            "Mirror Selfie": ("phone is visible in the reflection", "mirror plane", "impossible reflection"),
            "First-Person POV": ("person's own eye", "third-person full-body", "foreshortening"),
            "Fashion Editorial": ("garment", "fabric construction", "random luxury signifiers"),
            "Vintage / Analog": ("grain structure", "halation", "generic nostalgia"),
            "Boudoir / Intimate": ("lawful adult", "natural skin texture", "unnecessarily sanitize"),
            "Krea 2 High Detail": ("spatial relationships", "KoO Krea target adapter", "unverified engine rules"),
            "Krea 2 Smartphone Realism": ("smartphone photography", "KoO Krea adapter", "golden hour"),
            "Krea 2 Pose Lock": ("torso orientation", "hand placement", "weight distribution"),
            "Video Director": ("exact initial visual state", "chronological subject action", "future optional end-frame"),
            "MiniMax H3 Director": ("exact starting frame", "environmental motion", "future start-and-end image support"),
            "Maximum Detail Director": ("maximum useful descriptive density", "spatial and causal relationships", "generic quality slogans"),
        }
        for name, phrases in required_phrases.items():
            behavior = get_director_preset(name).instructions
            with self.subTest(name=name):
                for phrase in phrases:
                    self.assertIn(phrase, behavior)

    def test_mode_recommendations_cover_every_mode_and_allow_manual_override(self):
        expected = {
            "Enhance": "General Director",
            "Photography": "Photography Director",
            "Archviz": "Archviz Director",
            "Video": "Video Director",
            "Product": "Product Director",
            "Character": "Character Director",
            "Image Edit": "Surgical Edit",
            "Style Transfer": "Style Transfer Director",
            "Dataset Caption": "Dataset Caption Director",
            "Custom": "General Director",
        }
        self.assertEqual(MODE_DIRECTOR_RECOMMENDATIONS, expected)
        for mode, director in expected.items():
            with self.subTest(mode=mode):
                self.assertEqual(recommended_director_for_mode(mode), director)
        self.assertEqual(recommended_director_for_mode("Unknown Mode"), "General Director")
        manual = assemble_instruction(
            PromptDirectorRequest(
                idea="architectural portrait",
                mode="Photography",
                director_preset="Reverse Engineer",
            )
        )
        self.assertEqual(manual.director_preset, "Reverse Engineer")
        self.assertIn("forensic visual reverse engineer", manual.system_message)

    def test_instruction_has_approved_layer_order(self):
        instruction = assemble_instruction(
            PromptDirectorRequest(
                idea="modern kitchen oak stone plants",
                mode="Archviz",
                target_model="Krea 2",
                creativity="Balanced",
                preserve_materials=True,
                prompt_length="Detailed",
                custom_instructions="Use restrained editorial language.",
            )
        )
        system = instruction.system_message
        self.assertLess(system.index("KoO Visual Prompt Director"), system.index("PRIORITY AND CONFLICT RESOLUTION"))
        self.assertLess(system.index("PRIORITY AND CONFLICT RESOLUTION"), system.index("MODE ADAPTER"))
        self.assertLess(system.index("MODE ADAPTER"), system.index("TARGET MODEL ADAPTER"))
        self.assertLess(system.index("TARGET MODEL ADAPTER"), system.index("USER SETTINGS"))
        self.assertLess(system.index("USER SETTINGS"), system.index("PRESERVATION CONSTRAINTS"))
        self.assertLess(system.index("PRESERVATION CONSTRAINTS"), system.index("DIRECTOR BEHAVIOR"))
        self.assertLess(system.index("DIRECTOR BEHAVIOR"), system.index("WORKFLOW RULES"))
        self.assertLess(system.index("WORKFLOW RULES"), system.index("Output contract"))
        self.assertIn("architectural photographer", system)
        self.assertIn("Krea 2 target", system)
        self.assertIn("Preserve materials", system)
        for priority in (
            "1. The explicit current WHAT DO YOU WANT? transformation",
            "2. Explicit manual Reference Map assignments.",
            "3. Enabled Preserve locks",
            "4. Deterministic automatic Director/reference resolution.",
            "5. Primary-reference evidence.",
            "6. Secondary-reference evidence.",
            "7. Final LLM inference, optional enrichment, and defaults.",
            "must not reassign attribute sources",
            "Never combine incompatible subjects, identities, outfits, poses, settings, camera descriptions, lighting conditions, materials, or edit outcomes",
        ):
            self.assertIn(priority, system)
        self.assertEqual(instruction.user_message, "modern kitchen oak stone plants")

    def test_maximum_length_is_optional_and_uses_shared_dense_instruction_path(self):
        self.assertEqual(PROMPT_LENGTH_NAMES, ("Short", "Medium", "Detailed", "Maximum Detail", "Maximum"))
        normal = assemble_instruction(
            PromptDirectorRequest(idea="editorial portrait", prompt_length="Medium"),
            text_only=True,
        )
        maximum_text = assemble_instruction(
            PromptDirectorRequest(idea="editorial portrait", prompt_length="Maximum Detail"),
            text_only=True,
        )
        maximum_image = assemble_instruction(
            PromptDirectorRequest(
                idea="retain the subject",
                prompt_length="Maximum Detail",
                image=EncodedImage("image/png", "ZmFrZQ==", 64, 64),
                image_2=EncodedImage("image/png", "c2Vjb25k", 64, 64),
                target_model="Krea 2",
                preserve_subject=True,
                preserve_camera=True,
                reference_map={"subject": "Image 1", "scene": "Image 2", "colors": "Blend"},
            )
        )
        legacy_maximum = assemble_instruction(
            PromptDirectorRequest(idea="legacy workflow", prompt_length="Maximum"),
            text_only=True,
        )
        marker = "Prompt length — Maximum Detail: produce a substantially longer, densely descriptive natural-language prompt."
        self.assertNotIn(marker, normal.system_message)
        self.assertIn("Prompt length — Medium", normal.system_message)
        self.assertIn(marker, maximum_text.system_message)
        self.assertIn(marker, maximum_image.system_message)
        self.assertIn(marker, legacy_maximum.system_message)
        for instruction in (maximum_text.system_message, maximum_image.system_message, legacy_maximum.system_message):
            self.assertIn("foreground, midground", instruction)
            self.assertIn("camera height, angle", instruction)
            self.assertIn("key, fill, rim", instruction)
            self.assertIn("Reference Map and Preserve constraints", instruction)
            self.assertIn("never force 35mm, film grain, or ControlNet", instruction)
            self.assertIn("Do not repeat details", instruction)
        self.assertIn("Krea 2 target:", maximum_image.system_message)
        self.assertIn("Preserve Subject from Image 1 strictly", maximum_image.system_message)
        self.assertIn("Preserve Camera", maximum_image.system_message)
        self.assertIn("Use environment/background from Image 2", maximum_image.system_message)

    def test_reverse_engineer_medium_matches_recovered_historical_hash(self):
        instruction = assemble_instruction(PromptDirectorRequest(
            idea="audit fixture",
            mode="Enhance",
            target_model="Generic",
            creativity="Balanced",
            director_preset="Reverse Engineer",
            prompt_length="Medium",
            preserve_subject=False,
        ), text_only=True)
        digest = hashlib.sha256(instruction.system_message.encode("utf-8")).hexdigest().upper()
        self.assertEqual(digest, "34907CFD5C50A59C0F545C465164BDA9E2AE559BA765DCE4B5128E5F2B1E2DD7")

    def test_acceptance_behavior_families_are_distinct(self):
        reverse_medium = assemble_instruction(PromptDirectorRequest(
            idea="reconstruct the same reference",
            director_preset="Reverse Engineer",
            prompt_length="Medium",
        ), text_only=True)
        maximum_director_medium = assemble_instruction(PromptDirectorRequest(
            idea="reconstruct the same reference",
            director_preset="Maximum Detail Director",
            prompt_length="Medium",
        ), text_only=True)
        full_monster = assemble_instruction(PromptDirectorRequest(
            idea="reconstruct the same reference",
            director_preset="Maximum Detail Director",
            prompt_length="Maximum Detail",
        ), text_only=True)
        self.assertNotIn("maximum useful descriptive density", reverse_medium.system_message)
        self.assertIn("maximum useful descriptive density", maximum_director_medium.system_message)
        self.assertIn("maximum useful descriptive density", full_monster.system_message)

    def test_maximum_length_preserves_reverse_engineer_and_user_anime_identity(self):
        reverse = assemble_instruction(PromptDirectorRequest(
            idea="reconstruct the reference",
            director_preset="Reverse Engineer",
            prompt_length="Maximum Detail",
        ), text_only=True)
        self.assertIn("DIRECTOR BEHAVIOR — Reverse Engineer", reverse.system_message)
        self.assertIn("forensic visual reverse engineer", reverse.system_message)
        self.assertIn("Prompt length — Maximum Detail", reverse.system_message)
        self.assertNotIn("DIRECTOR BEHAVIOR — Maximum Detail Director", reverse.system_message)

        with tempfile.TemporaryDirectory() as library, patch.dict(
            os.environ, {"KOO_PROMPT_DIRECTOR_USER_DIR": library}
        ):
            save_user_director(
                "Anime Director",
                "Direct a coherent anime illustration using deliberate line weight, cel shading, expressive shape language, and anime-specific composition.",
                directory=library,
            )
            anime = assemble_instruction(PromptDirectorRequest(
                idea="hero crossing a rainy station",
                director_preset="Anime Director",
                prompt_length="Maximum Detail",
            ), text_only=True)
        self.assertIn("DIRECTOR BEHAVIOR — Anime Director", anime.system_message)
        self.assertIn("line weight, cel shading", anime.system_message)
        self.assertIn("Prompt length — Maximum Detail", anime.system_message)
        self.assertNotIn("maximum useful descriptive density", anime.system_message)

    def test_prompt_length_is_independent_from_preset_identity_and_image_grounding(self):
        base = dict(
            idea="preserve the visible scene",
            director_preset="Photography Director",
            image=EncodedImage("image/png", "ZmFrZQ==", 64, 64),
        )
        medium = assemble_instruction(PromptDirectorRequest(**base, prompt_length="Medium"))
        detailed = assemble_instruction(PromptDirectorRequest(**base, prompt_length="Detailed"))
        maximum = assemble_instruction(PromptDirectorRequest(**base, prompt_length="Maximum Detail"))
        for instruction in (medium, detailed, maximum):
            self.assertEqual(instruction.director_preset, "Photography Director")
            self.assertIn("DIRECTOR BEHAVIOR — Photography Director", instruction.system_message)
            self.assertIn("VISUAL GROUNDING", instruction.system_message)
            self.assertIn("Image 1 controls:", instruction.system_message)
        self.assertIn("Prompt length — Medium", medium.system_message)
        self.assertIn("Prompt length — Detailed", detailed.system_message)
        self.assertIn("Prompt length — Maximum Detail", maximum.system_message)

    def test_medium_reassembly_remains_medium(self):
        request = PromptDirectorRequest(
            idea="natural medium reconstruction",
            director_preset="Reverse Engineer",
            prompt_length="Medium",
        )
        first_pass = assemble_instruction(request, text_only=True)
        enhancement_pass = assemble_instruction(
            replace(request, idea="polish coherence without changing useful detail"),
            text_only=True,
        )
        for instruction in (first_pass, enhancement_pass):
            self.assertIn("Prompt length — Medium", instruction.system_message)
            self.assertNotIn("Prompt length — Maximum Detail", instruction.system_message)

    def test_builtin_directors_contain_no_copied_research_headers_or_citation_markers(self):
        forbidden = (
            "OFFICIAL BEST PRACTICE",
            "COMMUNITY-REPORTED",
            "SKELETAL POSE LOCK",
            "text encoder aligns perfectly",
            "512-token",
            "512 token",
        )
        for preset in DIRECTOR_PRESETS:
            with self.subTest(preset=preset.label):
                for marker in forbidden:
                    self.assertNotIn(marker.casefold(), preset.instructions.casefold())
                self.assertIsNone(re.search(r"\[[0-9]+(?:,\s*[0-9]+)+\]", preset.instructions))

    def test_preservation_controls_materially_change_instruction(self):
        fields = {
            "subject": "Preserve subject:",
            "materials": "Preserve materials:",
            "composition": "Preserve composition:",
            "lighting": "Preserve lighting:",
            "camera": "Preserve camera:",
            "colors": "Preserve colors:",
        }
        disabled = {f"preserve_{name}": False for name in fields}
        baseline = assemble_instruction(PromptDirectorRequest(idea="oak kitchen", **disabled))
        for name, instruction_text in fields.items():
            with self.subTest(name=name):
                enabled = dict(disabled)
                enabled[f"preserve_{name}"] = True
                protected = assemble_instruction(PromptDirectorRequest(idea="oak kitchen", **enabled))
                self.assertNotIn(instruction_text, baseline.system_message)
                self.assertIn(instruction_text, protected.system_message)

    def test_video_adapter_is_temporal(self):
        instruction = assemble_instruction(
            PromptDirectorRequest(idea="woman touches wall then zoom wall", mode="Video", target_model="LTX 2.5")
        )
        self.assertIn("chronological subject action", instruction.system_message)
        self.assertIn("beginning-to-end progression", instruction.system_message)
        self.assertIn("final framing", instruction.system_message)

    def test_director_working_copy_replaces_only_director_layer(self):
        instruction = assemble_instruction(
            PromptDirectorRequest(idea="red chair", system_prompt_override="MY CUSTOM CORE")
        )
        self.assertTrue(instruction.system_message.startswith("You are KoO Visual Prompt Director"))
        self.assertIn("DIRECTOR BEHAVIOR — General Director\nMY CUSTOM CORE", instruction.system_message)
        self.assertNotIn(get_director_preset("General Director").instructions, instruction.system_message)
        self.assertIn("MODE ADAPTER", instruction.system_message)
        self.assertIn("Output contract", instruction.system_message)

    def test_ui_placeholder_examples_are_never_real_prompt_content(self):
        extra_placeholder = (
            "Example: Always preserve the original pose and camera angle. "
            "Keep prompts under 150 words."
        )
        director_placeholder = (
            "Example: You are an expert visual reverse engineer. Analyze pose, composition, "
            "camera, lighting and materials precisely. Preserve visible evidence and avoid invented details."
        )
        instruction = assemble_instruction(
            PromptDirectorRequest(
                idea="red chair",
                custom_instructions="",
                system_prompt_override="",
            )
        )
        self.assertNotIn(extra_placeholder, instruction.system_message)
        self.assertNotIn(director_placeholder, instruction.system_message)
        self.assertNotIn("WORKFLOW RULES", instruction.system_message)

    def test_preset_switch_edit_and_reset_are_deterministic(self):
        reference = assemble_instruction(
            PromptDirectorRequest(idea="red chair", director_preset="Reverse Engineer")
        )
        creative = assemble_instruction(
            PromptDirectorRequest(idea="red chair", director_preset="General Director")
        )
        edited = assemble_instruction(
            PromptDirectorRequest(
                idea="red chair",
                director_preset="General Director",
                system_prompt_override="You're an expert prompt engineer. Keep the chair exact.",
                custom_instructions="Use restrained editorial language.",
            )
        )
        reset = assemble_instruction(
            PromptDirectorRequest(
                idea="red chair",
                director_preset="General Director",
                system_prompt_override="",
            )
        )
        self.assertNotEqual(reference.system_message, creative.system_message)
        self.assertEqual(reference.director_preset, "Reverse Engineer")
        self.assertEqual(creative.director_preset, "General Director")
        self.assertIn("DIRECTOR BEHAVIOR — General Director\nYou're an expert prompt engineer", edited.system_message)
        self.assertIn("WORKFLOW RULES\nUse restrained editorial language.", edited.system_message)
        self.assertIn(get_director_preset("General Director").instructions, reset.system_message)
        self.assertNotIn("Keep the chair exact", reset.system_message)

    def test_qwen_and_gemma_use_different_message_role_formats(self):
        qwen = assemble_instruction(
            PromptDirectorRequest(idea="red chair", prompt_model=PROMPT_MODEL_QWEN)
        )
        gemma = assemble_instruction(
            PromptDirectorRequest(idea="red chair", prompt_model=PROMPT_MODEL_GEMMA)
        )
        gemma_image = assemble_instruction(
            PromptDirectorRequest(
                idea="red chair",
                prompt_model=PROMPT_MODEL_GEMMA,
                image=EncodedImage("cG5n", "image/png", 64, 64),
            )
        )
        self.assertEqual(qwen.system_message, gemma.system_message)
        self.assertEqual([message["role"] for message in qwen.to_messages()], ["system", "user"])
        gemma_messages = gemma.to_messages()
        self.assertEqual([message["role"] for message in gemma_messages], ["user"])
        self.assertIsInstance(gemma_messages[0]["content"], str)
        image_messages = gemma_image.to_messages()
        self.assertEqual([part["type"] for part in image_messages[0]["content"]], ["text", "image_url"])
        folded = image_messages[0]["content"][0]["text"]
        self.assertIn("SYSTEM-STYLE INSTRUCTIONS:", folded)
        self.assertIn("USER REQUEST:", folded)
        self.assertIn("red chair", folded)

    def test_legacy_director_ai_payload_maps_to_canonical_prompt_model(self):
        legacy = PromptDirectorRequest.from_mapping({"idea": "test", "director_ai": "Gemma"})
        self.assertEqual(legacy.selected_prompt_model, PROMPT_MODEL_GEMMA)
        self.assertEqual(legacy.director_preset, "General Director")
        self.assertEqual(legacy.image_1_role, "Auto")
        self.assertEqual(legacy.image_2_role, "Auto")
        self.assertTrue(all(source == "Auto" for source in legacy.reference_map.values()))
        mapped = PromptDirectorRequest.from_mapping({"idea": "test", "reference_pose_source": "2"})
        self.assertEqual(mapped.reference_map["pose"], "Image 2")
        legacy_archviz = PromptDirectorRequest.from_mapping(
            {"idea": "test", "mode": "Archviz", "director_ai": "Default"}
        )
        self.assertEqual(legacy_archviz.director_preset, "Archviz Director")
        legacy_named = assemble_instruction(
            PromptDirectorRequest(idea="test", director_preset="Reference Reconstruction")
        )
        self.assertEqual(legacy_named.director_preset, "Reverse Engineer")
        legacy_image_edit = assemble_instruction(
            PromptDirectorRequest(idea="remove the cup", director_preset="Image Edit Director")
        )
        self.assertEqual(legacy_image_edit.director_preset, "Surgical Edit")
        self.assertEqual(canonical_prompt_model("Uncensored"), PROMPT_MODEL_QWEN_UNCENSORED)
        self.assertEqual(canonical_prompt_model("Default"), PROMPT_MODEL_QWEN)

    def test_archviz_image_is_ground_truth(self):
        image = EncodedImage("aW1hZ2U=", "image/png", 640, 480)
        instruction = assemble_instruction(
            PromptDirectorRequest(
                idea="make the oak slightly warmer",
                mode="Archviz",
                target_model="Qwen Image",
                image=image,
            )
        )
        self.assertIn("VISUAL GROUNDING", instruction.system_message)
        self.assertIn("visible architecture", instruction.system_message)
        self.assertIn("preserve them", instruction.system_message)
        self.assertEqual(instruction.image, image)
        self.assertIn("USER REQUESTED CHANGES", instruction.user_message)

    def test_video_image_is_initial_frame(self):
        instruction = assemble_instruction(
            PromptDirectorRequest(
                idea="the woman touches the wall, then the camera pushes in",
                mode="Video",
                target_model="LTX 2.5",
                image=EncodedImage("aW1hZ2U=", "image/png", 1024, 576),
            )
        )
        self.assertIn("exact initial frame", instruction.system_message)
        self.assertIn("subject and environmental motion chronologically", instruction.system_message)
        self.assertIn("final framing", instruction.system_message)

    def test_image_only_dataset_caption_request_is_valid(self):
        instruction = assemble_instruction(
            PromptDirectorRequest(
                idea="",
                mode="Dataset Caption",
                image=EncodedImage("aW1hZ2U=", "image/png", 512, 512),
            )
        )
        self.assertIn("No additional change requested", instruction.user_message)
        self.assertIn("caption visible content factually", instruction.system_message)

    def test_legacy_subject_and_scene_roles_become_noncompeting_shortcuts(self):
        resolved = resolve_reference_map(PromptDirectorRequest(
            idea="compose one coherent result",
            image=object(),
            image_2=object(),
            image_1_role="Subject",
            image_2_role="Scene",
        ), "Reference Composer")
        for attribute in ("subject", "face", "outfit", "pose"):
            self.assertEqual(resolved.source_for(attribute), "Image 1")
            self.assertEqual(resolved.reason_for(attribute), "legacy Image Role shortcut")
        for attribute in ("scene", "composition", "camera"):
            self.assertEqual(resolved.source_for(attribute), "Image 2")
            self.assertEqual(resolved.reason_for(attribute), "legacy Image Role shortcut")

    def test_manual_attribute_map_supports_subject_outfit_and_secondary_lighting(self):
        resolved = resolve_reference_map(PromptDirectorRequest(
            idea="compose one coherent result",
            image=object(),
            image_2=object(),
            reference_map={"subject": "Image 1", "outfit": "Image 1", "lighting": "Image 2"},
        ))
        self.assertEqual(resolved.source_for("subject"), "Image 1")
        self.assertEqual(resolved.source_for("outfit"), "Image 1")
        self.assertEqual(resolved.source_for("lighting"), "Image 2")
        self.assertEqual(resolved.reason_for("lighting"), "manual Reference Map assignment")

    def test_reported_manual_map_is_compiled_as_hard_constraints_without_preserve_bleed(self):
        image_1 = EncodedImage("aW1hZ2Utb25l", "image/png", 640, 960)
        image_2 = EncodedImage("aW1hZ2UtdHdv", "image/png", 1024, 768)
        request = PromptDirectorRequest(
            idea="compose these references faithfully",
            director_preset="Reference Composer",
            image=image_1,
            image_2=image_2,
            preserve_subject=True,
            preserve_composition=True,
            preserve_camera=True,
            reference_map={
                "subject": "Image 1",
                "outfit": "Image 2",
                "composition": "Image 1",
                "scene": "Image 2",
                "colors": "Image 2",
            },
        )

        trace = StringIO()
        with redirect_stdout(trace):
            instruction = assemble_instruction(request)

        expected = {
            "subject": "Image 1",
            "face": "Image 1",
            "outfit": "Image 2",
            "pose": "Image 1",
            "composition": "Image 1",
            "camera": "Image 1",
            "scene": "Image 2",
            "lighting": "Image 2",
            "colors": "Image 2",
            "mood": "Image 2",
            "materials": "Image 1",
        }
        self.assertEqual(
            {item.key: item.source for item in instruction.reference_map.attributes},
            expected,
        )

        system = instruction.system_message
        for constraint in (
            "Use the subject from Image 1. Do not use a conflicting subject from Image 2.",
            "Use clothing/outfit from Image 2. Do not use conflicting clothing from Image 1.",
            "Use composition and framing from Image 1. Do not use conflicting composition or framing from Image 2.",
            "Use environment/background from Image 2. Do not retain the conflicting environment from Image 1.",
            "Use the dominant color treatment/palette from Image 2. Do not use the conflicting palette from Image 1.",
        ):
            self.assertIn(constraint, system)
        self.assertIn("Preserve Subject from Image 1 strictly", system)
        self.assertIn("Preserve Composition from Image 1 strictly", system)
        self.assertIn("Preserve Camera from Image 1 strictly", system)
        self.assertNotIn("Preserve Outfit", system)
        self.assertNotIn("Preserve subject: do not change subject identity, type, count, key attributes, clothing", system)
        self.assertGreater(system.index("REFERENCE SOURCE MAP"), system.index("DIRECTOR BEHAVIOR"))

        content = instruction.to_messages()[1]["content"]
        self.assertEqual([part["type"] for part in content], ["text", "image_url", "text", "image_url"])
        self.assertEqual(content[1]["image_url"]["url"], image_1.data_url)
        self.assertEqual(content[3]["image_url"]["url"], image_2.data_url)

        diagnostics = trace.getvalue()
        self.assertIn("[KoO Reference Map INPUT]", diagnostics)
        self.assertIn("Outfit = image_2", diagnostics)
        self.assertIn("Scene / Environment = image_2", diagnostics)
        self.assertIn("[KoO Reference Map RESOLVED]", diagnostics)
        self.assertIn("[KoO IMAGE ORDER]", diagnostics)
        self.assertIn("[KoO DIRECTOR CONSTRAINTS]", diagnostics)

    def test_explicit_user_scene_transformation_overrides_manual_scene_reference(self):
        resolved = resolve_reference_map(PromptDirectorRequest(
            idea="replace the room with a park",
            image=object(),
            image_2=object(),
            reference_map={"scene": "Image 2", "subject": "Image 1"},
        ))
        self.assertEqual(resolved.source_for("scene"), "User Prompt")
        self.assertEqual(resolved.reason_for("scene"), "explicit user transformation")
        self.assertEqual(resolved.source_for("subject"), "Image 1")

    def test_manual_source_overrides_automatic_primary_source(self):
        resolved = resolve_reference_map(PromptDirectorRequest(
            idea="compose one coherent result",
            image=object(),
            image_2=object(),
            reference_map={"pose": "Image 2"},
        ))
        self.assertEqual(resolved.source_for("pose"), "Image 2")
        self.assertEqual(resolved.reason_for("pose"), "manual Reference Map assignment")

    def test_preserve_lock_keeps_unrequested_subject_on_primary_reference(self):
        request = PromptDirectorRequest(
            idea="compose one coherent result",
            image=object(),
            image_2=object(),
            preserve_subject=True,
            reference_map={"lighting": "Image 2"},
        )
        resolved = resolve_reference_map(request)
        subject = next(item for item in resolved.attributes if item.key == "subject")
        self.assertEqual(subject.source, "Image 1")
        self.assertTrue(subject.preserve)
        self.assertEqual(resolved.source_for("lighting"), "Image 2")

    def test_conflicting_references_do_not_bleed_unassigned_attributes(self):
        instruction = assemble_instruction(PromptDirectorRequest(
            idea="compose one coherent result",
            image=EncodedImage("b25l", "image/png", 64, 64),
            image_2=EncodedImage("dHdv", "image/png", 64, 64),
            reference_map={"subject": "Image 1", "scene": "Image 2"},
        ))
        self.assertIn("REFERENCE SOURCE MAP", instruction.system_message)
        self.assertIn("When references conflict, use the assigned source for that attribute", instruction.system_message)
        self.assertIn("do not borrow the conflicting version from another image", instruction.system_message)

    def test_blend_is_intentional_and_attribute_scoped(self):
        resolved = resolve_reference_map(PromptDirectorRequest(
            idea="combine the material treatment",
            image=object(),
            image_2=object(),
            reference_map={"materials": "Blend"},
        ))
        self.assertEqual(resolved.source_for("materials"), "Blend")
        instructions = resolved.to_instructions()
        self.assertIn("Blend controls:\n- Materials", instructions)
        self.assertIn("combine compatible evidence from both images only for that named attribute", instructions)

    def test_single_image_auto_map_remains_fully_image_grounded(self):
        image = EncodedImage("b25l", "image/png", 64, 64)
        instruction = assemble_instruction(PromptDirectorRequest(idea="describe it", image=image))
        self.assertTrue(all(item.source == "Image 1" for item in instruction.reference_map.attributes))
        self.assertEqual([part["type"] for part in instruction.to_messages()[1]["content"]], ["text", "image_url"])
        self.assertIn("IMAGE 1 — REFERENCE", instruction.to_messages()[1]["content"][0]["text"])

    def test_reference_map_contains_visible_text_anti_hallucination_rule(self):
        instruction = assemble_instruction(PromptDirectorRequest(idea="reconstruct it", image=object()))
        self.assertIn("Do not invent readable text, brand names, labels, book titles, logos", instruction.system_message)
        self.assertIn("Generalize or omit uncertain evidence", instruction.system_message)

    def test_image_two_alone_is_a_valid_grounded_request(self):
        image_2 = EncodedImage("dHdv", "image/png", 64, 64)
        instruction = assemble_instruction(PromptDirectorRequest(idea="", image_2=image_2))
        self.assertIsNone(instruction.image)
        self.assertEqual(instruction.image_2, image_2)
        self.assertTrue(all(item.source == "Image 2" for item in instruction.reference_map.attributes))
        self.assertIn("No additional change requested", instruction.user_message)


class DirectorLibraryTests(unittest.TestCase):
    def test_save_as_persists_reloadable_user_director_without_overwriting_builtins(self):
        with tempfile.TemporaryDirectory() as temporary:
            library = Path(temporary) / "directors"
            instructions = "Direct every scene with restrained chiaroscuro and exact subject continuity."
            saved, destination = save_user_director(
                "My Studio Director",
                instructions,
                "Photography",
                directory=library,
            )
            self.assertEqual(destination, library / "my-studio-director.json")
            self.assertEqual(
                json.loads(destination.read_text(encoding="utf-8")),
                {
                    "version": 1,
                    "name": "My Studio Director",
                    "instructions": instructions,
                    "recommended_mode": "Photography",
                },
            )
            self.assertEqual(saved.source, "user")
            self.assertFalse(saved.to_public_mapping()["protected"])

            first_load, first_warnings = discover_user_directors(library)
            second_load, second_warnings = discover_user_directors(library)
            self.assertEqual(first_warnings, ())
            self.assertEqual(second_warnings, ())
            self.assertEqual([item.label for item in first_load], ["My Studio Director"])
            self.assertEqual(second_load[0].instructions, instructions)
            self.assertEqual(get_director_preset("My Studio Director", library).instructions, instructions)

            public, warnings = list_director_presets(library)
            self.assertEqual(warnings, [])
            self.assertEqual(public[-1]["name"], "My Studio Director")
            self.assertEqual(public[-1]["recommended_mode"], "Photography")
            with self.assertRaises(DirectorLibraryError):
                save_user_director("Photography Director", "attempted overwrite", directory=library)
            with self.assertRaises(DirectorLibraryError):
                save_user_director("My Studio Director", "attempted overwrite", directory=library)
            self.assertEqual(get_director_preset("Photography Director", library).source, "builtin")

    def test_reset_uses_saved_director_instructions_and_custom_layer_stays_independent(self):
        with tempfile.TemporaryDirectory() as temporary:
            save_user_director(
                "Continuity Director",
                "Protect subject continuity across every requested variation.",
                "Character",
                directory=temporary,
            )
            with patch.dict(os.environ, {"KOO_PROMPT_DIRECTOR_USER_DIR": temporary}):
                edited = assemble_instruction(
                    PromptDirectorRequest(
                        idea="hero portrait",
                        director_preset="Continuity Director",
                        system_prompt_override="Use a temporary high-key persona.",
                        custom_instructions="Keep the red scarf.",
                    )
                )
                reset = assemble_instruction(
                    PromptDirectorRequest(
                        idea="hero portrait",
                        director_preset="Continuity Director",
                        system_prompt_override="",
                        custom_instructions="Keep the red scarf.",
                    )
                )
            self.assertIn("Use a temporary high-key persona.", edited.system_message)
            self.assertNotIn("Protect subject continuity", edited.system_message)
            self.assertIn("Protect subject continuity", reset.system_message)
            self.assertNotIn("temporary high-key", reset.system_message)
            self.assertIn("WORKFLOW RULES\nKeep the red scarf.", edited.system_message)
            self.assertIn("WORKFLOW RULES\nKeep the red scarf.", reset.system_message)

    def test_delete_removes_only_selected_user_director_and_persists_after_reload(self):
        with tempfile.TemporaryDirectory() as temporary:
            library = Path(temporary) / "directors"
            saved, destination = save_user_director(
                "Disposable Director",
                "Provide a deliberately disposable directing persona.",
                "Video",
                directory=library,
            )
            retained, retained_path = save_user_director(
                "Retained Director",
                "Remain available after another Director is deleted.",
                "Photography",
                directory=library,
            )
            deleted, deleted_path = delete_user_director(saved.label, directory=library)
            self.assertEqual(deleted.label, "Disposable Director")
            self.assertEqual(deleted_path, destination)
            self.assertFalse(destination.exists())
            self.assertTrue(retained_path.exists())

            reloaded, warnings = discover_user_directors(library)
            self.assertEqual(warnings, ())
            self.assertEqual([director.label for director in reloaded], [retained.label])
            with self.assertRaises(DirectorLibraryError):
                delete_user_director("Disposable Director", directory=library)

    def test_delete_rejects_every_builtin_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            protected_names = [*DIRECTOR_PRESET_NAMES, "general_director", "Reference Reconstruction", "Image Edit Director"]
            for protected_name in protected_names:
                with self.subTest(protected_name=protected_name):
                    with self.assertRaises(DirectorLibraryError):
                        delete_user_director(protected_name, directory=temporary)


class FrontendDirectorUXTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FRONTEND_PATH.read_text(encoding="utf-8")

    def test_generated_prompt_copy_is_current_field_only_empty_safe_and_non_mutating(self):
        for text in (
            'function copyGeneratedPrompt(node)',
            'String(value(node, "generated_prompt", ""))',
            'if (!prompt.trim())',
            'globalThis.navigator.clipboard.writeText(prompt)',
            'document.execCommand("copy")',
            'showCopyFeedback(node, "EMPTY", "idle", "Generated prompt is empty")',
            'copied ? "COPIED!" : "FAILED"',
            'hit("copyGenerated", copyGenerated);',
            'hit.kind === "copyGenerated"',
        ):
            self.assertIn(text, self.source)
        function_start = self.source.index("async function copyGeneratedPrompt(node)")
        function_end = self.source.index("\n}\n", function_start) + 3
        copy_function = self.source[function_start:function_end]
        self.assertNotIn("setValue(", copy_function)
        self.assertNotIn("api.fetchApi", copy_function)
        self.assertNotIn("generate(", copy_function)
        copy_hit = self.source.index('hit("copyGenerated", copyGenerated);')
        output_hit = self.source.index('hit("text", output, "generated_prompt");')
        self.assertLess(copy_hit, output_hit)

    def test_maximum_length_and_director_are_exposed_without_new_serialized_widgets(self):
        self.assertIn('const LENGTHS = ["Short", "Medium", "Detailed", "Maximum Detail"]', self.source)
        self.assertIn('raw === "Maximum" ? "Maximum Detail"', self.source)
        self.assertIn('"Maximum Detail Director"', self.source)
        widget_start = self.source.index("const WIDGET_NAMES = [")
        widget_end = self.source.index("];", widget_start)
        widgets = self.source[widget_start:widget_end]
        self.assertNotIn("detail_intensity", widgets)
        self.assertNotIn("prompt_verbosity", widgets)

    def test_instruction_labels_helpers_and_placeholders_are_exact(self):
        for text in (
            "WORKFLOW RULES — OPTIONAL",
            "Extra rules applied to this specific workflow.",
            "Example: Always preserve the original pose and camera angle. Keep prompts under 150 words.",
            "DIRECTOR BEHAVIOR — ${s.director_preset}",
            "Defines how this reusable Director analyzes and writes prompts.",
            "Example: You are an expert visual reverse engineer. Analyze pose, composition, camera, lighting and materials precisely. Preserve visible evidence and avoid invented details.",
            "Workflow rules configured — click to edit",
        ):
            self.assertIn(text, self.source)
        self.assertNotIn('drawText(ctx, "EXTRA INSTRUCTIONS — OPTIONAL"', self.source)
        self.assertNotIn("DIRECTOR PROMPT — ${s.director_preset}", self.source)

    def test_frontend_fallback_library_and_mode_mapping_match_backend_contract(self):
        for director in DIRECTOR_PRESET_NAMES:
            self.assertIn(f'"{director}"', self.source)
        self.assertIn('"Image Edit": "Surgical Edit"', self.source)
        self.assertIn('"Image Edit Director": "Surgical Edit"', self.source)

    def test_delete_is_user_only_confirmed_and_resets_selection_safely(self):
        self.assertIn('const userDirector = activeDirectorPreset(node)?.source === "user";', self.source)
        self.assertIn("if (userDirector) {", self.source)
        self.assertIn('selectedPreset?.source !== "user" || selectedPreset?.protected !== false', self.source)
        self.assertIn("globalThis.confirm", self.source)
        self.assertIn('method: "DELETE"', self.source)
        refresh = self.source.index("await refreshDirectorPresets(node, true);", self.source.index("async function deleteSelectedDirector"))
        recommendation = self.source.index("const recommended = legacyPresetForMode", refresh)
        fallback = self.source.index("DEFAULT_DIRECTOR_PRESET", recommendation)
        selection = self.source.index('setValue(node, "director_preset", fallback);', fallback)
        clear_override = self.source.index('setValue(node, "system_prompt_override", "", false);', selection)
        self.assertLess(refresh, recommendation)
        self.assertLess(recommendation, fallback)
        self.assertLess(fallback, selection)
        self.assertLess(selection, clear_override)

    def test_queue_execution_reuses_ui_result_without_inference_or_stale_invalidation(self):
        self.assertIn("function promptFromExecution(message)", self.source)
        self.assertIn("const executed = nodeType.prototype.onExecuted;", self.source)
        self.assertIn("nodeType.prototype.onExecuted = function (message)", self.source)
        self.assertIn('setValue(this, "generated_prompt", queuePrompt, false);', self.source)
        callback_start = self.source.index("nodeType.prototype.onExecuted = function (message)")
        callback_end = self.source.index("const serialize = nodeType.prototype.serialize;", callback_start)
        callback = self.source[callback_start:callback_end]
        self.assertNotIn("api.fetchApi", callback)
        self.assertNotIn("generate(", callback)
        self.assertNotIn(".trim()", callback)
        self.assertIn("data.widgets_values = WIDGET_NAMES.map", self.source)
        self.assertIn('setValue(node, field, nextValue, field !== "generated_prompt");', self.source)

    def test_reference_map_and_lock_stay_in_advanced_and_preserve_queue_sync(self):
        for text in (
            'const REFERENCE_SOURCES = ["Auto", "Image 1", "Image 2", "Blend"]',
            'const REFERENCE_SOURCE_LABELS = { Auto: "AUTO", "Image 1": "IMG 1", "Image 2": "IMG 2", Blend: "BLEND" }',
            '"reference_subject_source", "Subject"',
            '"reference_face_source", "Face / Identity"',
            '"reference_scene_source", "Scene / Env."',
            '"reference_materials_source", "Materials"',
            'drawText(ctx, "REFERENCE MAP"',
            '"AUTO RESOLVED BEFORE GENERATION"',
            'label: "LOCK GENERATED PROMPT"',
            '"2 REFERENCES GROUNDED AT QUEUE"',
            'image1.label = "IMAGE 1"',
            'image2.label = "IMAGE 2"',
            'if (payload.lock_generated_prompt)',
            'Generated Prompt is locked but empty. Generate or enter a prompt before queueing.',
        ):
            self.assertIn(text, self.source)
        advanced_start = self.source.index("if (open) {")
        advanced_end = self.source.index("y += advanced.h", advanced_start)
        advanced = self.source[advanced_start:advanced_end]
        self.assertIn('field: "lock_generated_prompt"', advanced)
        self.assertIn('REFERENCE_MAP_FIELDS.forEach', advanced)
        self.assertIn('REFERENCE_SOURCES.map((source, sourceIndex)', advanced)
        self.assertIn('hit("referenceSource", segment, field);', advanced)
        self.assertNotIn('label: `${label} ROLE`', self.source)
        self.assertNotIn('"①"', self.source)
        self.assertNotIn('"②"', self.source)
        self.assertIn('setValue(node, "image_1_role", "Auto", false);', self.source)
        self.assertIn('setValue(node, "image_2_role", "Auto", false);', self.source)
        generate_start = self.source.index("async function generate(node)")
        generate_end = self.source.index("function handleClick", generate_start)
        generate = self.source[generate_start:generate_end]
        lock_guard = generate.index("if (payload.lock_generated_prompt)")
        self.assertLess(lock_guard, generate.index("api.fetchApi"))
        callback_start = self.source.index("nodeType.prototype.onExecuted = function (message)")
        callback_end = self.source.index("const serialize = nodeType.prototype.serialize;", callback_start)
        callback = self.source[callback_start:callback_end]
        self.assertIn('!Boolean(value(this, "lock_generated_prompt", false))', callback)
        self.assertIn("Locked Generated Prompt returned unchanged", callback)

    def test_reference_map_segmented_sources_preserve_values_and_disable_unavailable_images(self):
        for text in (
            'source === "Image 1" && !hasImage1',
            'source === "Image 2" && !hasImage2',
            'source === "Blend" && !(hasImage1 && hasImage2)',
            'segment.value === source',
            'activeFill(palette, 0.88)',
            'hit.kind === "referenceSource"',
            'if (hit.disabled) return true;',
            'setValue(node, hit.field, hit.value);',
        ):
            self.assertIn(text, self.source)
        handler_start = self.source.index('hit.kind === "referenceSource"')
        handler_end = self.source.index('} else if (hit.kind === "choice")', handler_start)
        handler = self.source[handler_start:handler_end]
        self.assertNotIn("choiceMenu", handler)
        self.assertNotIn("REFERENCE_SOURCE_LABELS[segment.value] ||", self.source)

    def test_unload_model_is_an_explicit_action_without_auto_unload_ui(self):
        self.assertEqual(UNLOAD_ROUTE_PATH, "/koo/prompt-director/v1/unload")
        for text in (
            'const UNLOAD_ROUTE = "/koo/prompt-director/v1/unload";',
            'hit("unloadModel", unloadModel);',
            '"Unload Model"',
            'async function unloadModel(node)',
            'api.fetchApi(UNLOAD_ROUTE, {',
            '"Model unloaded — selection preserved"',
        ):
            self.assertIn(text, self.source)
        unload_start = self.source.index("async function unloadModel(node)")
        unload_end = self.source.index("async function generate(node)", unload_start)
        unload = self.source[unload_start:unload_end]
        self.assertNotIn("setValue(", unload)
        self.assertNotIn("director_keep_model_loaded", unload)
        self.assertNotIn("Auto Unload", self.source)

    def test_generate_button_uses_a_reference_free_text_only_payload(self):
        self.assertEqual(TEXT_ROUTE_PATH, "/koo/prompt-director/v1/generate-text")
        self.assertIn('const TEXT_ROUTE = "/koo/prompt-director/v1/generate-text";', self.source)
        self.assertIn("function textOnlyPayload(current)", self.source)
        generate_start = self.source.index("async function generate(node)")
        generate_end = self.source.index("function handleClick", generate_start)
        generate = self.source[generate_start:generate_end]
        self.assertIn("api.fetchApi(TEXT_ROUTE", generate)
        self.assertIn("JSON.stringify(textOnlyPayload(payload))", generate)
        self.assertIn('setStatus(node, "error", "Enter a text prompt first.");', generate)

        payload_start = self.source.index("function textOnlyPayload(current)")
        payload_end = self.source.index("\n}\n", payload_start) + 3
        payload = self.source[payload_start:payload_end]
        for forbidden in (
            "image:", "image_2:", "reference_", "image_1_role", "image_2_role",
            "preserve_", "generated_prompt", "lock_generated_prompt",
        ):
            self.assertNotIn(forbidden, payload)

    def test_new_widgets_are_appended_after_legacy_director_preset(self):
        widget_start = self.source.index("const WIDGET_NAMES = [")
        widget_end = self.source.index("];", widget_start)
        widgets = self.source[widget_start:widget_end]
        preset = widgets.index('"director_preset"')
        self.assertLess(preset, widgets.index('"image_1_role"'))
        self.assertLess(preset, widgets.index('"image_2_role"'))
        self.assertLess(preset, widgets.index('"lock_generated_prompt"'))
        self.assertLess(widgets.index('"lock_generated_prompt"'), widgets.index('...REFERENCE_MAP_FIELDS.map'))
        for attribute, _label in REFERENCE_ATTRIBUTES:
            self.assertIn(f'"reference_{attribute}_source"', self.source)
        self.assertIn('values.length <= directorPresetIndex', self.source)


class BackendTests(unittest.TestCase):
    def test_mock_backend_generation(self):
        result = PromptDirectorService(config={"backend": "mock"}).generate(
            PromptDirectorRequest(idea="warm luxury bedroom wood", mode="Archviz")
        )
        self.assertEqual(result.backend_name, "mock")
        self.assertEqual(result.prompt, "[Mock Prompt Director] warm luxury bedroom wood")
        self.assertIn("Archviz mode", result.instruction.system_message)

    def test_text_only_generation_works_without_images(self):
        result = PromptDirectorService(config={"backend": "mock"}).generate_text_only(
            PromptDirectorRequest(idea="refine this product photograph", mode="Product")
        )
        self.assertIn("refine this product photograph", result.prompt)
        self.assertIsNone(result.instruction.image)
        self.assertIsNone(result.instruction.image_2)
        self.assertIsNone(result.instruction.reference_map)

    def test_text_only_generation_strips_images_preserve_and_reference_map(self):
        first = EncodedImage("image/png", "ZmFrZQ==", 64, 64)
        second = EncodedImage("image/png", "c2Vjb25k", 64, 64)
        request = PromptDirectorRequest(
            idea="make the concept cinematic",
            image=first,
            image_2=second,
            image_1_role="Subject",
            image_2_role="Scene",
            reference_map={
                "subject": "Image 1",
                "scene": "Image 2",
                "colors": "Blend",
            },
            preserve_subject=True,
            preserve_composition=True,
            preserve_camera=True,
            preserve_materials=True,
            preserve_lighting=True,
            preserve_colors=True,
        )
        result = PromptDirectorService(config={"backend": "mock"}).generate_text_only(request)
        instruction = result.instruction
        self.assertIsNone(instruction.image)
        self.assertIsNone(instruction.image_2)
        self.assertIsNone(instruction.reference_map)
        self.assertNotIn("REFERENCE SOURCE MAP", instruction.system_message)
        self.assertNotIn("Reference Map", instruction.system_message)
        self.assertNotIn("Image 1", instruction.system_message)
        self.assertNotIn("Image 2", instruction.system_message)
        self.assertIn("None beyond the selected mode", instruction.system_message)

    def test_text_only_generation_ignores_stale_or_missing_reference_assignments(self):
        request = PromptDirectorRequest(
            idea="rewrite this as a clear visual prompt",
            reference_map={"subject": "Image 1", "materials": "Blend"},
            image_1_role="Subject",
            image_2_role="Style",
        )
        result = PromptDirectorService(config={"backend": "mock"}).generate_text_only(request)
        self.assertIn("rewrite this as a clear visual prompt", result.prompt)
        self.assertIsNone(result.instruction.reference_map)

    def test_text_only_generation_empty_input_has_clean_error_before_backend_setup(self):
        with self.assertRaisesRegex(ValueError, r"^Enter a text prompt first\.$"):
            PromptDirectorService(config={}).generate_text_only(
                PromptDirectorRequest(idea="   ", reference_map={"subject": "Image 1"})
            )

    def test_full_generation_keeps_reference_map_validation(self):
        with self.assertRaisesRegex(
            ValueError,
            "Reference Map assigns Subject to Image 1, but Image 1 is not connected",
        ):
            PromptDirectorService(config={"backend": "mock"}).generate(
                PromptDirectorRequest(
                    idea="full queue request",
                    reference_map={"subject": "Image 1"},
                )
            )

    def test_missing_backend_auto_resolves_or_has_useful_error(self):
        # Keep this backend-absent test independent of the developer's real models/server.
        with tempfile.TemporaryDirectory() as empty_models, patch.dict(os.environ, {"KOO_COMFYUI_MODELS_DIR": empty_models}), patch("subprocess.Popen", side_effect=AssertionError("No real inference in unit tests")):
            with self.assertRaisesRegex(BackendConfigurationError, "llama_server executable was not found|Prompt Model Qwen 3.5 9B is unavailable"):
                PromptDirectorService(config={}).generate(PromptDirectorRequest(idea="test"))

    def test_openai_compatible_request_contract(self):
        captured = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps({"choices": [{"message": {"content": "final visual prompt"}}]}).encode()

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = dict(request.header_items())
            captured["payload"] = json.loads(request.data.decode())
            captured["timeout"] = timeout
            return FakeResponse()

        backend = OpenAICompatibleBackend(
            {"base_url": "http://127.0.0.1:1234/v1", "model": "local-model", "api_key": "secret", "temperature": 0.4, "timeout": 12}
        )
        instruction = assemble_instruction(PromptDirectorRequest(idea="product on stone"))
        with patch(f"{PACKAGE_NAME}.backends.openai_compatible.urlopen", fake_urlopen):
            result = backend.generate(instruction)

        self.assertEqual(result, "final visual prompt")
        self.assertEqual(captured["url"], "http://127.0.0.1:1234/v1/chat/completions")
        self.assertEqual(captured["payload"]["model"], "local-model")
        self.assertEqual(captured["payload"]["max_tokens"], 768)
        self.assertEqual([message["role"] for message in captured["payload"]["messages"]], ["system", "user"])
        self.assertEqual(captured["headers"]["Authorization"], "Bearer secret")
        self.assertEqual(captured["timeout"], 12.0)

    def test_multimodal_openai_payload(self):
        captured = {}

        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self): return b'{"choices":[{"message":{"content":"grounded prompt"}}]}'

        def fake_urlopen(request, timeout):
            captured["payload"] = json.loads(request.data.decode())
            return FakeResponse()

        instruction = assemble_instruction(
            PromptDirectorRequest(
                idea="preserve the room, change only the curtains",
                mode="Image Edit",
                image=EncodedImage("cG5n", "image/png", 320, 240),
            )
        )
        backend = OpenAICompatibleBackend({"base_url": "http://127.0.0.1:1234/v1", "model": "vlm"})
        with patch(f"{PACKAGE_NAME}.backends.openai_compatible.urlopen", fake_urlopen):
            self.assertEqual(backend.generate(instruction), "grounded prompt")

        content = captured["payload"]["messages"][1]["content"]
        self.assertEqual([part["type"] for part in content], ["text", "image_url"])
        self.assertIn("USER REQUESTED CHANGES", content[0]["text"])
        self.assertIn("IMAGE 1 — REFERENCE", content[0]["text"])
        self.assertEqual(content[1]["image_url"]["url"], "data:image/png;base64,cG5n")

    def test_two_images_share_one_openai_compatible_inference(self):
        captured = []

        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self): return b'{"choices":[{"message":{"content":"combined prompt"}}]}'

        def fake_urlopen(request, timeout):
            captured.append(json.loads(request.data.decode()))
            return FakeResponse()

        instruction = assemble_instruction(PromptDirectorRequest(
            idea="place her naturally in this room",
            director_preset="Reference Composer",
            image=EncodedImage("b25l", "image/png", 320, 240),
            image_2=EncodedImage("dHdv", "image/png", 640, 480),
            image_1_role="Subject",
            image_2_role="Scene",
        ))
        backend = OpenAICompatibleBackend({"base_url": "http://127.0.0.1:1234/v1", "model": "vlm"})
        request_trace = StringIO()
        with patch.dict(os.environ, {"KOO_PROMPT_DIRECTOR_DEBUG_PROMPTS": "1"}), redirect_stdout(request_trace):
            with patch(f"{PACKAGE_NAME}.backends.openai_compatible.urlopen", fake_urlopen):
                self.assertEqual(backend.generate(instruction), "combined prompt")

        self.assertEqual(len(captured), 1)
        content = captured[0]["messages"][1]["content"]
        self.assertEqual([part["type"] for part in content], ["text", "image_url", "text", "image_url"])
        self.assertIn("IMAGE 1 — REFERENCE", content[0]["text"])
        self.assertEqual(content[1]["image_url"]["url"], "data:image/png;base64,b25l")
        self.assertIn("IMAGE 2 — REFERENCE", content[2]["text"])
        self.assertEqual(content[3]["image_url"]["url"], "data:image/png;base64,dHdv")
        diagnostics = request_trace.getvalue()
        self.assertIn("[KoO FINAL LLM REQUEST]", diagnostics)
        self.assertIn("MESSAGE 1 ROLE=SYSTEM", diagnostics)
        self.assertIn("MESSAGE 2 ROLE=USER", diagnostics)
        self.assertIn("IMAGE PART 2: data:image/png;base64,<redacted> sha256=", diagnostics)
        self.assertIn("IMAGE PART 4: data:image/png;base64,<redacted> sha256=", diagnostics)

    def test_request_diagnostics_hash_content_without_dumping_prompts(self):
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self): return b'{"choices":[{"message":{"content":"diagnostic result"}}]}'

        instruction = replace(
            assemble_instruction(PromptDirectorRequest(
                idea="private diagnostic fixture",
                director_preset="Reverse Engineer",
                prompt_length="Medium",
            )),
            diagnostic_stage="final",
            diagnostic_context={
                "model": "Qwen 3.5 9B",
                "preset": "Reverse Engineer",
                "length": "Medium",
                "target": "Generic",
                "creativity": "Balanced",
                "director_override": False,
                "workflow_rules": False,
                "image_references": 0,
                "evidence_sha256": "NONE",
            },
        )
        backend = OpenAICompatibleBackend({
            "base_url": "http://127.0.0.1:1234/v1",
            "model": "vlm",
            "temperature": 0.3,
            "max_tokens": 768,
            "_runtime_diagnostics": {
                "model": "Qwen 3.5 9B",
                "gguf": "C:/models/qwen.gguf",
                "mmproj": "C:/models/mmproj.gguf",
                "pid": 4242,
                "port": 8189,
                "reused": True,
                "restarted": False,
            },
        })
        trace = StringIO()
        with patch.dict(os.environ, {"KOO_PROMPT_DIRECTOR_DEBUG_PROMPTS": ""}), redirect_stdout(trace):
            with patch(f"{PACKAGE_NAME}.backends.openai_compatible.urlopen", return_value=FakeResponse()):
                self.assertEqual(backend.generate(instruction), "diagnostic result")
        output = trace.getvalue()
        self.assertIn("[KoO Diagnostic] stage=final model=Qwen 3.5 9B", output)
        self.assertIn("pid=4242 port=8189 reused=true restarted=false", output)
        self.assertIn("temperature=0.3 top_p=NOT_SENT(server_default)", output)
        self.assertIn("repeat_penalty=NOT_SENT(server_default) max_tokens=768", output)
        self.assertIn("preset=Reverse Engineer length=Medium target=Generic creativity=Balanced", output)
        self.assertIn("system_sha256=", output)
        self.assertIn("user_sha256=", output)
        self.assertIn("evidence_sha256=NONE request_sha256=", output)
        self.assertIn("output_sha256=", output)
        self.assertNotIn("private diagnostic fixture", output)
        self.assertNotIn("[KoO FINAL LLM REQUEST]", output)

    def test_backend_without_vision_rejects_image(self):
        with self.assertRaisesRegex(BackendCapabilityError, "does not support vision"):
            PromptDirectorService(config={"backend": "mock"}).generate(
                PromptDirectorRequest(
                    idea="describe it",
                    image=EncodedImage("cG5n", "image/png", 32, 32),
                )
            )

    def test_backend_without_vision_rejects_image_two(self):
        with self.assertRaisesRegex(BackendCapabilityError, "does not support vision"):
            PromptDirectorService(config={"backend": "mock"}).generate(
                PromptDirectorRequest(
                    idea="describe it",
                    image_2=EncodedImage("cG5n", "image/png", 32, 32),
                )
            )

    def test_mock_loading_does_not_require_llama_server(self):
        with patch.dict(os.environ, {"PATH": ""}):
            result = PromptDirectorService(config={"backend": "mock"}).generate(
                PromptDirectorRequest(idea="text only")
            )
        self.assertEqual(result.backend_name, "mock")


class StagedEvidencePipelineTests(unittest.TestCase):
    @staticmethod
    def _evidence(**overrides):
        values = {
            "subject": "woman",
            "face": "visible adult face",
            "outfit": "simple clothing",
            "pose": "standing",
            "composition": "centered medium shot",
            "camera": "eye-level viewpoint",
            "scene": "outdoor setting",
            "lighting": "natural daylight",
            "colors": "neutral palette",
            "mood": "naturalistic",
            "materials": "ordinary fabric and natural surfaces",
        }
        values.update(overrides)
        return json.dumps(values)

    def test_two_image_evidence_is_isolated_resolved_and_compiled_without_raw_images(self):
        clear_evidence_cache()
        image_1 = EncodedImage("YmVkcm9vbS1pbWFnZQ==", "image/png", 768, 1024)
        image_2 = EncodedImage("YmVhY2gtaW1hZ2U=", "image/png", 1024, 768)
        image_1_json = self._evidence(
            subject="woman sitting",
            outfit="black bra and orange underwear",
            pose="seated pose",
            composition="woman centered in a vertical bedroom composition",
            scene="bedroom with a pink rug",
            lighting="soft indoor light",
            colors="pink, orange, and warm indoor tones",
            mood="intimate indoor mood",
            materials="fabric bedding and wooden floor",
        )
        image_2_json = self._evidence(
            subject="woman outdoors",
            outfit="loose white beach dress",
            pose="standing near the shore",
            composition="wide seaside view",
            scene="sandy beach beside the sea under open blue sky",
            lighting="bright coastal daylight",
            colors="blue sky, azure water, pale sand, and white clothing",
            mood="open, breezy seaside mood",
            materials="lightweight dress fabric and sand",
        )

        class FakeVisionBackend(PromptDirectorBackend):
            name = "fake_vision"
            supports_vision = True

            def __init__(self):
                self.calls = []

            def generate(self, instruction):
                self.calls.append(instruction)
                if instruction.image is image_1:
                    return image_1_json
                if instruction.image is image_2:
                    return image_2_json
                return "compiled beach prompt"

        backend = FakeVisionBackend()
        config = {
            "backend": "openai_compatible",
            "openai_compatible": {"base_url": "http://127.0.0.1:1234/v1", "model": "test-vlm"},
        }
        request = PromptDirectorRequest(
            idea="compose these references faithfully",
            target_model="Krea 2",
            director_preset="Reverse Engineer",
            image=image_1,
            image_2=image_2,
            preserve_subject=True,
            preserve_composition=True,
            preserve_camera=True,
            reference_map={
                "subject": "Image 1",
                "outfit": "Image 2",
                "composition": "Image 1",
                "scene": "Image 2",
                "colors": "Image 2",
            },
        )

        trace = StringIO()
        try:
            with patch.dict(os.environ, {"KOO_PROMPT_DIRECTOR_DEBUG_PROMPTS": "1"}), patch(
                f"{PACKAGE_NAME}.core.create_backend", return_value=backend,
            ):
                with redirect_stdout(trace):
                    result = PromptDirectorService(config=config).generate(request)

            self.assertEqual(result.prompt, "compiled beach prompt")
            self.assertEqual(len(backend.calls), 3)
            first, second, compiler = backend.calls
            self.assertIs(first.image, image_1)
            self.assertIsNone(first.image_2)
            self.assertEqual(first.image_label, "Image 1")
            self.assertNotIn(image_2.data_url, str(first.to_messages()))
            self.assertIs(second.image, image_2)
            self.assertIsNone(second.image_2)
            self.assertEqual(second.image_label, "Image 2")
            self.assertNotIn(image_1.data_url, str(second.to_messages()))
            self.assertIsNone(compiler.image)
            self.assertIsNone(compiler.image_2)

            scene = result.instruction.resolved_scene
            self.assertEqual(scene.source_for("subject"), "Image 1")
            self.assertEqual(scene.value_for("subject"), "woman sitting")
            self.assertEqual(scene.source_for("outfit"), "Image 2")
            self.assertEqual(scene.value_for("outfit"), "loose white beach dress")
            self.assertEqual(scene.source_for("composition"), "Image 1")
            self.assertEqual(scene.value_for("composition"), "woman centered in a vertical bedroom composition")
            self.assertEqual(scene.source_for("scene"), "Image 2")
            self.assertIn("sandy beach", scene.value_for("scene"))
            self.assertEqual(scene.source_for("colors"), "Image 2")
            self.assertIn("azure water", scene.value_for("colors"))

            compiler_input = result.instruction.system_message
            self.assertIn("loose white beach dress", compiler_input)
            self.assertIn("sandy beach beside the sea", compiler_input)
            self.assertIn("blue sky, azure water", compiler_input)
            self.assertNotIn("black bra and orange underwear", compiler_input)
            self.assertNotIn("bedroom with a pink rug", compiler_input)
            self.assertIn("TARGET:\nKrea 2", compiler_input)

            diagnostics = trace.getvalue()
            for heading in (
                "[KoO IMAGE 1 EVIDENCE]",
                "[KoO IMAGE 2 EVIDENCE]",
                "[KoO RESOLVED SCENE]",
                "[KoO FINAL COMPILER INPUT]",
            ):
                self.assertIn(heading, diagnostics)

            backend.calls.clear()
            remapped = replace(request, reference_map={
                "subject": "Image 1",
                "outfit": "Image 1",
                "composition": "Image 1",
                "scene": "Image 2",
                "colors": "Image 2",
            })
            with patch(f"{PACKAGE_NAME}.core.create_backend", return_value=backend):
                PromptDirectorService(config=config).generate(remapped)
            self.assertEqual(len(backend.calls), 1)
            self.assertIsNone(backend.calls[0].image)
            self.assertIsNone(backend.calls[0].image_2)

            first_key = evidence_cache_key(image_1, "analysis-model-a")
            self.assertEqual(first_key[2], EVIDENCE_SCHEMA_VERSION)
            self.assertNotEqual(first_key, evidence_cache_key(image_1, "analysis-model-b"))
        finally:
            clear_evidence_cache()

    def test_blend_combines_only_the_assigned_attribute_evidence(self):
        first = parse_image_evidence(
            self._evidence(materials="rough oak and linen", scene="bedroom"),
            "first-hash",
        )
        second = parse_image_evidence(
            self._evidence(materials="polished stone and glass", scene="beach"),
            "second-hash",
        )
        resolved_map = resolve_reference_map(PromptDirectorRequest(
            idea="compose these references faithfully",
            image=object(),
            image_2=object(),
            reference_map={"materials": "Blend", "scene": "Image 2"},
        ), "Reference Composer")
        scene = build_resolved_scene(resolved_map, first, second, "compose these references faithfully")
        self.assertIn("Image 1 evidence: rough oak and linen", scene.value_for("materials"))
        self.assertIn("Image 2 evidence: polished stone and glass", scene.value_for("materials"))
        self.assertEqual(scene.value_for("scene"), "beach")
        self.assertNotIn("bedroom", scene.value_for("scene"))


class ImageEncodingTests(unittest.TestCase):
    def test_image_tensor_conversion_preserves_aspect_ratio(self):
        import torch
        from PIL import Image

        tensor = torch.linspace(0, 1, 1 * 300 * 600 * 3).reshape(1, 300, 600, 3)
        encoded = encode_comfy_image(tensor, max_dimension=256)
        self.assertEqual((encoded.width, encoded.height), (256, 128))
        self.assertEqual(encoded.media_type, "image/png")
        decoded = Image.open(BytesIO(base64.b64decode(encoded.data)))
        self.assertEqual(decoded.size, (256, 128))
        self.assertEqual(decoded.mode, "RGB")


class LlamaCppConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.model = self.root / "Qwen3.5-9B-Q4_K_M.gguf"
        self.mmproj = self.root / "mmproj-Qwen3.5-9B-BF16.gguf"
        self.server = self.root / "llama-server.exe"
        for path in (self.model, self.mmproj, self.server):
            path.write_bytes(b"test")

    def tearDown(self):
        self.tempdir.cleanup()

    def settings(self, **overrides):
        values = {
            "models_dir": str(self.root),
            "model_path": self.model.name,
            "mmproj_path": self.mmproj.name,
            "llama_server": str(self.server),
            "port": 18189,
            "context_size": 8192,
            "gpu_layers": "auto",
            "keep_model_loaded": False,
            "requested_model": PROMPT_MODEL_QWEN,
        }
        values.update(overrides)
        return values

    def test_duplicate_package_imports_share_one_process_wide_manager(self):
        alias = "koo_visual_prompt_director_duplicate_import"
        package_dir = Path(__file__).resolve().parents[1] / "nodes" / "visual_prompt_director"
        spec = importlib.util.spec_from_file_location(
            alias,
            package_dir / "__init__.py",
            submodule_search_locations=[str(package_dir)],
        )
        duplicate = importlib.util.module_from_spec(spec)
        sys.modules[alias] = duplicate
        try:
            spec.loader.exec_module(duplicate)
            duplicate_manager = sys.modules[
                f"{alias}.backends.llama_cpp_process"
            ].get_process_manager()
            self.assertIs(duplicate_manager, get_process_manager())
        finally:
            for module_name in list(sys.modules):
                if module_name == alias or module_name.startswith(f"{alias}."):
                    sys.modules.pop(module_name, None)

    def test_generate_and_run_paths_reuse_one_shared_pid_in_every_order(self):
        class FakeProcess:
            pid = 4701
            returncode = None
            def poll(self): return self.returncode
            def terminate(self): self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = get_process_manager()
        manager.cleanup_all()
        try:
            for sequence in (
                ("GENERATE", "GENERATE"),
                ("GENERATE", "RUN"),
                ("RUN", "GENERATE"),
                ("RUN", "RUN"),
            ):
                with self.subTest(sequence=sequence):
                    manager.cleanup_all()
                    process = FakeProcess()
                    process.returncode = None
                    backends = {
                        "GENERATE": LocalLlamaCppBackend(self.settings()),
                        "RUN": LocalLlamaCppBackend(self.settings()),
                    }
                    self.assertIs(backends["GENERATE"].process_manager, manager)
                    self.assertIs(backends["RUN"].process_manager, manager)
                    observed_pids = []
                    with patch.object(manager, "_port_available", return_value=True), patch.object(
                        manager, "_start_process", return_value=process,
                    ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
                        for path in sequence:
                            with backends[path].generation_session():
                                observed_pids.append(manager._owned.process.pid)
                    self.assertEqual(observed_pids, [4701, 4701])
                    self.assertEqual(start.call_count, 1)
                    self.assertEqual(manager.owned_process_count, 1)
        finally:
            manager.cleanup_all()

    def test_manual_unload_after_either_path_clears_shared_state_and_next_request_restarts(self):
        class FakeProcess:
            def __init__(self, pid):
                self.pid = pid
                self.returncode = None
                self.terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = get_process_manager()
        manager.cleanup_all()
        try:
            for origin in ("GENERATE", "RUN"):
                with self.subTest(origin=origin):
                    manager.cleanup_all()
                    first = FakeProcess(4801)
                    second = FakeProcess(4802)
                    backend = LocalLlamaCppBackend(self.settings())
                    with patch.object(manager, "_port_available", return_value=True), patch.object(
                        manager, "_start_process", side_effect=[first, second],
                    ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
                        with backend.generation_session():
                            self.assertEqual(manager._owned.process.pid, 4801)
                        self.assertEqual(manager.request_unload(), "unloaded")
                        self.assertTrue(first.terminated)
                        self.assertEqual(manager.owned_process_count, 0)
                        with backend.generation_session():
                            self.assertEqual(manager._owned.process.pid, 4802)
                    self.assertEqual(start.call_count, 2)
        finally:
            manager.cleanup_all()

    def test_final_enhance_passes_share_one_session_and_pending_unload_waits_for_both(self):
        class FakeProcess:
            pid = 4901
            returncode = None
            terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = get_process_manager()
        manager.cleanup_all()
        process = FakeProcess()
        backend = LocalLlamaCppBackend(self.settings())
        try:
            with patch.object(manager, "_port_available", return_value=True), patch.object(
                manager, "_start_process", return_value=process,
            ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
                with backend.generation_session() as client:
                    pass_1 = (manager._owned.process.pid, id(client))
                    self.assertEqual(manager.request_unload(), "pending")
                    pass_2 = (manager._owned.process.pid, id(client))
                    self.assertFalse(process.terminated)
                self.assertEqual(pass_1, pass_2)
                self.assertTrue(process.terminated)
                self.assertEqual(manager.owned_process_count, 0)
                self.assertEqual(start.call_count, 1)
        finally:
            manager.cleanup_all()

    def test_dead_owned_process_is_cleared_and_restarted(self):
        class FakeProcess:
            def __init__(self, pid):
                self.pid = pid
                self.returncode = None
            def poll(self): return self.returncode
            def terminate(self): self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = LlamaCppProcessManager()
        config = LlamaCppLaunchConfig.from_mapping(self.settings())
        first = FakeProcess(5001)
        second = FakeProcess(5002)
        terminal = StringIO()
        with redirect_stdout(terminal), patch.object(manager, "_port_available", return_value=True), patch.object(
            manager, "_start_process", side_effect=[first, second],
        ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
            initial = manager.acquire(config)
            manager.release(initial)
            first.returncode = 7
            restarted = manager.acquire(config)
        self.assertEqual(start.call_count, 2)
        self.assertEqual(restarted.process.pid, 5002)
        self.assertIn("Owned process died; clearing stale state", terminal.getvalue())
        manager.release(restarted)
        manager.cleanup_all()

    def test_pair_and_command_validation(self):
        config = LlamaCppLaunchConfig.from_mapping(self.settings())
        command = config.command()
        self.assertEqual(config.model_path, self.model.resolve())
        self.assertEqual(config.mmproj_path, self.mmproj.resolve())
        self.assertIn("--model", command)
        self.assertIn("--mmproj", command)
        self.assertIn("--image-min-tokens", command)
        self.assertIn("--reasoning", command)
        self.assertEqual(config.reasoning, "off")
        self.assertEqual(config.image_min_tokens, 1024)
        self.assertEqual(config.max_tokens, 768)
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.requested_model, PROMPT_MODEL_QWEN)
        self.assertTrue(config.keep_model_loaded)

    def test_installer_runtime_path_resolves_relative_to_comfyui_root(self):
        relative = Path("tools") / "KoO" / "llama.cpp" / "current" / "llama-server.exe"
        installed_server = self.root / relative
        installed_server.parent.mkdir(parents=True)
        installed_server.write_bytes(b"runtime")
        config = LlamaCppLaunchConfig.from_mapping(self.settings(llama_server=str(relative), runtime_root=str(self.root)))
        self.assertEqual(config.executable, installed_server.resolve())

    def test_comfyui_user_config_takes_precedence_when_present(self):
        user_root = self.root / "user"
        user_config = user_root / "KoO" / "visual_prompt_director" / "config.json"
        user_config.parent.mkdir(parents=True)
        user_config.write_text("{}", encoding="utf-8")
        fake_folder_paths = SimpleNamespace(get_user_directory=lambda: str(user_root))
        with patch.dict(sys.modules, {"folder_paths": fake_folder_paths}), patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KOO_PROMPT_DIRECTOR_CONFIG", None)
            self.assertEqual(resolve_config_path(), user_config)

    def test_start_process_logs_resolved_model_projector_and_command(self):
        config = LlamaCppLaunchConfig.from_mapping(self.settings())
        process = SimpleNamespace(pid=4301)
        terminal = StringIO()
        manager = LlamaCppProcessManager()
        with redirect_stdout(terminal), patch(
            f"{PACKAGE_NAME}.backends.llama_cpp_process.subprocess.Popen",
            return_value=process,
        ) as popen:
            self.assertIs(manager._start_process(config), process)

        output = terminal.getvalue()
        self.assertIn("[KoO Prompter] Starting llama-server", output)
        self.assertIn(f"[KoO Prompter] Model: {self.model.resolve()}", output)
        self.assertIn(f"[KoO Prompter] mmproj: {self.mmproj.resolve()}", output)
        self.assertIn("[KoO Prompter] Command:", output)
        self.assertIn(str(self.model.resolve()), output)
        self.assertIn(str(self.mmproj.resolve()), output)
        self.assertEqual(popen.call_args.args[0], config.command())

    def test_missing_model_or_mmproj_is_clear(self):
        with self.assertRaisesRegex(BackendConfigurationError, "model_path does not exist"):
            LlamaCppLaunchConfig.from_mapping(self.settings(model_path="missing.gguf"))
        with self.assertRaisesRegex(BackendConfigurationError, "mmproj_path does not exist"):
            LlamaCppLaunchConfig.from_mapping(self.settings(mmproj_path="missing-mmproj.gguf"))

    def test_projector_name_and_pair_folder_are_guarded(self):
        bad_projector = self.root / "projector.gguf"
        bad_projector.write_bytes(b"test")
        with self.assertRaisesRegex(BackendConfigurationError, "must contain 'mmproj'"):
            LlamaCppLaunchConfig.from_mapping(self.settings(mmproj_path=bad_projector.name))
        other = self.root / "other"
        other.mkdir()
        other_projector = other / "mmproj-Qwen3.5-9B-BF16.gguf"
        other_projector.write_bytes(b"test")
        with self.assertRaisesRegex(BackendConfigurationError, "same model folder"):
            LlamaCppLaunchConfig.from_mapping(self.settings(mmproj_path=str(other_projector)))

    def test_localhost_only(self):
        with self.assertRaisesRegex(BackendConfigurationError, "loopback"):
            LlamaCppLaunchConfig.from_mapping(self.settings(host="0.0.0.0"))

    def test_normal_release_keeps_server_loaded_until_cleanup(self):
        class FakeProcess:
            def __init__(self):
                self.returncode = None
                self.terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = LlamaCppProcessManager()
        config = LlamaCppLaunchConfig.from_mapping(self.settings())
        first = FakeProcess()
        with patch.object(manager, "_port_available", return_value=True), patch.object(manager, "_start_process", return_value=first), patch.object(manager, "_wait_until_ready", return_value=None):
            owned = manager.acquire(config)
        self.assertEqual(manager.owned_process_count, 1)
        manager.release(owned)
        self.assertFalse(first.terminated)
        self.assertEqual(manager.owned_process_count, 1)
        unowned = FakeProcess()
        manager.cleanup_all()
        self.assertTrue(first.terminated)
        self.assertFalse(unowned.terminated)
        self.assertEqual(manager.owned_process_count, 0)

    def test_manual_unload_stops_idle_server_and_restart_uses_same_selection(self):
        class FakeProcess:
            def __init__(self, pid):
                self.pid = pid
                self.returncode = None
                self.terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = LlamaCppProcessManager()
        config = LlamaCppLaunchConfig.from_mapping(self.settings(keep_model_loaded=False))
        first = FakeProcess(4401)
        second = FakeProcess(4402)
        with patch.object(manager, "_port_available", return_value=True), patch.object(
            manager, "_start_process", side_effect=[first, second]
        ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
            initial = manager.acquire(config)
            manager.release(initial)
            self.assertEqual(manager.request_unload(), "unloaded")
            self.assertTrue(first.terminated)
            self.assertEqual(manager.owned_process_count, 0)

            restarted = manager.acquire(config)
            manager.release(restarted)

        self.assertEqual(start.call_count, 2)
        self.assertIs(restarted.config, config)
        self.assertEqual(restarted.config.requested_model, PROMPT_MODEL_QWEN)
        self.assertFalse(second.terminated)
        manager.cleanup_all()

    def test_manual_unload_is_safe_when_no_server_is_loaded(self):
        manager = LlamaCppProcessManager()
        self.assertEqual(manager.request_unload(), "idle")
        self.assertEqual(manager.owned_process_count, 0)

    def test_active_unload_waits_until_complete_operation_release(self):
        events = []

        class FakeProcess:
            pid = 4501
            returncode = None
            def poll(self): return self.returncode
            def terminate(self): events.append("terminate"); self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = LlamaCppProcessManager()
        config = LlamaCppLaunchConfig.from_mapping(self.settings())
        process = FakeProcess()
        with patch.object(manager, "_port_available", return_value=True), patch.object(
            manager, "_start_process", return_value=process
        ), patch.object(manager, "_wait_until_ready", return_value=None):
            operation = manager.acquire(config)
            events.append("main-pass")
            self.assertEqual(manager.request_unload(), "pending")
            self.assertFalse(process.returncode is not None)
            events.append("final-enhance-pass")
            self.assertNotIn("terminate", events)
            manager.release(operation)

        self.assertEqual(events, ["main-pass", "final-enhance-pass", "terminate"])
        self.assertEqual(manager.owned_process_count, 0)

    def test_multiple_sequential_generations_reuse_one_server(self):
        class FakeProcess:
            pid = 4601
            returncode = None
            def poll(self): return self.returncode
            def terminate(self): self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = LlamaCppProcessManager()
        config = LlamaCppLaunchConfig.from_mapping(self.settings())
        process = FakeProcess()
        with patch.object(manager, "_port_available", return_value=True), patch.object(
            manager, "_start_process", return_value=process
        ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
            for _index in range(3):
                operation = manager.acquire(config)
                manager.release(operation)

        self.assertEqual(start.call_count, 1)
        self.assertFalse(process.returncode is not None)
        self.assertEqual(manager.owned_process_count, 1)
        manager.cleanup_all()

    def test_retained_server_is_replaced_when_profile_changes(self):
        class FakeProcess:
            def __init__(self, pid):
                self.pid = pid
                self.returncode = None
                self.terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        second_model = self.root / "Gemma3-12B-Q4_K_M.gguf"
        second_mmproj = self.root / "mmproj-Gemma3-12B-f16.gguf"
        second_model.write_bytes(b"model")
        second_mmproj.write_bytes(b"projector")
        first_config = LlamaCppLaunchConfig.from_mapping(self.settings(
            keep_model_loaded=True,
            model_path=second_model.name,
            mmproj_path=second_mmproj.name,
            requested_model=PROMPT_MODEL_GEMMA,
        ))
        second_config = LlamaCppLaunchConfig.from_mapping(self.settings(
            keep_model_loaded=True,
            requested_model=PROMPT_MODEL_QWEN,
        ))
        first = FakeProcess(4101)
        second = FakeProcess(4102)
        manager = LlamaCppProcessManager()
        terminal = StringIO()
        with redirect_stdout(terminal), patch.object(manager, "_port_available", return_value=True), patch.object(
            manager, "_start_process", side_effect=[first, second]
        ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
            retained = manager.acquire(first_config)
            manager.release(retained)
            replacement = manager.acquire(second_config)

        self.assertTrue(first.terminated)
        self.assertFalse(second.terminated)
        self.assertEqual(start.call_count, 2)
        self.assertEqual(replacement.config.model_path, self.model.resolve())
        self.assertEqual(manager.owned_process_count, 1)
        output = terminal.getvalue()
        for message in (
            f"[KoO Prompter] Requested model: {PROMPT_MODEL_QWEN}",
            f"[KoO Prompter] Requested GGUF: {self.model.resolve()}",
            f"[KoO Prompter] Requested mmproj: {self.mmproj.resolve()}",
            "[KoO Prompter] Existing llama-server PID: 4101",
            f"[KoO Prompter] Existing model: {PROMPT_MODEL_GEMMA}",
            "[KoO Prompter] MODEL CHANGE DETECTED",
            f"[KoO Prompter] Old model: {PROMPT_MODEL_GEMMA}",
            f"[KoO Prompter] New model: {PROMPT_MODEL_QWEN}",
            "[KoO Prompter] Stopping llama-server PID 4101",
            f"[KoO Prompter] Starting new model: {PROMPT_MODEL_QWEN}",
        ):
            self.assertIn(message, output)
        self.assertLess(output.index("Stopping llama-server PID 4101"), output.index("Starting new model"))
        manager.cleanup_all()

    def test_retained_server_restarts_when_runtime_critical_config_changes(self):
        class FakeProcess:
            def __init__(self, pid):
                self.pid = pid
                self.returncode = None
                self.terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = LlamaCppProcessManager()
        first_config = LlamaCppLaunchConfig.from_mapping(self.settings(context_size=8192))
        second_config = LlamaCppLaunchConfig.from_mapping(self.settings(context_size=16384))
        first = FakeProcess(4151)
        second = FakeProcess(4152)
        terminal = StringIO()
        with redirect_stdout(terminal), patch.object(manager, "_port_available", return_value=True), patch.object(
            manager, "_start_process", side_effect=[first, second],
        ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
            initial = manager.acquire(first_config)
            manager.release(initial)
            replacement = manager.acquire(second_config)

        self.assertTrue(first.terminated)
        self.assertFalse(second.terminated)
        self.assertEqual(start.call_count, 2)
        self.assertEqual(replacement.config.context_size, 16384)
        self.assertIn("Restarting owned llama-server: model/config changed", terminal.getvalue())
        manager.release(replacement)
        manager.cleanup_all()

    def test_same_retained_profile_reuses_owned_server(self):
        class FakeProcess:
            def __init__(self):
                self.pid = 4201
                self.returncode = None
                self.terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        config = LlamaCppLaunchConfig.from_mapping(self.settings(keep_model_loaded=True))
        process = FakeProcess()
        manager = LlamaCppProcessManager()
        terminal = StringIO()
        with redirect_stdout(terminal), patch.object(manager, "_port_available", return_value=True), patch.object(
            manager, "_start_process", return_value=process
        ) as start, patch.object(manager, "_wait_until_ready", return_value=None):
            first = manager.acquire(config)
            manager.release(first)
            second = manager.acquire(config)

        self.assertIs(first, second)
        self.assertEqual(start.call_count, 1)
        self.assertFalse(process.terminated)
        output = terminal.getvalue()
        self.assertIn("[KoO Prompter] Existing llama-server PID: 4201", output)
        self.assertIn("[KoO Prompter] Reusing existing llama-server", output)
        self.assertIn(f"[KoO Prompter] Active model: {PROMPT_MODEL_QWEN}", output)
        self.assertNotIn("MODEL CHANGE DETECTED", output)
        manager.release(second)
        manager.cleanup_all()

    def test_unrelated_occupied_preferred_port_uses_fallback_without_termination(self):
        class FakeProcess:
            pid = 5101
            returncode = None
            terminated = False
            def poll(self): return self.returncode
            def terminate(self): self.terminated = True; self.returncode = 0
            def wait(self, timeout=None): return self.returncode
            def kill(self): self.returncode = -9

        manager = LlamaCppProcessManager()
        process = FakeProcess()
        backend = LocalLlamaCppBackend(self.settings(keep_model_loaded=True), process_manager=manager)
        terminal = StringIO()
        with redirect_stdout(terminal), patch.object(
            manager, "_port_available", side_effect=lambda _host, port: port != 18189,
        ), patch.object(manager, "_start_process", return_value=process) as start, patch.object(
            manager, "_wait_until_ready", return_value=None,
        ), patch.object(manager, "_terminate", wraps=manager._terminate) as terminate:
            with backend.generation_session() as first_client:
                first_url = first_client.url
            with backend.generation_session() as second_client:
                second_url = second_client.url

        self.assertEqual(start.call_count, 1)
        runtime_config = start.call_args.args[0]
        self.assertEqual(runtime_config.port, 18190)
        self.assertIn(":18190/", first_url)
        self.assertEqual(first_url, second_url)
        terminate.assert_not_called()
        self.assertFalse(process.terminated)
        self.assertIn(
            "Preferred port 18189 occupied by unrelated process; using port 18190",
            terminal.getvalue(),
        )
        manager.cleanup_all()


class NodeTests(unittest.TestCase):
    def assertPromptResult(self, output, expected):
        self.assertEqual(output["result"], (expected,))
        self.assertEqual(output["ui"]["generated_prompt"], [expected])

    def test_cached_prompt_outputs_without_backend(self):
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate") as generate:
            output = KoOVisualPromptDirector().direct(
                "idea", "Enhance", "Generic", "Balanced", True, False, False, False,
                False, False, "Medium", "", "", "cached generated prompt",
            )
        self.assertPromptResult(output, "cached generated prompt")
        generate.assert_not_called()

    def test_node_registration_contract(self):
        from koo_visual_prompt_director_test.nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

        self.assertIs(NODE_CLASS_MAPPINGS["KoOVisualPromptDirector"], KoOVisualPromptDirector)
        self.assertEqual(NODE_DISPLAY_NAME_MAPPINGS["KoOVisualPromptDirector"], "KoO Visual Prompt Director")
        self.assertEqual(KoOVisualPromptDirector.CATEGORY, "KoO")
        self.assertEqual(KoOVisualPromptDirector.RETURN_TYPES, ("STRING",))
        self.assertEqual(KoOVisualPromptDirector.INPUT_TYPES()["optional"]["image"], ("IMAGE",))
        self.assertEqual(KoOVisualPromptDirector.INPUT_TYPES()["optional"]["image_2"], ("IMAGE",))
        required = KoOVisualPromptDirector.INPUT_TYPES()["required"]
        self.assertEqual(required["prompt_model"][0], PROMPT_MODEL_NAMES)
        self.assertEqual(required["prompt_model"][1]["default"], PROMPT_MODEL_QWEN)
        self.assertEqual(required["prompt_length"], (PROMPT_LENGTH_NAMES, {"default": "Medium"}))
        self.assertEqual(required["director_preset"][0], "STRING")
        self.assertEqual(required["director_preset"][1]["default"], DEFAULT_DIRECTOR_PRESET)
        self.assertEqual(required["image_1_role"], (REFERENCE_ROLE_NAMES, {"default": "Auto"}))
        self.assertEqual(required["image_2_role"], (REFERENCE_ROLE_NAMES, {"default": "Auto"}))
        self.assertEqual(required["lock_generated_prompt"], ("BOOLEAN", {"default": False}))
        for attribute, _label in REFERENCE_ATTRIBUTES:
            self.assertEqual(required[f"reference_{attribute}_source"], (REFERENCE_SOURCE_NAMES, {"default": "Auto"}))
        self.assertNotIn("director_ai", required)
        self.assertIn("target_model", required)

    def test_normal_queue_uses_full_service_with_images_and_reference_map(self):
        image_1 = object()
        image_2 = object()
        with patch(
            f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate",
            return_value=SimpleNamespace(prompt="full multimodal prompt"),
        ) as full_generate, patch(
            f"{PACKAGE_NAME}.core.PromptDirectorService.generate_text_only"
        ) as text_generate:
            output = KoOVisualPromptDirector().direct(
                "compose both references", "Enhance", "Generic", "Balanced",
                True, False, False, False, False, False,
                "Medium", "", "", "",
                image=image_1,
                image_2=image_2,
                reference_subject_source="Image 1",
                reference_scene_source="Image 2",
                reference_colors_source="Blend",
            )

        self.assertPromptResult(output, "full multimodal prompt")
        full_generate.assert_called_once()
        text_generate.assert_not_called()
        request = full_generate.call_args.args[0]
        self.assertIs(request.image, image_1)
        self.assertIs(request.image_2, image_2)
        self.assertEqual(request.reference_map["subject"], "Image 1")
        self.assertEqual(request.reference_map["scene"], "Image 2")
        self.assertEqual(request.reference_map["colors"], "Blend")

    def test_connected_image_ignores_cached_text_preview(self):
        fake_result = SimpleNamespace(prompt="vision-grounded prompt")
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate", return_value=fake_result) as generate:
            output = KoOVisualPromptDirector().direct(
                "change the curtains", "Image Edit", "Generic", "Balanced", True,
                True, True, True, True, True, "Medium", "", "",
                "cached text-only preview", image=object(),
            )
        self.assertPromptResult(output, "vision-grounded prompt")
        generate.assert_called_once()
        self.assertIsNotNone(generate.call_args.args[0].image)

    def test_two_connected_images_reach_one_generation_call(self):
        image_1 = object()
        image_2 = object()
        fake_result = SimpleNamespace(prompt="two-reference prompt")
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate", return_value=fake_result) as generate:
            output = KoOVisualPromptDirector().direct(
                "place her naturally in this room", "Enhance", "Generic", "Balanced", True,
                False, False, False, False, False, "Medium", "", "", "old preview",
                director_preset="Reference Composer",
                reference_subject_source="Image 1", reference_scene_source="Image 2",
                image=image_1, image_2=image_2,
            )
        self.assertPromptResult(output, "two-reference prompt")
        generate.assert_called_once()
        request = generate.call_args.args[0]
        self.assertIs(request.image, image_1)
        self.assertIs(request.image_2, image_2)
        self.assertEqual(request.reference_map["subject"], "Image 1")
        self.assertEqual(request.reference_map["scene"], "Image 2")

    def test_reported_reference_map_values_reach_python_request_unchanged(self):
        image_1 = object()
        image_2 = object()
        fake_result = SimpleNamespace(prompt="mapped prompt")
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate", return_value=fake_result) as generate:
            KoOVisualPromptDirector().direct(
                "compose these references faithfully", "Enhance", "Generic", "Balanced",
                True, True, True, False, False, False, "Medium", "", "", "",
                director_preset="Reference Composer",
                image=image_1,
                image_2=image_2,
                reference_subject_source="Image 1",
                reference_outfit_source="Image 2",
                reference_composition_source="Image 1",
                reference_scene_source="Image 2",
                reference_colors_source="Image 2",
            )

        request = generate.call_args.args[0]
        self.assertIs(request.image, image_1)
        self.assertIs(request.image_2, image_2)
        self.assertEqual(request.reference_map, {
            "subject": "Image 1",
            "face": "Auto",
            "outfit": "Image 2",
            "pose": "Auto",
            "composition": "Image 1",
            "camera": "Auto",
            "scene": "Image 2",
            "lighting": "Auto",
            "colors": "Image 2",
            "mood": "Auto",
            "materials": "Auto",
        })
        self.assertTrue(request.preserve_subject)
        self.assertTrue(request.preserve_composition)
        self.assertTrue(request.preserve_camera)

    def test_locked_prompt_bypasses_inference_and_preserves_exact_manual_text(self):
        exact = "  first line\nsecond line with trailing space  "
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService") as service:
            output = KoOVisualPromptDirector().direct(
                "ignored while locked", "Photography", "Generic", "Balanced", True,
                False, False, False, False, False, "Medium", "", "", exact,
                lock_generated_prompt=True, image=object(), image_2=object(),
            )
        self.assertPromptResult(output, exact)
        service.assert_not_called()

    def test_locked_empty_prompt_returns_actionable_error_without_inference(self):
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService") as service:
            with self.assertRaisesRegex(ValueError, "Generated Prompt is locked but empty. Generate or enter a prompt before queueing."):
                KoOVisualPromptDirector().direct(
                    "do not generate", "Enhance", "Generic", "Balanced", True,
                    False, False, False, False, False, "Medium", "", "", " \n ",
                    lock_generated_prompt=True, image=object(),
                )
        service.assert_not_called()

    def test_text_only_queue_result_is_identical_in_ui_and_downstream_output(self):
        exact_prompt = "First line of the queue result.\nSecond line remains exact."
        fake_result = SimpleNamespace(prompt=exact_prompt)
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate", return_value=fake_result) as generate:
            output = KoOVisualPromptDirector().direct(
                "new request", "Photography", "Generic", "Balanced", True,
                False, False, False, False, False, "Medium", "", "", "",
            )
        self.assertPromptResult(output, exact_prompt)
        generate.assert_called_once()

    def test_legacy_director_ai_keyword_is_still_accepted(self):
        fake_result = SimpleNamespace(prompt="legacy-compatible prompt")
        with patch(f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate", return_value=fake_result) as generate:
            output = KoOVisualPromptDirector().direct(
                "idea", "Enhance", "Generic", "Balanced", True, False, False, False,
                False, False, "Medium", "", "", "", director_ai="Gemma",
            )
        self.assertPromptResult(output, "legacy-compatible prompt")
        generate.assert_called_once()
        self.assertEqual(generate.call_args.args[0].selected_prompt_model, PROMPT_MODEL_GEMMA)
        self.assertEqual(generate.call_args.args[0].director_preset, "General Director")


class DirectorProfileTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.models_dir = Path(self.tempdir.name) / "models"
        self.llm_dir = self.models_dir / "LLM"
        self.llm_dir.mkdir(parents=True)

    def tearDown(self):
        self.tempdir.cleanup()

    @staticmethod
    def _touch_pair(folder, model_name, mmproj_name):
        folder.mkdir(parents=True, exist_ok=True)
        model = folder / model_name
        mmproj = folder / mmproj_name
        model.write_bytes(b"model")
        mmproj.write_bytes(b"projector")
        return model, mmproj

    def test_known_profiles_and_generic_custom_are_discovered(self):
        self._touch_pair(
            self.llm_dir / "Qwen3.5-9B",
            "Qwen3.5-9B-Q4_K_M.gguf",
            "mmproj-Qwen3.5-9B-BF16.gguf",
        )
        self._touch_pair(
            self.llm_dir / "Qwen3.5-9B-Uncensored",
            "Qwen3.5-9B-Uncensored-Q4_K_M.gguf",
            "Qwen3.5-9B-Uncensored-mmproj-f16.gguf",
        )
        self._touch_pair(
            self.llm_dir / "Qwen3.5-9B-Uncensored-HauhauCS-Aggressive",
            "Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf",
            "mmproj-Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16.gguf",
        )
        self._touch_pair(self.llm_dir / "Gemma3-12B", "gemma-3-12b-it-Q4_K_M.gguf", "mmproj-model-f16.gguf")
        self._touch_pair(self.llm_dir / "OtherVLM", "other-q4_k_m.gguf", "mmproj-other-bf16.gguf")

        result = discover_director_profiles({"models_dir": str(self.models_dir)}, refresh=True)
        self.assertEqual(result.preferred("Default").label, PROMPT_MODEL_QWEN)
        self.assertEqual(result.by_id("Qwen3.5-9B-Uncensored").label, PROMPT_MODEL_QWEN_UNCENSORED)
        self.assertEqual(result.by_id("Qwen3.5-9B-Uncensored").slot, "Uncensored")
        aggressive = result.by_id("Qwen3.5-9B-Uncensored-HauhauCS-Aggressive")
        self.assertEqual(aggressive.label, PROMPT_MODEL_QWEN_AGGRESSIVE)
        self.assertEqual(aggressive.slot, "Uncensored")
        self.assertEqual(result.preferred_prompt_model(PROMPT_MODEL_QWEN_AGGRESSIVE), aggressive)
        self.assertEqual(result.preferred("Gemma").label, PROMPT_MODEL_GEMMA)
        self.assertEqual(result.by_id("Gemma3-12B").slot, "Gemma")
        self.assertEqual(result.by_id("Gemma3-12B").model_family, "gemma")
        self.assertTrue(result.by_id("Gemma3-12B").vision_ready)
        self.assertEqual(result.by_id("OtherVLM").slot, "Custom")
        public = result.to_public_mapping()
        self.assertEqual(public["assignments"][PROMPT_MODEL_QWEN_UNCENSORED]["id"], "Qwen3.5-9B-Uncensored")
        self.assertEqual(public["assignments"][PROMPT_MODEL_QWEN_AGGRESSIVE]["id"], "Qwen3.5-9B-Uncensored-HauhauCS-Aggressive")
        config = {"backend": "local_llama_cpp", "local_llama_cpp": {"models_dir": str(self.models_dir)}}
        for selection, expected_id in (
            (PROMPT_MODEL_QWEN, "Qwen3.5-9B"),
            (PROMPT_MODEL_QWEN_UNCENSORED, "Qwen3.5-9B-Uncensored"),
            (PROMPT_MODEL_QWEN_AGGRESSIVE, "Qwen3.5-9B-Uncensored-HauhauCS-Aggressive"),
            (PROMPT_MODEL_GEMMA, "Gemma3-12B"),
        ):
            with self.subTest(prompt_model=selection):
                effective, resolved = resolve_director_config(
                    config,
                    PromptDirectorRequest(idea="test", prompt_model=selection),
                    refresh=True,
                )
                self.assertEqual(resolved.profile_id, expected_id)
                self.assertEqual(effective["local_llama_cpp"]["requested_model"], selection)

    def test_pairing_prefers_q4_k_m_and_marks_missing_mmproj(self):
        folder = self.llm_dir / "Many"
        folder.mkdir()
        (folder / "model-q8_0.gguf").write_bytes(b"q8")
        (folder / "model-q4_k_m.gguf").write_bytes(b"q4")
        (folder / "mmproj-model-bf16.gguf").write_bytes(b"mm")
        incomplete = self.llm_dir / "Incomplete"
        incomplete.mkdir()
        (incomplete / "text-model-q4_k_m.gguf").write_bytes(b"text")

        result = discover_director_profiles({"models_dir": str(self.models_dir)}, refresh=True)
        self.assertEqual(result.by_id("Many").model_path.name, "model-q4_k_m.gguf")
        self.assertIn("Multiple model GGUF", result.by_id("Many").warning)
        self.assertFalse(result.by_id("Incomplete").vision_ready)
        self.assertIn("vision is unavailable", result.by_id("Incomplete").warning)

    def test_default_resolution_applies_profile_runtime_defaults(self):
        model, mmproj = self._touch_pair(
            self.llm_dir / "Qwen3.5-9B",
            "Qwen3.5-9B-Q4_K_M.gguf",
            "mmproj-Qwen3.5-9B-BF16.gguf",
        )
        legacy_model, legacy_mmproj = self._touch_pair(
            self.llm_dir / "LegacyConfigured",
            "legacy-q8_0.gguf",
            "mmproj-legacy-f16.gguf",
        )
        config = {
            "backend": "local_llama_cpp",
            "local_llama_cpp": {
                "models_dir": str(self.models_dir),
                "model_path": str(legacy_model),
                "mmproj_path": str(legacy_mmproj),
                "llama_server": "llama-server",
            },
        }
        effective, profile = resolve_director_config(config, PromptDirectorRequest(idea="test"), refresh=True)
        settings = effective["local_llama_cpp"]
        self.assertEqual(profile.label, PROMPT_MODEL_QWEN)
        self.assertEqual(Path(settings["model_path"]), model)
        self.assertEqual(Path(settings["mmproj_path"]), mmproj)
        self.assertEqual(settings["requested_model"], PROMPT_MODEL_QWEN)
        self.assertEqual(settings["reasoning"], "off")
        self.assertEqual(settings["image_min_tokens"], 1024)
        self.assertEqual(settings["max_tokens"], 768)
        self.assertEqual(settings["context_size"], 8192)
        self.assertNotIn("keep_model_loaded", settings)

    def test_gemma_resolution_uses_friendly_profile_defaults(self):
        model, mmproj = self._touch_pair(
            self.llm_dir / "Gemma3-12B",
            "gemma-3-12b-it-Q4_K_M.gguf",
            "mmproj-model-f16.gguf",
        )
        effective, profile = resolve_director_config(
            {"backend": "local_llama_cpp", "local_llama_cpp": {"models_dir": str(self.models_dir)}},
            PromptDirectorRequest(idea="test", prompt_model=PROMPT_MODEL_GEMMA),
            refresh=True,
        )
        settings = effective["local_llama_cpp"]
        self.assertEqual(profile.label, PROMPT_MODEL_GEMMA)
        self.assertEqual(profile.model_family, "gemma")
        self.assertEqual(Path(settings["model_path"]), model)
        self.assertEqual(Path(settings["mmproj_path"]), mmproj)
        self.assertEqual(settings["requested_model"], PROMPT_MODEL_GEMMA)
        self.assertEqual(settings["context_size"], 8192)
        self.assertEqual(settings["image_min_tokens"], 1024)
        self.assertEqual(settings["max_tokens"], 768)
        self.assertEqual(settings["gpu_layers"], "auto")
        self.assertNotIn("keep_model_loaded", settings)

    def test_missing_uncensored_is_scoped(self):
        self._touch_pair(
            self.llm_dir / "Qwen3.5-9B",
            "Qwen3.5-9B-Q4_K_M.gguf",
            "mmproj-Qwen3.5-9B-BF16.gguf",
        )
        request = PromptDirectorRequest(idea="test", prompt_model=PROMPT_MODEL_QWEN_UNCENSORED)
        with self.assertRaisesRegex(BackendConfigurationError, "Prompt Model .*Uncensored.* is unavailable"):
            resolve_director_config(
                {"backend": "local_llama_cpp", "local_llama_cpp": {"models_dir": str(self.models_dir)}},
                request,
                refresh=True,
            )

    def test_custom_without_explicit_profile_or_paths_does_not_use_legacy_pair(self):
        model, mmproj = self._touch_pair(
            self.llm_dir / "Qwen3.5-9B",
            "Qwen3.5-9B-Q4_K_M.gguf",
            "mmproj-Qwen3.5-9B-BF16.gguf",
        )
        request = PromptDirectorRequest(idea="test", prompt_model="Custom")
        with self.assertRaisesRegex(BackendConfigurationError, "no custom model is configured"):
            resolve_director_config(
                {
                    "backend": "local_llama_cpp",
                    "local_llama_cpp": {
                        "models_dir": str(self.models_dir),
                        "model_path": str(model),
                        "mmproj_path": str(mmproj),
                    },
                },
                request,
                refresh=True,
            )

    def test_custom_discovered_profile_applies_runtime_and_server_overrides(self):
        model, mmproj = self._touch_pair(
            self.llm_dir / "Gemma",
            "gemma-q4_k_m.gguf",
            "mmproj-gemma-bf16.gguf",
        )
        request = PromptDirectorRequest(
            idea="test",
            prompt_model="Custom",
            director_profile="Gemma",
            director_llama_server="custom-llama-server",
            director_context_size=12288,
            director_image_min_tokens=1536,
            director_max_tokens=900,
            director_gpu_layers="42",
            director_keep_model_loaded=True,
        )
        effective, profile = resolve_director_config(
            {
                "backend": "local_llama_cpp",
                "local_llama_cpp": {"models_dir": str(self.models_dir), "llama_server": "configured-server"},
            },
            request,
            refresh=True,
        )
        settings = effective["local_llama_cpp"]
        self.assertEqual(profile.label, "Gemma")
        self.assertEqual(Path(settings["model_path"]), model)
        self.assertEqual(Path(settings["mmproj_path"]), mmproj)
        self.assertEqual(settings["requested_model"], "Custom")
        self.assertEqual(settings["llama_server"], "custom-llama-server")
        self.assertEqual(settings["context_size"], 12288)
        self.assertEqual(settings["image_min_tokens"], 1536)
        self.assertEqual(settings["max_tokens"], 900)
        self.assertEqual(settings["gpu_layers"], "42")
        self.assertNotIn("keep_model_loaded", settings)


if __name__ == "__main__":
    unittest.main()
