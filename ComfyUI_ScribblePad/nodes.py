import re
from pathlib import Path
from typing import Tuple

from aiohttp import web

from .presets import PresetStore


EXT_DIR = Path(__file__).resolve().parents[1]
STORE = PresetStore(EXT_DIR)


def _is_comment_line(line: str, prefix: str, mode: str) -> bool:
    """Return True when a line should be treated as comment-only content."""
    if not prefix:
        return False
    if mode == "strict":
        return line.startswith(prefix)
    return line.lstrip().startswith(prefix)


def clean_text(text: str, comment_prefix: str = "//", comment_mode: str = "loose") -> str:
    """Remove comment lines while preserving order and non-comment blank lines."""
    lines = (text or "").splitlines(keepends=True)
    kept = [line for line in lines if not _is_comment_line(line, comment_prefix, comment_mode)]
    return "".join(kept)


def estimate_tokens_light(text: str) -> int:
    """Cheap token estimate that behaves reasonably for mixed JP/EN + punctuation text."""
    units = re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE)
    return len(units) if units else 0


def estimate_tokens_exact(text: str) -> int:
    """
    Optional exact path via tiktoken.

    If unavailable in the runtime environment, automatically fallback to light mode.
    """
    try:
        import tiktoken  # type: ignore

        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        return estimate_tokens_light(text)


class ScribblePad:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
                "comment_prefix": ("STRING", {"default": "//"}),
                "comment_mode": (["loose", "strict"], {"default": "loose"}),
                "token_mode": (["light", "exact"], {"default": "light"}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "INT")
    RETURN_NAMES = ("cleaned_text", "char_count", "token_estimate")
    FUNCTION = "run"
    CATEGORY = "Utils/Text"

    def run(self, text: str, comment_prefix: str, comment_mode: str, token_mode: str) -> Tuple[str, int, int]:
        cleaned = clean_text(text, comment_prefix, comment_mode)
        char_count = len(cleaned)
        token_estimate = estimate_tokens_exact(cleaned) if token_mode == "exact" else estimate_tokens_light(cleaned)
        return cleaned, char_count, token_estimate


NODE_CLASS_MAPPINGS = {"ScribblePad": ScribblePad}
NODE_DISPLAY_NAME_MAPPINGS = {"ScribblePad": "ScribblePad"}


def _install_routes():
    """Attach lightweight preset CRUD endpoints to PromptServer when available."""
    try:
        from server import PromptServer
    except Exception:
        return

    routes = PromptServer.instance.routes

    @routes.get("/scribblepad/presets")
    async def list_presets(request):
        return web.json_response(STORE.list())

    @routes.post("/scribblepad/presets")
    async def save_preset(request):
        payload = await request.json()
        name = payload.get("name", "")
        text = payload.get("text", "")
        theme = payload.get("theme", {})
        try:
            data = STORE.upsert(name=name, text=text, theme=theme)
            return web.json_response(data)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)

    @routes.delete("/scribblepad/presets/{name}")
    async def delete_preset(request):
        name = request.match_info.get("name", "")
        try:
            data = STORE.delete(name=name)
            return web.json_response(data)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)


_install_routes()
