# PROJECT_NOTES.md

## Purpose

ComfyUI-ScribblePad is a low-noise prompt editing utility node for ComfyUI.
Primary value:

1. Safe comment-driven prompt editing
2. Fast iterative writing inside graph workflows
3. Reusable presets with constrained/safe storage

## Product Principles

- Utility over flash: keep the UI practical and unobtrusive.
- Preserve user intent: never silently drop non-comment content.
- Keep defaults safe: fixed storage paths, bounded payload sizes.
- Graceful degradation: optional dependencies must have fallbacks.

## Coding Rules (Persistent)

- Prefer pure helper functions for text logic (easy tests/reasoning).
- Keep side effects at edges (HTTP handlers, node runtime wiring).
- Avoid hidden path inputs for filesystem writes.
- Validate all user-provided preset names/text before writing.
- Keep comments meaningful: explain *why*, not obvious *what*.
- Frontend JS should stay dependency-light unless a clear benefit exists (CM6 is an intentional exception for editor quality).
- UI additions must justify screen space in normal node sizes.
- Backward compatibility: preserve existing preset JSON shape when possible.

## Release Rules

- `main` is production.
- Tag only release-quality commits.
- Prefer semver increments (`v0.x.y` while pre-1.0).
- If re-tagging is unavoidable, document it in commit/release notes.
