"""Run backend tests, frontend behavior tests, and ES module syntax checks."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)

run(sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests")
for path in sorted((ROOT / "tests").glob("*.mjs")):
    run("node", "--experimental-vm-modules", str(path))
for path in sorted((ROOT / "web").rglob("*.js")):
    with path.open("rb") as source:
        subprocess.run(["node", "--input-type=module", "--check"], stdin=source, check=True)
print("All backend, frontend and syntax checks passed")
