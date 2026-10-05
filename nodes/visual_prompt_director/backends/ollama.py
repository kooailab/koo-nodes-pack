"""Ollama runtime adapter with a native Qwen3.8 reliability path."""

from dataclasses import dataclass
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .base import BackendConfigurationError, BackendGenerationError
from .openai_compatible import OpenAICompatibleBackend, _chat_completions_url, _log_multimodal_messages
from ..diagnostics import log_request, log_response, log_runtime_connection

DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434/v1"
DEFAULT_OLLAMA_MODEL = "qwen3.8"
QWEN38_NUM_PREDICT = 8192
QWEN38_NUM_CTX = 32768
QWEN38_TIMEOUT = 600
MAX_CONTINUATIONS = 2
QWEN38_THINKING_LEVELS = ("max", "high", "medium", "low", True)

QWEN38_COMPLETION_RULE = (
    "Reason internally before answering. Return one complete final prompt, finish every sentence, and never "
    "intentionally stop mid-description. Output only the requested final prompt and never expose reasoning."
)

CONTINUATION_INSTRUCTION = (
    "The previous answer was truncated because the output token budget was reached. Continue the final prompt "
    "exactly from where it stopped. Do not restart, summarize, repeat previous text, add commentary, headings, "
    "or explanations. Output only the missing continuation and finish the prompt naturally."
)

QWEN38_SAMPLING_BY_CREATIVITY = {
    "Strict": {"temperature": 0.3, "top_p": 0.85, "top_k": 20, "repeat_penalty": 1.0},
    "Balanced": {"temperature": 0.6, "top_p": 0.95, "top_k": 20, "repeat_penalty": 1.0},
    "Creative": {"temperature": 0.8, "top_p": 0.95, "top_k": 20, "repeat_penalty": 1.0},
    "Dice": {"temperature": 1.0, "top_p": 0.98, "top_k": 20, "repeat_penalty": 1.0},
}

_OLLAMA_METADATA_FIELDS = (
    "done",
    "done_reason",
    "eval_count",
    "prompt_eval_count",
    "total_duration",
    "load_duration",
    "eval_duration",
)


def normalize_ollama_endpoint(value):
    """Return a validated OpenAI-compatible Ollama base URL."""
    endpoint = str(value or DEFAULT_OLLAMA_ENDPOINT).strip().rstrip("/")
    if urlparse(endpoint).path in {"", "/"}:
        endpoint = f"{endpoint}/v1"
    chat_url = _chat_completions_url(endpoint)
    return chat_url[: -len("/chat/completions")]


@dataclass(frozen=True)
class OllamaDiscoveryResult:
    endpoint: str
    models: tuple

    def to_public_mapping(self):
        return {
            "endpoint": self.endpoint,
            "connection": "success",
            "ollama_models": list(self.models),
        }


@dataclass(frozen=True)
class OllamaUnloadResult:
    endpoint: str
    model: str

    def to_public_mapping(self):
        return {
            "runtime": "OLLAMA",
            "selected_model": self.model,
            "endpoint": self.endpoint,
            "connection": "success",
            "loaded": False,
            "status": "unloaded",
        }


def _native_generate_url(endpoint):
    openai_endpoint = normalize_ollama_endpoint(endpoint)
    native_root = openai_endpoint[:-3] if openai_endpoint.endswith("/v1") else openai_endpoint
    return f"{native_root.rstrip('/')}/api/generate"


def _native_chat_url(endpoint):
    openai_endpoint = normalize_ollama_endpoint(endpoint)
    native_root = openai_endpoint[:-3] if openai_endpoint.endswith("/v1") else openai_endpoint
    return f"{native_root.rstrip('/')}/api/chat"


def is_qwen38_model(model_name):
    compact = "".join(character for character in str(model_name or "").casefold() if character.isalnum())
    return compact.startswith("qwen38")


