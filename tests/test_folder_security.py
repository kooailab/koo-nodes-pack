import ast
from pathlib import Path
import unittest
from test_koo_finisher import cache

ROOT = Path(__file__).resolve().parents[1]

class FolderSecurityTests(unittest.TestCase):
    def test_runtime_cannot_launch_programs(self):
        for path in [ROOT / "__init__.py", *(ROOT / "nodes").rglob("*.py"), *(ROOT / "shared").rglob("*.py")]:
            with self.subTest(path=str(path)):
                tree = ast.parse(path.read_text(encoding="utf-8"))
                for node in ast.walk(tree):
                    if isinstance(node, (ast.Import, ast.ImportFrom)):
                        names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
                        self.assertFalse(any(n.split(".")[0] in {"subprocess", "ctypes"} for n in names))
                    if isinstance(node, ast.Call):
                        name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                        self.assertNotIn(name, {"eval", "exec", "system", "popen", "Popen", "startfile", "spawnl", "spawnv"})
        self.assertFalse(hasattr(cache, "open_output_folder"))

    def test_frontend_copies_path_without_launch_route(self):
        source = (ROOT / "web/koo_finisher.js").read_text(encoding="utf-8")
        self.assertIn("navigator.clipboard.writeText(folder)", source)
        self.assertNotIn("/koo/finisher/open_folder", source)
        self.assertNotIn("open_output_folder", (ROOT / "nodes/koo_finisher/routes.py").read_text())

if __name__ == "__main__":
    unittest.main()
