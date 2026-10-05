"""Concise, content-safe runtime diagnostics for Prompt Director requests."""

import base64
import hashlib
import json
import os


def sha256_text(value):
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def debug_prompts_enabled():
    return str(os.environ.get("KOO_PROMPT_DIRECTOR_DEBUG_PROMPTS") or "").strip().casefold() in {
        "1", "true", "yes", "on",
    }


def sha256_json(value):
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def evidence_sha256(evidence):
    if evidence is None:
        return "NONE"
    return sha256_json({key: value for key, value in evidence.attributes})


def resolved_scene_sha256(scene):
    if scene is None:
        return "NONE"
    return sha256_json([
        {
            "key": item.key,
            "label": item.label,
            "source": item.source,
            "evidence": item.evidence,
            "preserve": bool(item.preserve),
        }
        for item in scene.attributes
    ])


def _redacted_image_url(url):
    value = str(url or "")
    if not value.startswith("data:") or "," not in value:
        return {"type": "image", "source": "non-data-url"}
    header, encoded = value.split(",", 1)
    try:
        payload = base64.b64decode(encoded, validate=False)
    except (TypeError, ValueError):
        payload = encoded.encode("utf-8", errors="replace")
    return {
        "type": "image",
        "media": header,
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def payload_without_binary_images(payload):
    redacted = dict(payload or {})
    messages = []
    for message in redacted.get("messages", ()):
        safe_message = dict(message)
        content = safe_message.get("content")
        if isinstance(content, list):
            safe_parts = []
            for part in content:
                if not isinstance(part, dict):
                    safe_parts.append(part)
                    continue
                safe_part = dict(part)
                if safe_part.get("type") == "image_url":
                    image_url = safe_part.get("image_url") or {}
                    safe_part["image_url"] = _redacted_image_url(image_url.get("url"))
                safe_parts.append(safe_part)
            safe_message["content"] = safe_parts
        messages.append(safe_message)
    redacted["messages"] = messages
    return redacted


def _display(value, fallback="NONE"):
    if value is None or value == "":
        return fallback
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)


def log_request(backend, instruction, payload):
    runtime = dict(getattr(backend, "runtime_diagnostics", {}) or {})
    context = dict(getattr(instruction, "diagnostic_context", {}) or {})
    stage = str(getattr(instruction, "diagnostic_stage", "final") or "final")
    safe_payload = payload_without_binary_images(payload)
    options = payload.get("options", {}) if isinstance(payload.get("options", {}), dict) else {}
    print(
        f"[KoO Diagnostic] stage={stage} model={_display(runtime.get('model'), _display(context.get('model')))}",
        flush=True,
    )
    print(
        "[KoO Diagnostic] "
        f"runtime={_display(runtime.get('runtime'), _display(context.get('runtime'), 'UNKNOWN'))} "
        f"endpoint={_display(runtime.get('endpoint'))} "
        f"connection={_display(runtime.get('connection'), 'not_checked')}",
        flush=True,
    )
    print(
        f"[KoO Diagnostic] gguf={_display(runtime.get('gguf'))} mmproj={_display(runtime.get('mmproj'))}",
        flush=True,
    )
    print(
        "[KoO Diagnostic] "
        f"pid={_display(runtime.get('pid'))} port={_display(runtime.get('port'))} "
        f"reused={_display(runtime.get('reused'), 'false')} "
        f"restarted={_display(runtime.get('restarted'), 'false')}",
        flush=True,
    )
    print(
        "[KoO Diagnostic] sampling "
        f"temperature={_display(payload.get('temperature', options.get('temperature')))} "
        f"top_p={_display(payload.get('top_p', options.get('top_p')), 'NOT_SENT(server_default)')} "
        f"repeat_penalty={_display(payload.get('repeat_penalty', options.get('repeat_penalty')), 'NOT_SENT(server_default)')} "
        f"max_tokens={_display(payload.get('max_tokens', options.get('num_predict')))}",
        flush=True,
    )
    if options.get("num_predict") is not None or options.get("num_ctx") is not None:
        print(
            "[KoO Diagnostic] ollama "
            f"think={_display(payload.get('think'))} "
            f"num_ctx={_display(options.get('num_ctx'))} "
            f"num_predict={_display(options.get('num_predict'))}",
            flush=True,
        )
    print(
        "[KoO Diagnostic] "
        f"preset={_display(context.get('preset'))} length={_display(context.get('length'))} "
        f"target={_display(context.get('target'))} creativity={_display(context.get('creativity'))}",
        flush=True,
    )
    print(
        "[KoO Diagnostic] "
        f"director_override={_display(context.get('director_override'), 'false')} "
        f"workflow_rules={_display(context.get('workflow_rules'), 'false')} "
        f"image_references={_display(context.get('image_references'), '0')}",
        flush=True,
    )
    print(
        "[KoO Diagnostic] "
        f"system_sha256={sha256_text(instruction.system_message)} "
        f"user_sha256={sha256_text(instruction.user_message)}",
        flush=True,
    )
    print(
        "[KoO Diagnostic] "
        f"evidence_sha256={_display(context.get('evidence_sha256'))} "
        f"request_sha256={sha256_json(safe_payload)}",
        flush=True,
    )


def log_response(instruction, response_text):
    stage = str(getattr(instruction, "diagnostic_stage", "final") or "final")
    print(
        f"[KoO Diagnostic] stage={stage} output_sha256={sha256_text(response_text)} "
        f"output_chars={len(str(response_text or ''))}",
        flush=True,
    )


def log_runtime_connection(backend, success, detail=""):
    runtime = dict(getattr(backend, "runtime_diagnostics", {}) or {})
    runtime["connection"] = "success" if success else "failure"
    backend.runtime_diagnostics = runtime
    suffix = f" detail={str(detail).replace(chr(10), ' ')[:240]}" if detail else ""
    print(
        "[KoO Diagnostic] "
        f"runtime={_display(runtime.get('runtime'), 'UNKNOWN')} "
        f"model={_display(runtime.get('model'), getattr(backend, 'model', 'UNKNOWN'))} "
        f"endpoint={_display(runtime.get('endpoint'), getattr(backend, 'base_url', 'NONE'))} "
        f"connection={'success' if success else 'failure'}{suffix}",
        flush=True,
    )


def log_evidence_result(source_label, evidence, cache_state):
    stage = f"evidence:{str(source_label or '').strip().lower().replace(' ', '_')}"
    print(
        f"[KoO Diagnostic] stage={stage} cache={cache_state} "
        f"evidence_sha256={evidence_sha256(evidence)}",
        flush=True,
    )