def resolve_thinking_config(model_name):
    """Return strongest-first reasoning candidates only for the enhanced Qwen3.8 path."""
    return QWEN38_THINKING_LEVELS if is_qwen38_model(model_name) else ()


def _native_messages(messages):
    """Translate existing OpenAI-style text/image messages to Ollama native chat messages."""
    native = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, str):
            native.append({"role": str(message.get("role") or "user"), "content": content})
            continue
        text_parts = []
        images = []
        for part in content or ():
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                text_parts.append(str(part.get("text") or ""))
            elif part.get("type") == "image_url":
                image_url = part.get("image_url") or {}
                value = str(image_url.get("url") or "")
                if not value.startswith("data:") or "," not in value:
                    raise BackendConfigurationError(
                        "Ollama native vision requests require base64 data-image references."
                    )
                images.append(value.split(",", 1)[1])
        native_message = {
            "role": str(message.get("role") or "user"),
            "content": "\n\n".join(text_parts),
        }
        if images:
            native_message["images"] = images
        native.append(native_message)
    return native


def _with_completion_rule(messages):
    prepared = [dict(message) for message in messages]
    for message in prepared:
        if message.get("role") == "system":
            message["content"] = f"{str(message.get('content') or '').rstrip()}\n\n{QWEN38_COMPLETION_RULE}"
            return prepared
    return [{"role": "system", "content": QWEN38_COMPLETION_RULE}, *prepared]


@dataclass(frozen=True)
class OllamaChatResult:
    content: str
    thinking: str
    done: bool
    done_reason: str
    eval_count: object = None
    prompt_eval_count: object = None
    total_duration: object = None
    load_duration: object = None
    eval_duration: object = None


def _parse_native_chat_response(body):
    """Parse either one JSON response or NDJSON chunks without losing final metadata."""
    text = body.decode("utf-8") if isinstance(body, bytes) else str(body or "")
    try:
        parsed = json.loads(text)
        packets = [parsed]
    except json.JSONDecodeError:
        try:
            packets = [json.loads(line) for line in text.splitlines() if line.strip()]
        except json.JSONDecodeError as exc:
            raise BackendGenerationError("Ollama native /api/chat returned invalid JSON.") from exc
    if not packets or not all(isinstance(packet, dict) for packet in packets):
        raise BackendGenerationError("Ollama native /api/chat returned an invalid response.")

    content = []
    thinking = []
    metadata = {field: None for field in _OLLAMA_METADATA_FIELDS}
    for packet in packets:
        if packet.get("error"):
            raise BackendGenerationError(f"Ollama native /api/chat failed: {packet['error']}")
        message = packet.get("message") or {}
        if isinstance(message, dict):
            if isinstance(message.get("content"), str):
                content.append(message["content"])
            if isinstance(message.get("thinking"), str):
                thinking.append(message["thinking"])
        for field in _OLLAMA_METADATA_FIELDS:
            if field in packet:
                metadata[field] = packet[field]

    if metadata["done"] is not True:
        raise BackendGenerationError(
            "Ollama native /api/chat ended without a final done response; no partial prompt was returned."
        )
    return OllamaChatResult(
        content="".join(content),
        thinking="".join(thinking),
        done=True,
        done_reason=str(metadata["done_reason"] or "unknown"),
        eval_count=metadata["eval_count"],
        prompt_eval_count=metadata["prompt_eval_count"],
        total_duration=metadata["total_duration"],
        load_duration=metadata["load_duration"],
        eval_duration=metadata["eval_duration"],
    )


def _merge_continuation(existing, continuation):
    """Append a continuation while removing any repeated boundary text."""
    left = str(existing or "")
    right = str(continuation or "")
    if not left:
        return right
    if not right:
        return left
    overlap = 0
    limit = min(len(left), len(right), 4096)
    for size in range(limit, 0, -1):
        if left[-size:] == right[:size]:
            overlap = size
            break
    remainder = right[overlap:]
    if not remainder:
        return left
    if left[-1].isspace() or remainder[0].isspace() or remainder[0] in ",.;:!?)]}" or left[-1] in "([{/-—":
        return left + remainder
    return left + " " + remainder


