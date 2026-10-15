"""Validate metadata, runtime policy, and the actual official Registry archive."""
import argparse
import ast
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tomllib
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = ("visual_prompt_director", "apes_prompter", "launcher", "installer", "backup", "credentials", "secrets")
SUFFIXES = {".exe", ".dll", ".bat", ".cmd", ".ps1", ".vbs", ".sh", ".pyc", ".gguf", ".pth", ".pt", ".safetensors", ".pem", ".key"}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def validate_path(name):
    path = PurePosixPath(name)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in name and ":" not in name, f"Unsafe archive path: {name}")
    require(not any(word in name.lower() for word in FORBIDDEN), f"Excluded component: {name}")
    require(path.suffix.lower() not in SUFFIXES, f"Forbidden artifact: {name}")
    require(path.parts[0] not in {"tests", "scripts", ".github", ".git", "node_modules", "user", "models", "runtimes"}, f"Development/private file: {name}")
    require(path.name.lower() not in {".env", "config.json", "settings.json", "install.py", "prestartup_script.py"}, f"Private/startup file: {name}")

def validate_runtime(name, content):
    if name.endswith(".py"):
        tree = ast.parse(content, filename=name)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
                require(not any(n.split(".")[0] in {"subprocess", "ctypes"} for n in names), f"Process/FFI import: {name}")
            if isinstance(node, ast.Call):
                function = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                require(function not in {"eval", "exec", "system", "popen", "Popen", "startfile", "spawnl", "spawnv"}, f"Execution primitive: {name}:{node.lineno}")
    elif name.endswith(".js"):
        require(not re.search(r"\b(?:eval|Function)\s*\(|child_process|/koo/finisher/open_folder", content), f"Frontend execution/launch primitive: {name}")

def validate(check_registry=False, archive=None):
    data = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    project = data["project"]
    require(project["name"] == "koo-nodes-pack", "Wrong node identity")
    require(data["tool"]["comfy"]["PublisherId"] == "koo-ai", "Wrong publisher identity")
    require(project["urls"]["Repository"] == "https://github.com/kooailab/koo-nodes-pack", "Wrong repository")
    version = project["version"]
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version), "Use a stable semantic version")
    current = tuple(map(int, version.split(".")))
    require(current > (1, 0, 2), "Version must exceed flagged 1.0.2")
    require(f'__version__ = "{version}"' in (ROOT / "__init__.py").read_text(), "Root version mismatch")
    requirements = {line.strip() for line in (ROOT / "requirements.txt").read_text().splitlines() if line.strip() and not line.startswith("#")}
    require(set(project["dependencies"]) == requirements == {"aiohttp", "numpy", "Pillow", "torch"}, "Dependency declarations diverge")
    require((ROOT / "LICENSE").is_file(), "Missing license")
    for directory in ("nodes", "shared", "web"):
        for path in (ROOT / directory).rglob("*"):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            name = path.relative_to(ROOT).as_posix()
            validate_path(name)
            if path.suffix in {".py", ".js"}:
                validate_runtime(name, path.read_text(encoding="utf-8"))
    validate_runtime("__init__.py", (ROOT / "__init__.py").read_text(encoding="utf-8"))
    if check_registry:
        url = "https://api.comfy.org/nodes/koo-nodes-pack/versions?include_status_reason=true"
        with urllib.request.urlopen(url, timeout=30) as response:
            versions = json.load(response)
        require(isinstance(versions, list), "Unexpected Registry response; refusing publication")
        existing = [tuple(map(int, item["version"].split("."))) for item in versions]
        require(all(current > item for item in existing), f"Version {version} already exists or is older than Registry history")
    if archive:
        required = {"__init__.py", "pyproject.toml", "requirements.txt", "LICENSE", "README.md"}
        required.update(path.relative_to(ROOT).as_posix() for base in ("nodes", "shared", "web") for path in (ROOT / base).rglob("*") if path.is_file() and "__pycache__" not in path.parts)
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            require(len(names) == len(set(names)), "Duplicate archive entries")
            require(required.issubset(names), f"Missing required files: {sorted(required - set(names))}")
            for item in package.infolist():
                validate_path(item.filename)
                require(not stat.S_ISLNK(item.external_attr >> 16), "Archive symlink forbidden")
                source = ROOT / item.filename
                require(source.is_file() and source.read_bytes() == package.read(item), f"Archive/source mismatch: {item.filename}")
                if source.suffix in {".py", ".js"}:
                    validate_runtime(item.filename, package.read(item).decode("utf-8"))
        print(f"Archive verified: {len(names)} files")
    print(f"Validated koo-ai/koo-nodes-pack {version}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-registry", action="store_true")
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    try:
        validate(args.check_registry, args.archive)
    except Exception as error:
        print(f"Release validation FAILED: {error}", file=sys.stderr)
        sys.exit(1)
