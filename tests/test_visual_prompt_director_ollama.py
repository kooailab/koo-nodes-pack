"""Focused runtime-selection and Ollama request-contract tests."""

from contextlib import redirect_stdout
from io import BytesIO, StringIO
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError


PACKAGE_NAME = "koo_visual_prompt_director_ollama_test"
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

from koo_visual_prompt_director_ollama_test.backends.factory import create_backend
from koo_visual_prompt_director_ollama_test.backends.ollama import (
    CONTINUATION_INSTRUCTION,
    DEFAULT_OLLAMA_ENDPOINT,
    MAX_CONTINUATIONS,
    OllamaBackend,
    QWEN38_COMPLETION_RULE,
    QWEN38_NUM_CTX,
    QWEN38_NUM_PREDICT,
    QWEN38_TIMEOUT,
    _merge_continuation,
    _parse_native_chat_response,
    discover_ollama_models,
    is_qwen38_model,
    normalize_ollama_endpoint,
    resolve_thinking_config,
    unload_ollama_model,
)
from koo_visual_prompt_director_ollama_test.core import (
    PromptDirectorRequest,
    PromptDirectorService,
    RUNTIME_NAMES,
    assemble_instruction,
)
from koo_visual_prompt_director_ollama_test.director_profiles import resolve_director_config
from koo_visual_prompt_director_ollama_test.image_utils import EncodedImage
from koo_visual_prompt_director_ollama_test.nodes import KoOVisualPromptDirector


class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        if isinstance(self.payload, bytes):
            return self.payload
        if isinstance(self.payload, str):
            return self.payload.encode("utf-8")
        return json.dumps(self.payload).encode("utf-8")


def _chat_response(content, done_reason="stop", thinking="private reasoning", **metadata):
    return {
        "model": "qwen3.8:latest",
        "message": {"role": "assistant", "thinking": thinking, "content": content},
        "done": True,
        "done_reason": done_reason,
        "prompt_eval_count": metadata.get("prompt_eval_count", 321),
        "eval_count": metadata.get("eval_count", 456),
        "total_duration": metadata.get("total_duration", 900),
        "load_duration": metadata.get("load_duration", 100),
        "eval_duration": metadata.get("eval_duration", 700),
    }


