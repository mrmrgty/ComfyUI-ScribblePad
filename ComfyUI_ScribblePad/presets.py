import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

MAX_TEXT_BYTES = 100 * 1024
NAME_RE = re.compile(r"^[^/\\]{1,64}$")
RESERVED_SEQS = ("..",)


def _safe_name(name: str) -> bool:
    if not isinstance(name, str):
        return False
    if not NAME_RE.match(name):
        return False
    return not any(seq in name for seq in RESERVED_SEQS)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PresetStore:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.data_dir = base_dir / "user_data"
        self.path = self.data_dir / "presets.json"

    def ensure(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text(json.dumps({"presets": []}, ensure_ascii=False, indent=2), encoding="utf-8")

    def load(self) -> Dict[str, List[Dict[str, Any]]]:
        self.ensure()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = {"presets": []}
        if not isinstance(data, dict) or "presets" not in data or not isinstance(data["presets"], list):
            data = {"presets": []}
        return data

    def save(self, data: Dict[str, Any]) -> None:
        self.ensure()
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def list(self) -> Dict[str, Any]:
        return self.load()

    def upsert(self, name: str, text: str, theme: Dict[str, str] | None = None) -> Dict[str, Any]:
        if not _safe_name(name):
            raise ValueError("invalid preset name")
        encoded = (text or "").encode("utf-8")
        if len(encoded) > MAX_TEXT_BYTES:
            raise ValueError("text too large (>100KB)")
        payload = self.load()
        presets = payload["presets"]
        existing = next((p for p in presets if p.get("name") == name), None)
        entry = {
            "name": name,
            "text": text or "",
            "theme": theme or {},
            "updated_at": _now_iso(),
        }
        if existing is None:
            presets.append(entry)
        else:
            existing.update(entry)
        self.save(payload)
        return payload

    def delete(self, name: str) -> Dict[str, Any]:
        if not _safe_name(name):
            raise ValueError("invalid preset name")
        payload = self.load()
        payload["presets"] = [p for p in payload["presets"] if p.get("name") != name]
        self.save(payload)
        return payload
