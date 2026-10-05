"""Optional ComfyUI HTTP route used by the Generate button."""

import asyncio

from .backends.base import BackendGenerationError, PromptDirectorError
from .backends.llama_cpp_process import get_process_manager
from .backends.ollama import (
    DEFAULT_OLLAMA_ENDPOINT,
    DEFAULT_OLLAMA_MODEL,
    discover_ollama_models,
    normalize_ollama_endpoint,
    unload_ollama_model,
)
from .config import load_config
from .core import PromptDirectorRequest, PromptDirectorService
from .director_profiles import discover_director_profiles
from .presets import (
    DEFAULT_DIRECTOR_PRESET,
    DirectorLibraryError,
    delete_user_director,
    list_director_presets,
    resolve_user_director_directory,
    save_user_director,
)

ROUTE_PATH = "/koo/prompt-director/v1/generate"
TEXT_ROUTE_PATH = "/koo/prompt-director/v1/generate-text"
MODELS_ROUTE_PATH = "/koo/prompt-director/v1/models"
PRESETS_ROUTE_PATH = "/koo/prompt-director/v1/presets"
UNLOAD_ROUTE_PATH = "/koo/prompt-director/v1/unload"


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return False

    @PromptServer.instance.routes.post(ROUTE_PATH)
    async def generate_prompt(request):
        try:
            payload = await request.json()
            director_request = PromptDirectorRequest.from_mapping(payload)
            result = await asyncio.to_thread(PromptDirectorService().generate, director_request)
            return web.json_response({
                "ok": True,
                "prompt": result.prompt,
                "backend": result.backend_name,
                "director_profile": result.director_profile,
                "prompt_model": result.prompt_model,
                "director_preset": result.director_preset,
                "warning": result.warning,
            })
        except (ValueError, PromptDirectorError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "Prompt Director generation failed unexpectedly."},
                status=500,
            )

    @PromptServer.instance.routes.get(MODELS_ROUTE_PATH)
    async def list_director_models(request):
        try:
            config = load_config()
            runtime = str(request.query.get("runtime") or "LLAMA.CPP").strip().upper()
            if runtime == "OLLAMA":
                configured = config.get("ollama", {}) if isinstance(config, dict) else {}
                settings = dict(configured) if isinstance(configured, dict) else {}
                settings["base_url"] = normalize_ollama_endpoint(
                    request.query.get("endpoint") or settings.get("base_url") or DEFAULT_OLLAMA_ENDPOINT
                )
                result = await asyncio.to_thread(discover_ollama_models, settings)
                payload = result.to_public_mapping()
                payload.update({
                    "ok": True,
                    "runtime": "OLLAMA",
                    "backend": "ollama",
                    "selected_model": str(request.query.get("model") or settings.get("model") or "qwen3.8"),
                })
                return web.json_response(payload)

            settings = config.get("local_llama_cpp", {}) if isinstance(config, dict) else {}
            refresh = str(request.query.get("refresh") or "").strip().lower() in {"1", "true", "yes"}
            result = await asyncio.to_thread(discover_director_profiles, settings, refresh)
            payload = result.to_public_mapping()
            payload.update({
                "ok": True,
                "runtime": "LLAMA.CPP",
                "connection": "not_checked",
                "backend": str(config.get("backend") or "auto") if isinstance(config, dict) else "auto",
            })
            return web.json_response(payload)
        except BackendGenerationError as exc:
            return web.json_response({
                "ok": False,
                "runtime": "OLLAMA",
                "endpoint": str(request.query.get("endpoint") or DEFAULT_OLLAMA_ENDPOINT),
                "selected_model": str(request.query.get("model") or "qwen3.8"),
                "connection": "failure",
                "error": str(exc),
            }, status=503)
        except (ValueError, PromptDirectorError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "Prompt Director model discovery failed unexpectedly."},
                status=500,
            )

    @PromptServer.instance.routes.get(PRESETS_ROUTE_PATH)
    async def list_presets(request):
        presets, warnings = await asyncio.to_thread(list_director_presets)
        return web.json_response({
            "ok": True,
            "default": DEFAULT_DIRECTOR_PRESET,
            "presets": presets,
            "warnings": warnings,
            "storage": str(resolve_user_director_directory()),
        })

    @PromptServer.instance.routes.post(PRESETS_ROUTE_PATH)
    async def save_preset(request):
        try:
            payload = await request.json()
            director, path = await asyncio.to_thread(
                save_user_director,
                payload.get("name"),
                payload.get("instructions"),
                payload.get("recommended_mode"),
            )
            return web.json_response({
                "ok": True,
                "director": director.to_public_mapping(),
                "file": path.name,
            })
        except (DirectorLibraryError, ValueError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "The user Director could not be saved."},
                status=500,
            )

    @PromptServer.instance.routes.delete(PRESETS_ROUTE_PATH)
    async def delete_preset(request):
        try:
            payload = await request.json()
            director, path = await asyncio.to_thread(
                delete_user_director,
                payload.get("name") or payload.get("id"),
            )
            return web.json_response({
                "ok": True,
                "director": director.to_public_mapping(),
                "file": path.name,
            })
        except (DirectorLibraryError, ValueError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "The user Director could not be deleted."},
                status=500,
            )

    @PromptServer.instance.routes.post(TEXT_ROUTE_PATH)
    async def generate_text_prompt(request):
        try:
            payload = await request.json()
            director_request = PromptDirectorRequest.from_mapping(payload)
            result = await asyncio.to_thread(
                PromptDirectorService().generate_text_only,
                director_request,
            )
            return web.json_response({
                "ok": True,
                "prompt": result.prompt,
                "backend": result.backend_name,
                "director_profile": result.director_profile,
                "prompt_model": result.prompt_model,
                "director_preset": result.director_preset,
                "warning": result.warning,
            })
        except (ValueError, PromptDirectorError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "Prompt Director text generation failed unexpectedly."},
                status=500,
            )

    @PromptServer.instance.routes.post(UNLOAD_ROUTE_PATH)
    async def unload_model(request):
        runtime = "LLAMA.CPP"
        selected_model = DEFAULT_OLLAMA_MODEL
        endpoint = DEFAULT_OLLAMA_ENDPOINT
        try:
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            runtime = str(payload.get("runtime") or "LLAMA.CPP").strip().upper()
            if runtime == "OLLAMA":
                config = load_config()
                configured = config.get("ollama", {}) if isinstance(config, dict) else {}
                settings = dict(configured) if isinstance(configured, dict) else {}
                selected_model = str(
                    payload.get("ollama_model") or settings.get("model") or DEFAULT_OLLAMA_MODEL
                ).strip()
                endpoint = normalize_ollama_endpoint(
                    payload.get("ollama_endpoint")
                    or settings.get("base_url")
                    or DEFAULT_OLLAMA_ENDPOINT
                )
                settings.update({"model": selected_model, "base_url": endpoint})
                result = await asyncio.to_thread(unload_ollama_model, settings)
                response = result.to_public_mapping()
                response.update({
                    "ok": True,
                    "message": f"Ollama model '{selected_model}' unloaded from memory; selection preserved.",
                })
                return web.json_response(response)

            status = await asyncio.to_thread(get_process_manager().request_unload)
            messages = {
                "idle": "No Prompt Director model is currently loaded.",
                "pending": "Unload queued until the active Prompt Director operation finishes.",
                "unloaded": "Prompt Director model unloaded.",
            }
            return web.json_response({
                "ok": True,
                "status": status,
                "message": messages[status],
            })
        except BackendGenerationError as exc:
            return web.json_response({
                "ok": False,
                "runtime": runtime,
                "selected_model": selected_model,
                "endpoint": endpoint,
                "connection": "failure",
                "loaded": None,
                "status": "failure",
                "error": str(exc),
            }, status=503)
        except (ValueError, PromptDirectorError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "The Prompt Director model could not be unloaded safely."},
                status=500,
            )

    return True