class OllamaRuntimeTests(unittest.TestCase):
    def test_runtime_widgets_are_appended_with_legacy_default(self):
        request = PromptDirectorRequest.from_mapping({"idea": "legacy workflow"})
        self.assertEqual(request.runtime, "LLAMA.CPP")
        required = KoOVisualPromptDirector.INPUT_TYPES()["required"]
        self.assertEqual(required["runtime"], (RUNTIME_NAMES, {"default": "LLAMA.CPP"}))
        self.assertEqual(required["ollama_model"][1]["default"], "qwen3.8")
        self.assertEqual(required["ollama_endpoint"][1]["default"], DEFAULT_OLLAMA_ENDPOINT)
        self.assertEqual(list(required)[-3:], ["runtime", "ollama_model", "ollama_endpoint"])

    def test_frontend_exposes_runtime_selector_and_sends_runtime_fields(self):
        source = FRONTEND_PATH.read_text(encoding="utf-8")
        self.assertIn('const RUNTIMES = ["LLAMA.CPP", "OLLAMA"]', source)
        self.assertIn('hit("runtime", segment, name)', source)
        self.assertIn('runtime: current.runtime', source)
        self.assertIn('ollama_model: current.ollama_model', source)
        self.assertIn('query.set("model", current.ollama_model)', source)

    def test_node_forwards_selected_runtime_to_service(self):
        with patch(
            f"{PACKAGE_NAME}.nodes.PromptDirectorService.generate",
            return_value=SimpleNamespace(prompt="ollama output"),
        ) as generate:
            output = KoOVisualPromptDirector().direct(
                "portrait", "Enhance", "Generic", "Balanced",
                True, False, False, False, False, False,
                "Medium", "", "", "",
                runtime="OLLAMA",
                ollama_model="qwen3.8:latest",
            )
        request = generate.call_args.args[0]
        self.assertEqual(request.runtime, "OLLAMA")
        self.assertEqual(request.ollama_model, "qwen3.8:latest")
        self.assertEqual(output["result"], ("ollama output",))

    def test_ollama_selection_bypasses_local_llama_configuration(self):
        request = PromptDirectorRequest(
            idea="portrait",
            runtime="OLLAMA",
            ollama_model="qwen3.8:latest",
        )
        effective, profile = resolve_director_config(
            {
                "backend": "local_llama_cpp",
                "local_llama_cpp": {
                    "llama_server": "missing-llama-server.exe",
                    "model_path": "missing.gguf",
                    "mmproj_path": "missing-mmproj.gguf",
                },
            },
            request,
        )
        self.assertIsNone(profile)
        self.assertEqual(effective["backend"], "ollama")
        self.assertEqual(effective["ollama"]["model"], "qwen3.8:latest")
        self.assertIsInstance(create_backend(effective), OllamaBackend)

    def test_service_uses_ollama_without_acquiring_llama_server(self):
        request = PromptDirectorRequest(idea="editorial portrait", runtime="OLLAMA", ollama_model="qwen3.8")
        config = {
            "backend": "local_llama_cpp",
            "local_llama_cpp": {"llama_server": "missing-llama-server.exe"},
        }
        with patch(
            f"{PACKAGE_NAME}.backends.ollama.urlopen",
            return_value=_FakeResponse(_chat_response("ollama prompt")),
        ), patch(
            f"{PACKAGE_NAME}.backends.llama_cpp_process.LlamaCppProcessManager.acquire",
            side_effect=AssertionError("llama.cpp must not be acquired"),
        ) as acquire:
            result = PromptDirectorService(config=config).generate(request)
        self.assertEqual(result.prompt, "ollama prompt")
        self.assertEqual(result.backend_name, "ollama")
        self.assertEqual(result.prompt_model, "qwen3.8")
        acquire.assert_not_called()

    def test_qwen38_native_request_uses_large_budget_and_separates_thinking(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = dict(request.header_items())
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _FakeResponse(_chat_response("same parsed prompt", thinking="never expose this reasoning"))

        request = PromptDirectorRequest(
            idea="preserve the face and change the background",
            runtime="OLLAMA",
            ollama_model="qwen3.8",
            image=EncodedImage("cG5n", "image/png", 64, 64),
        )
        instruction = assemble_instruction(request, model_family="qwen")
        backend = OllamaBackend({"model": request.ollama_model})
        trace = StringIO()
        with redirect_stdout(trace), patch(
            f"{PACKAGE_NAME}.backends.ollama.urlopen",
            fake_urlopen,
        ):
            result = backend.generate(instruction)

        self.assertEqual(result, "same parsed prompt")
        self.assertNotIn("never expose this reasoning", result)
        self.assertEqual(captured["url"], "http://127.0.0.1:11434/api/chat")
        self.assertEqual(captured["payload"]["model"], "qwen3.8")
        self.assertEqual(captured["payload"]["stream"], False)
        self.assertEqual(captured["payload"]["think"], "max")
        self.assertEqual(captured["payload"]["options"]["num_predict"], QWEN38_NUM_PREDICT)
        self.assertEqual(captured["payload"]["options"]["num_ctx"], QWEN38_NUM_CTX)
        self.assertIn(QWEN38_COMPLETION_RULE, captured["payload"]["messages"][0]["content"])
        self.assertEqual(captured["payload"]["messages"][1]["images"], ["cG5n"])
        self.assertEqual(captured["headers"]["Authorization"], "Bearer ollama")
        self.assertEqual(captured["timeout"], QWEN38_TIMEOUT)
        self.assertIn("reasoning=max", trace.getvalue())
        self.assertIn("done_reason=stop", trace.getvalue())
        self.assertIn("prompt_eval_count=321", trace.getvalue())
        self.assertIn("eval_count=456", trace.getvalue())
        self.assertIn("connection=success", trace.getvalue())

    def test_installed_model_discovery_uses_openai_models_endpoint(self):
        captured = {}

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["authorization"] = request.get_header("Authorization")
            captured["timeout"] = timeout
            return _FakeResponse({"data": [{"id": "qwen3.8:latest"}, {"id": "gemma3:12b"}]})

        result = discover_ollama_models(opener=opener)
        self.assertEqual(captured["url"], "http://127.0.0.1:11434/v1/models")
        self.assertEqual(captured["authorization"], "Bearer ollama")
        self.assertEqual(captured["timeout"], 3.0)
        self.assertEqual(result.models, ("gemma3:12b", "qwen3.8:latest"))
        self.assertEqual(result.to_public_mapping()["connection"], "success")
        self.assertEqual(normalize_ollama_endpoint("http://127.0.0.1:11434"), DEFAULT_OLLAMA_ENDPOINT)

    def test_connection_refused_error_tells_user_how_to_recover(self):
        backend = OllamaBackend({"model": "qwen3.8"})
        instruction = assemble_instruction(PromptDirectorRequest(idea="test"))
        trace = StringIO()
        with self.assertRaisesRegex(RuntimeError, "Start Ollama, click Refresh Models"):
            with redirect_stdout(trace), patch(
                f"{PACKAGE_NAME}.backends.ollama.urlopen",
                side_effect=URLError("connection refused"),
            ):
                backend.generate(instruction)
        self.assertIn("connection=failure", trace.getvalue())

    def test_qwen38_thinking_falls_back_from_max_to_high_when_rejected(self):
        sent_thinking = []

        def fake_urlopen(request, timeout):
            payload = json.loads(request.data.decode("utf-8"))
            sent_thinking.append(payload["think"])
            if len(sent_thinking) == 1:
                raise HTTPError(
                    request.full_url,
                    400,
                    "Bad Request",
                    None,
                    BytesIO(json.dumps({"error": "unsupported think level max"}).encode("utf-8")),
                )
            return _FakeResponse(_chat_response("fallback succeeded"))

        backend = OllamaBackend({"model": "qwen3.8:latest"})
        instruction = assemble_instruction(PromptDirectorRequest(idea="test"))
        trace = StringIO()
        with redirect_stdout(trace), patch(
            f"{PACKAGE_NAME}.backends.ollama.urlopen",
            fake_urlopen,
        ):
            result = backend.generate(instruction)

        self.assertEqual(result, "fallback succeeded")
        self.assertEqual(sent_thinking, ["max", "high"])
        self.assertEqual(backend._resolved_thinking, "high")
        self.assertIn("reasoning=max rejected; falling back to high", trace.getvalue())

    def test_capability_resolution_is_limited_to_qwen38(self):
        self.assertTrue(is_qwen38_model("qwen3.8:latest"))
        self.assertTrue(is_qwen38_model("Qwen3:8b"))
        self.assertEqual(resolve_thinking_config("qwen3.8:latest")[0], "max")
        self.assertEqual(resolve_thinking_config("gemma3:12b"), ())

    def test_non_thinking_ollama_model_preserves_openai_compatible_path(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _FakeResponse({"choices": [{"message": {"content": "gemma output"}}]})

        backend = OllamaBackend({"model": "gemma3:12b", "max_tokens": 222, "timeout": 17})
        instruction = assemble_instruction(
            PromptDirectorRequest(idea="test"),
            model_family="gemma",
        )
        with patch(f"{PACKAGE_NAME}.backends.openai_compatible.urlopen", fake_urlopen):
            result = backend.generate(instruction)

        self.assertEqual(result, "gemma output")
        self.assertEqual(captured["url"], "http://127.0.0.1:11434/v1/chat/completions")
        self.assertEqual(captured["payload"]["max_tokens"], 222)
        self.assertNotIn("think", captured["payload"])
        self.assertNotIn("options", captured["payload"])
        self.assertEqual(captured["timeout"], 17.0)

    def test_length_stop_recovers_with_continuation_without_duplicate_text(self):
        requests = []
        responses = [
            _chat_response("The fabric drapes naturally with", done_reason="length"),
            _chat_response("drapes naturally with soft compression at the waist.", done_reason="stop"),
        ]

        def fake_urlopen(request, timeout):
            requests.append(json.loads(request.data.decode("utf-8")))
            return _FakeResponse(responses[len(requests) - 1])

        backend = OllamaBackend({"model": "qwen3.8:latest"})
        instruction = assemble_instruction(PromptDirectorRequest(idea="fashion portrait"))
        trace = StringIO()
        with redirect_stdout(trace), patch(f"{PACKAGE_NAME}.backends.ollama.urlopen", fake_urlopen):
            result = backend.generate(instruction)

        self.assertEqual(result, "The fabric drapes naturally with soft compression at the waist.")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[1]["messages"][-2]["content"], "The fabric drapes naturally with")
        self.assertEqual(requests[1]["messages"][-1]["content"], CONTINUATION_INSTRUCTION)
        self.assertNotIn("drapes naturally with drapes naturally with", result)
        self.assertIn("continuation=1/2", trace.getvalue())
        self.assertIn("recovery complete", trace.getvalue())
        self.assertEqual(backend.last_warning, "")

    def test_max_continuations_returns_best_text_with_explicit_warning(self):
        responses = [
            _chat_response("First section", done_reason="length"),
            _chat_response("second section", done_reason="length"),
            _chat_response("third section", done_reason="length"),
        ]
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request)
            return _FakeResponse(responses[len(calls) - 1])

        backend = OllamaBackend({"model": "qwen3.8:latest", "max_continuations": MAX_CONTINUATIONS})
        instruction = assemble_instruction(PromptDirectorRequest(idea="test"))
        trace = StringIO()
        with redirect_stdout(trace), patch(f"{PACKAGE_NAME}.backends.ollama.urlopen", fake_urlopen):
            result = backend.generate(instruction)

        self.assertEqual(result, "First section second section third section")
        self.assertEqual(len(calls), 1 + MAX_CONTINUATIONS)
        self.assertIn("may be incomplete", backend.last_warning)
        self.assertIn("[KoO WARNING]", trace.getvalue())

    def test_stream_parser_accumulates_content_and_retains_final_stop_metadata(self):
        stream = "\n".join([
            json.dumps({"message": {"thinking": "private ", "content": ""}, "done": False}),
            json.dumps({"message": {"thinking": "reasoning", "content": "Final "}, "done": False}),
            json.dumps({
                "message": {"content": "prompt."},
                "done": True,
                "done_reason": "length",
                "prompt_eval_count": 45,
                "eval_count": 8192,
                "total_duration": 90,
                "load_duration": 10,
                "eval_duration": 70,
            }),
        ])
        result = _parse_native_chat_response(stream)
        self.assertEqual(result.content, "Final prompt.")
        self.assertEqual(result.thinking, "private reasoning")
        self.assertEqual(result.done_reason, "length")
        self.assertEqual(result.eval_count, 8192)
        self.assertEqual(result.prompt_eval_count, 45)

    def test_timeout_raises_meaningful_error_without_returning_partial_text(self):
        backend = OllamaBackend({"model": "qwen3.8:latest", "timeout": 31})
        instruction = assemble_instruction(PromptDirectorRequest(idea="test"))
        with self.assertRaisesRegex(
            RuntimeError,
            "reasoning timed out after 31 seconds; no partial prompt was returned",
        ):
            with patch(f"{PACKAGE_NAME}.backends.ollama.urlopen", side_effect=TimeoutError()):
                backend.generate(instruction)

    def test_response_without_final_done_packet_is_rejected(self):
        partial = json.dumps({"message": {"content": "partial"}, "done": False})
        with self.assertRaisesRegex(RuntimeError, "no partial prompt was returned"):
            _parse_native_chat_response(partial)

    def test_continuation_merger_removes_repeated_boundary(self):
        self.assertEqual(
            _merge_continuation("The fabric drapes naturally with", "drapes naturally with soft folds."),
            "The fabric drapes naturally with soft folds.",
        )

    def test_ollama_unload_uses_native_keep_alive_zero_without_deleting_model(self):
        captured = {}

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["method"] = request.get_method()
            captured["authorization"] = request.get_header("Authorization")
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _FakeResponse({"done": True})

        trace = StringIO()
        with redirect_stdout(trace):
            result = unload_ollama_model(
                {
                    "base_url": DEFAULT_OLLAMA_ENDPOINT,
                    "model": "qwen3.8:latest",
                    "unload_timeout": 7,
                },
                opener=opener,
            )

        self.assertEqual(captured["url"], "http://127.0.0.1:11434/api/generate")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["authorization"], "Bearer ollama")
        self.assertEqual(
            captured["payload"],
            {"model": "qwen3.8:latest", "keep_alive": 0, "stream": False},
        )
        self.assertEqual(captured["timeout"], 7.0)
        self.assertEqual(result.to_public_mapping(), {
            "runtime": "OLLAMA",
            "selected_model": "qwen3.8:latest",
            "endpoint": DEFAULT_OLLAMA_ENDPOINT,
            "connection": "success",
            "loaded": False,
            "status": "unloaded",
        })
        self.assertIn("connection=success loaded=false status=unloaded", trace.getvalue())

    def test_ollama_unload_connection_failure_is_helpful(self):
        trace = StringIO()
        with self.assertRaisesRegex(RuntimeError, "Start Ollama, then try Unload Model again"):
            with redirect_stdout(trace):
                unload_ollama_model(
                    {"model": "qwen3.8"},
                    opener=lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("connection refused")),
                )
        self.assertIn("runtime=OLLAMA model=qwen3.8", trace.getvalue())
        self.assertIn("connection=failure loaded=unknown status=failure", trace.getvalue())

    def test_shared_unload_control_sends_runtime_model_and_endpoint(self):
        source = FRONTEND_PATH.read_text(encoding="utf-8")
        self.assertNotIn("if (!ollamaRuntime) {\n      unloadModel =", source)
        self.assertIn('runtime: current.runtime', source)
        self.assertIn('ollama_model: current.ollama_model', source)
        self.assertIn('ollama_endpoint: current.ollama_endpoint', source)
        self.assertIn('loaded: true', source)
        self.assertIn('`OLLAMA unloaded · ${s.ollama_model} · ${s.ollama_endpoint}`', source)

    def test_frontend_keeps_complete_prompt_and_surfaces_recovery_warning(self):
        source = FRONTEND_PATH.read_text(encoding="utf-8")
        self.assertIn('setValue(node, "generated_prompt", String(data.prompt).trim(), false)', source)
        self.assertIn('data.warning || successMessage', source)
        self.assertNotIn(".substring(", source)
        self.assertNotIn("maxLength", source)
        self.assertNotIn("maxlength", source)


if __name__ == "__main__":
    unittest.main()
