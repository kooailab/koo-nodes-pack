"""Resolve installation resources without retaining a previous portable root."""
from pathlib import Path


def comfy_root():
    try:
        import folder_paths
        return Path(folder_paths.base_path).resolve()
    except (ImportError, AttributeError):
        for parent in Path(__file__).resolve().parents:
            if (parent / "folder_paths.py").is_file():
                return parent
    return None


def portable_path(value):
    path = Path(value).expanduser()
    root = comfy_root()
    if root is None:
        return path
    if not path.is_absolute():
        return root / path
    # Existing absolute paths may be intentional external resources.
    if path.exists():
        return path
    if path.name.casefold() == "comfyui":
        return root
    parts = path.parts
    for index, part in enumerate(parts[:-1]):
        if part.casefold() == "comfyui" and parts[index + 1].casefold() in {
            "models", "tools", "user", "custom_nodes"
        }:
            relative = Path(*parts[index + 1:])
            if relative.parts[0].casefold() == "models":
                try:
                    import folder_paths
                    return Path(folder_paths.models_dir) / Path(*relative.parts[1:])
                except (ImportError, AttributeError):
                    pass
            return root / relative
    return path
