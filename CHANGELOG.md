# Changelog

## 1.0.3

Removed Visual Prompt Director from the public distribution. All primary KoO image-processing and utility nodes remain available. Improved package security and Registry compliance.

- Replace Finisher Open Folder with Copy Path; remove all runtime process and file launching.
- Restrict custom output writes to same-origin localhost requests.
- Validate tests, metadata, version availability and the official archive before publishing.

## 1.0.2 — Registry flagged

- Freeze Finisher preview persistence, A/B wipe, neutral Midtones/Whites/Blacks,
  Auto Save, format dropdown and compact layout fixes.
- Include KoO Multiple Adapter with persisted PLUS/MINUS, +0/+1 offset,
  editable multiple, exact integer arithmetic and strict latent-grid validation.
- Finalize KoO Open Customisation License v1.0 licensing and clean distribution packaging.

- Prepare KoO Nodes Pack Registry metadata and manual-only publishing workflow.
- Declare existing Python runtime dependencies explicitly.
- Exclude private settings, developer reports, installers, models, runtimes and caches from Registry packaging.
- Save new Finisher LUT settings in ComfyUI user data while preserving legacy reads.
- Make desktop folder-opening subprocess calls explicitly shell=False.
- Reject unsafe archive links and path components in the retained optional installer source.
- Preserve every node ID and display name.
- Resolve duplicate legacy crop frontend registration by retaining its old URL as an import of the maintained v4 module.
- Reject cross-origin Finisher writes and restrict desktop folder actions to localhost.
- Make existing unit tests independent of developer models and unrelated sibling projects.

## 1.0.1 — existing local package version

Existing package metadata and README identified version 1.0.1. The older build report describes 1.0.0. No standalone Git release history was available.
