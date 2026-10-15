# Release process

The Registry identity is `koo-ai/koo-nodes-pack`; the repository is
https://github.com/kooailab/koo-nodes-pack (the former owner URL redirects here).

1. Work in an isolated checkout and back up uncommitted changes. Never change the
   separate Apes repository or the production ComfyUI installation.
2. Read the Registry versions API with `include_status_reason=true`. Select an
   unused semantic version above every existing version; update `pyproject.toml`
   and root `__version__` together. Never overwrite a published version.
3. Run `python -m unittest discover -s tests`, then every `tests/*.mjs` with
   `node --experimental-vm-modules`. Use a Python environment with requirements
   installed and `COMFYUI_ROOT` pointing to a clean ComfyUI source checkout
   (the workflow pins its revision). Run
   `python scripts/validate_release.py --check-registry`.
4. Install the pinned comfy-cli from the workflow, run `comfy node pack`, and
   inspect it using `python scripts/validate_release.py --archive node.zip`.
   Tests, scripts and workflow code must not ship. Director, Apes, launchers,
   credentials, backups and executables are forbidden.
5. Test this archive in a disposable ComfyUI with isolated input/output/user/temp
   directories. Verify 25 node registrations, frontend assets and representative
   workflows. Do not use unrelated custom nodes.
6. Commit and push to main. Changes to pyproject.toml trigger the publishing
   workflow; manual dispatch is also supported. It runs tests and validation
   before the official Comfy-Org publishing action. Existing
   `REGISTRY_ACCESS_TOKEN` must belong to publisher `koo-ai`; configure it in
   repository Actions secrets, never in source or logs. Do not replace a valid key.
7. Read the Actions result and Registry API again. Upload success is not approval:
   report pending/flagged honestly, and check latest_version and node extraction.
8. Once ACTIVE, install the exact version using ComfyUI Manager in a fresh
   environment, verify startup/registrations/assets and record evidence. Create
   the release tag only for the verified published commit.

Concurrency serializes workflow publication. The availability check fails closed
on API errors or existing versions. A failed or pending moderation result needs
investigation, never a blind duplicate upload. For a clean flagged release prepare
a manual review request with version, commit, reason and audit/test evidence.
