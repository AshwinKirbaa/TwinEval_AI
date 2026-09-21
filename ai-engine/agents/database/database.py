"""
Lightweight, fully offline JSON-file-backed store.

No external database server is required (keeps the "offline Windows
support" requirement intact). Used to persist AI-generated answer keys
and question papers across app restarts, keyed by a "paper_id" so a
teacher can generate a key once and reuse it for many students.

This intentionally stays a plain, dependency-free key/value JSON store
rather than sqlite/etc so it's trivial to inspect, back up, or swap out
later.
"""
import json
import os
import threading
from pathlib import Path
from typing import Any, Optional

_DB_DIR = Path(__file__).parent
_DB_FILE = _DB_DIR / "store.json"
_lock = threading.Lock()


def _read_all() -> dict:
    if not _DB_FILE.exists():
        return {}
    try:
        with open(_DB_FILE, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                return {}
            return json.loads(content)
    except (json.JSONDecodeError, OSError):
        return {}


def _write_all(data: dict) -> None:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = _DB_FILE.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, _DB_FILE)  # atomic on both POSIX and Windows


def save(key: str, value: Any) -> None:
    """Persist a JSON-serializable value under `key`."""
    with _lock:
        data = _read_all()
        data[key] = value
        _write_all(data)


def load(key: str, default: Optional[Any] = None) -> Any:
    """Load a previously saved value, or `default` if not found."""
    with _lock:
        data = _read_all()
        return data.get(key, default)


def delete(key: str) -> None:
    with _lock:
        data = _read_all()
        if key in data:
            del data[key]
            _write_all(data)


def list_keys(prefix: str = "") -> list:
    with _lock:
        data = _read_all()
        return [k for k in data.keys() if k.startswith(prefix)]


# -------------------------------------------------------
# Convenience helpers for the paper-evaluation workflow
# -------------------------------------------------------

def save_paper(paper_id: str, questions: list, answer_keys: dict) -> None:
    """
    questions: list of Question.to_dict()
    answer_keys: dict of question_id -> AnswerKey.to_dict()
    """
    save(f"paper:{paper_id}", {"questions": questions, "answer_keys": answer_keys})


def load_paper(paper_id: str) -> Optional[dict]:
    return load(f"paper:{paper_id}")