def discover_ollama_models(settings=None, opener=None):
    """Query installed models without requiring the Ollama Python package."""
    settings = settings if isinstance(settings, dict) else {}
    endpoint = normalize_ollama_endpoint(settings.get("base_url") or settings.get("endpoint"))
    api_key = str(settings.get("api_key") or "ollama").strip() or "ollama"
    try:
        timeout = max(0.25, min(30.0, float(settings.get("discovery_timeout", 3))))
    except (TypeError, ValueError) as exc:
        raise BackendConfigurationError("Ollama discovery_timeout is invalid.") from exc

    request = Request(
        f"{endpoint}/models",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="GET",
    )
    open_request = opener or urlopen
    try:
        with open_request(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        raise BackendGenerationError(
            f"Ollama responded at {endpoint} but model discovery returned HTTP {exc.code}."
        ) from exc
    except (URLError, TimeoutError) as exc:
        reason = getattr(exc, "reason", None) or "connection timed out"
        raise BackendGenerationError(
            f"Could not connect to Ollama at {endpoint}. Start Ollama, then click Refresh Models. ({reason})"
        ) from exc

    try:
        payload = json.loads(body)
        entries = payload["data"]
        models = sorted(
            {
                str(entry.get("id") or "").strip()
                for entry in entries
                if isinstance(entry, dict) and str(entry.get("id") or "").strip()
            },
            key=str.casefold,
        )
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise BackendGenerationError(
            f"Ollama at {endpoint} returned an invalid /v1/models response."
        ) from exc
    return OllamaDiscoveryResult(endpoint=endpoint, models=tuple(models))


def unload_ollama_model(settings=None, opener=None):
    """Immediately unload one installed Ollama model without deleting it."""
    settings = settings if isinstance(settings, dict) else {}
    endpoint = normalize_ollama_endpoint(settings.get("base_url") or settings.get("endpoint"))
    model = str(settings.get("model") or DEFAULT_OLLAMA_MODEL).strip()
    api_key = str(settings.get("api_key") or "ollama").strip() or "ollama"
    if not model:
        raise BackendConfigurationError("Select an Ollama model before unloading it.")
    try:
        timeout = max(0.25, min(30.0, float(settings.get("unload_timeout", 10))))
    except (TypeError, ValueError) as exc:
        raise BackendConfigurationError("Ollama unload_timeout is invalid.") from exc

    request = Request(
        _native_generate_url(endpoint),
        data=json.dumps({"model": model, "keep_alive": 0, "stream": False}).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    open_request = opener or urlopen
    try:
        with open_request(request, timeout=timeout) as response:
            response.read()
    except HTTPError as exc:
        print(
            f"[KoO Diagnostic] action=unload runtime=OLLAMA model={model} endpoint={endpoint} "
            f"connection=success loaded=unknown status=failure http_status={exc.code}"
        )
        raise BackendGenerationError(
            f"Ollama responded at {endpoint} but could not unload model '{model}' (HTTP {exc.code})."
        ) from exc
    except (URLError, TimeoutError) as exc:
        reason = getattr(exc, "reason", None) or "connection timed out"
        print(
            f"[KoO Diagnostic] action=unload runtime=OLLAMA model={model} endpoint={endpoint} "
            "connection=failure loaded=unknown status=failure"
        )
        raise BackendGenerationError(
            f"Could not connect to Ollama at {endpoint}. "
            f"Start Ollama, then try Unload Model again. ({reason})"
        ) from exc

    print(
        f"[KoO Diagnostic] action=unload runtime=OLLAMA model={model} endpoint={endpoint} "
        "connection=success loaded=false status=unloaded"
    )
    return OllamaUnloadResult(endpoint=endpoint, model=model)


class OllamaBackend(OpenAICompatibleBackend):
    """Ollama client; Qwen3.8 uses native chat for reasoning and stop metadata."""

    name = "ollama"
    error_label = "Ollama"

    def __init__(self, settings=None):
        source = dict(settings or {})
        source["base_url"] = normalize_ollama_endpoint(source.get("base_url") or source.get("endpoint"))
        source["model"] = str(source.get("model") or DEFAULT_OLLAMA_MODEL).strip()
        source["api_key"] = str(source.get("api_key") or "ollama").strip() or "ollama"
        self._native_qwen38 = is_qwen38_model(source["model"])
        if self._native_qwen38:
            source.setdefault("timeout", QWEN38_TIMEOUT)
        runtime = dict(source.get("_runtime_diagnostics") or {})
        runtime.update({
            "runtime": "OLLAMA",
            "model": source["model"],
            "endpoint": source["base_url"],
            "connection": "not_checked",
        })
        source["_runtime_diagnostics"] = runtime
        super().__init__(source)
        try:
            self.num_predict = max(256, min(65536, int(source.get("num_predict", QWEN38_NUM_PREDICT))))
            self.num_ctx = max(2048, min(262144, int(source.get("num_ctx", QWEN38_NUM_CTX))))
            self.max_continuations = max(0, min(5, int(source.get("max_continuations", MAX_CONTINUATIONS))))
        except (TypeError, ValueError) as exc:
            raise BackendConfigurationError(
                "Ollama num_predict, num_ctx, or max_continuations is invalid."
            ) from exc
        self._resolved_thinking = None
        self.last_warning = ""

    def _unreachable_message(self, reason):
        return (
            f"Could not connect to Ollama at {self.base_url}. "
            f"Start Ollama, click Refresh Models, and try again. ({reason})"
        )

    def _timeout_message(self):
        return f"Ollama at {self.base_url} did not respond before the request timed out."

    def _qwen38_options(self, instruction):
        context = getattr(instruction, "diagnostic_context", {}) or {}
        creativity = str(context.get("creativity") or "Balanced")
        sampling = QWEN38_SAMPLING_BY_CREATIVITY.get(
            creativity,
            QWEN38_SAMPLING_BY_CREATIVITY["Balanced"],
        )
        return {
            "num_ctx": self.num_ctx,
            "num_predict": self.num_predict,
            **sampling,
        }

    @staticmethod
    def _http_error_detail(exc):
        try:
            payload = json.loads(exc.read(4096).decode("utf-8", errors="replace"))
            error = payload.get("error", "") if isinstance(payload, dict) else ""
            return str(error.get("message", "") if isinstance(error, dict) else error).strip()
        except Exception:
            return ""

    @staticmethod
    def _thinking_rejected(exc, detail):
        if exc.code not in {400, 422}:
            return False
        lowered = str(detail or "").casefold()
        return not lowered or any(
            marker in lowered
            for marker in ("think", "reason", "unsupported", "invalid", "unknown", "max", "high", "medium", "low")
        )

    def _native_chat_once(self, instruction, messages, thinking, continuation_index):
        options = self._qwen38_options(instruction)
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "think": thinking,
            "options": options,
        }
        log_request(self, instruction, payload)
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = Request(
            _native_chat_url(self.base_url),
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = response.read()
        except HTTPError as exc:
            detail = self._http_error_detail(exc)
            exc.koo_detail = detail
            raise
        except URLError as exc:
            log_runtime_connection(self, False, exc.reason)
            raise BackendGenerationError(self._unreachable_message(exc.reason)) from exc
        except TimeoutError as exc:
            log_runtime_connection(self, False, "timeout")
            raise BackendGenerationError(
                f"Ollama Qwen3.8 reasoning timed out after {self.timeout:g} seconds; "
                "no partial prompt was returned."
            ) from exc

        result = _parse_native_chat_response(body)
        print(
            "[KoO Ollama Qwen3.8] "
            f"model={self.model} reasoning={thinking} num_ctx={self.num_ctx} "
            f"num_predict={self.num_predict} done_reason={result.done_reason} "
            f"prompt_eval_count={result.prompt_eval_count} eval_count={result.eval_count} "
            f"total_duration={result.total_duration} load_duration={result.load_duration} "
            f"eval_duration={result.eval_duration} thinking_chars={len(result.thinking)} "
            f"continuations={continuation_index}",
            flush=True,
        )
        return result

    def _native_chat_with_fallback(self, instruction, messages, continuation_index):
        candidates = (
            (self._resolved_thinking,)
            if self._resolved_thinking is not None
            else resolve_thinking_config(self.model)
        )
        last_http_error = None
        for index, thinking in enumerate(candidates):
            try:
                result = self._native_chat_once(
                    instruction,
                    messages,
                    thinking,
                    continuation_index,
                )
                self._resolved_thinking = thinking
                return result, thinking
            except HTTPError as exc:
                last_http_error = exc
                detail = getattr(exc, "koo_detail", "")
                if index + 1 < len(candidates) and self._thinking_rejected(exc, detail):
                    print(
                        f"[KoO Ollama Qwen3.8] reasoning={thinking} rejected; "
                        f"falling back to {candidates[index + 1]}",
                        flush=True,
                    )
                    continue
                log_runtime_connection(self, True, f"HTTP {exc.code}")
                suffix = f": {detail}" if detail else ""
                raise BackendGenerationError(f"Ollama returned HTTP {exc.code}{suffix}") from exc
        if last_http_error is not None:
            detail = getattr(last_http_error, "koo_detail", "")
            log_runtime_connection(self, True, f"HTTP {last_http_error.code}")
            suffix = f": {detail}" if detail else ""
            raise BackendGenerationError(
                f"Ollama rejected every supported Qwen3.8 thinking mode (HTTP {last_http_error.code}){suffix}"
            ) from last_http_error
        raise BackendConfigurationError("No Qwen3.8 thinking configuration is available.")

    def generate(self, instruction):
        if not self._native_qwen38:
            return super().generate(instruction)

        self.validate_instruction(instruction)
        original_messages = instruction.to_messages()
        _log_multimodal_messages(original_messages)
        messages = _with_completion_rule(_native_messages(original_messages))
        result, thinking = self._native_chat_with_fallback(instruction, messages, 0)
        log_runtime_connection(self, True)
        combined = result.content
        continuations = 0

        while result.done_reason.casefold() == "length" and continuations < self.max_continuations:
            continuations += 1
            print(
                "[KoO Ollama Qwen3.8] generation hit token limit "
                f"done_reason=length continuation={continuations}/{self.max_continuations}",
                flush=True,
            )
            continuation_messages = [
                *messages,
                {"role": "assistant", "content": combined},
                {"role": "user", "content": CONTINUATION_INSTRUCTION},
            ]
            result, thinking = self._native_chat_with_fallback(
                instruction,
                continuation_messages,
                continuations,
            )
            combined = _merge_continuation(combined, result.content)

        final_text = combined.strip()
        if not final_text:
            raise BackendGenerationError(
                "Ollama Qwen3.8 returned no final prompt content; reasoning was not exposed as output."
            )
        if result.done_reason.casefold() == "length":
            self.last_warning = (
                f"Ollama Qwen3.8 still reached its output limit after {continuations} continuation(s); "
                "the recovered prompt may be incomplete."
            )
            print(f"[KoO WARNING] {self.last_warning}", flush=True)
        elif continuations:
            print(
                "[KoO Ollama Qwen3.8] recovery complete "
                f"final_chars={len(final_text)} continuations={continuations} reasoning={thinking}",
                flush=True,
            )
        log_response(instruction, final_text)
        return final_text
