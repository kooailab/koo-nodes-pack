from __future__ import annotations

from functools import wraps
import ipaddress
from urllib.parse import urlsplit
from aiohttp import web

from .cache import default_output_folder, open_output_folder, render_preview, save_finished_image, select_output_folder
from .processing import load_settings, parse_cube_lut, resolve_lut_path, save_settings, scan_lut_folder
from . import presets


_ROUTES_REGISTERED = False


def _lut_payload() -> dict:
    settings = load_settings()
    scan = scan_lut_folder(settings.get("lut_folder", ""))
    return {"ok": True, "settings": settings, "default_output_folder": default_output_folder(), **scan}


def register_routes() -> bool:
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return True
    try:
        from server import PromptServer
    except Exception:
        return False

    server = getattr(PromptServer, "instance", None)
    if server is None:
        return False

    routes = server.routes

    def guarded_post(path, local_only=False):
        def register(handler):
            @wraps(handler)
            async def guarded(request):
                origin = request.headers.get('Origin')
                if (origin and urlsplit(origin).netloc != request.host) or request.headers.get('Sec-Fetch-Site') == 'cross-site':
                    return web.json_response({'ok': False, 'error': 'Cross-origin request rejected.'}, status=403)
                if local_only:
                    host = urlsplit('//' + request.host).hostname
                    try:
                        local_peer = ipaddress.ip_address(request.remote).is_loopback
                        local_host = host == 'localhost' or ipaddress.ip_address(host).is_loopback
                    except (ValueError, TypeError):
                        local_peer = local_host = False
                    if not local_peer or not local_host:
                        return web.json_response({'ok': False, 'error': 'Desktop folder actions require ComfyUI opened locally using localhost.'}, status=403)
                return await handler(request)
            routes.post(path)(guarded)
            return guarded
        return register

    @routes.get("/koo/finisher/lut_config")
    async def koo_finisher_lut_config(request: web.Request) -> web.Response:
        return web.json_response(_lut_payload())

    @routes.get("/koo/finisher/presets")
    async def koo_finisher_presets(request: web.Request) -> web.Response:
        try:
            preset_id = request.query.get("id")
            if preset_id:
                return web.json_response(presets.preset_payload(preset_id))
            return web.json_response({"ok": True, "presets": presets.list_presets()})
        except (ValueError, OSError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @guarded_post("/koo/finisher/presets")
    async def koo_finisher_mutate_preset(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            action = data.get("action")
            preset_id = data.get("id")
            if action in {"save", "save_as"}:
                preset_id, _ = presets.save_preset(data.get("name"), data.get("settings"), preset_id if action == "save" else None)
            elif action == "rename":
                preset_id, _ = presets.rename_preset(preset_id, data.get("name"))
            elif action == "delete":
                presets.delete_preset(preset_id)
                return web.json_response({"ok": True, "presets": presets.list_presets()})
            elif action == "import":
                preset_id, _ = presets.import_preset(data.get("json"))
            else:
                raise ValueError("Unknown preset action")
            return web.json_response({**presets.preset_payload(preset_id), "presets": presets.list_presets()})
        except (ValueError, OSError, TypeError, AttributeError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @guarded_post("/koo/finisher/lut_config")
    async def koo_finisher_save_lut_config(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            save_settings(str(data.get("lut_folder", "")).strip())
            return web.json_response(_lut_payload())
        except Exception as exc:
            return web.json_response({"ok": False, "error": f"KoO Finisher: could not save LUT folder: {exc}"}, status=400)

    @routes.get("/koo/finisher/luts")
    async def koo_finisher_luts(request: web.Request) -> web.Response:
        return web.json_response(_lut_payload())

    @routes.get("/koo/finisher/lut_data")
    async def koo_finisher_lut_data(request: web.Request) -> web.Response:
        try:
            lut_name = str(request.query.get("name", "")).strip()
            lut_path = resolve_lut_path(lut_name)
            if lut_path is None:
                return web.json_response({"ok": False, "error": f"KoO Finisher: selected LUT not found: {lut_name}"}, status=404)
            cube = parse_cube_lut(lut_path)
            return web.json_response(
                {
                    "ok": True,
                    "name": lut_name,
                    "size": cube.size,
                    "domain_min": cube.domain_min.tolist(),
                    "domain_max": cube.domain_max.tolist(),
                }
            )
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @guarded_post("/koo/finisher/preview")
    async def koo_finisher_preview(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            body = render_preview(
                str(data.get("cache_id", "")),
                data.get("settings") if isinstance(data.get("settings"), dict) else {},
                max_size=int(data.get("max_size", 1200) or 1200),
                index=int(data.get("index", 0) or 0),
                original=bool(data.get("original", False)),
            )
            return web.Response(body=body, content_type="image/png")
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @guarded_post("/koo/finisher/save")
    async def koo_finisher_save(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            return web.json_response(save_finished_image(data))
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @guarded_post("/koo/finisher/open_folder", local_only=True)
    async def koo_finisher_open_folder(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            return web.json_response(open_output_folder(str(data.get("output_folder", "") or "")))
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @guarded_post("/koo/finisher/select_folder", local_only=True)
    async def koo_finisher_select_folder(request: web.Request) -> web.Response:
        try:
            data = await request.json()
            return web.json_response(select_output_folder(str(data.get("output_folder", "") or "")))
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    _ROUTES_REGISTERED = True
    return True
