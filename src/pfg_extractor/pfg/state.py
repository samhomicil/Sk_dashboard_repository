from __future__ import annotations
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_DEFAULT = {"seen_message_ids": [], "last_run_ts": None}


class RunState:
    def __init__(self, state_file: str) -> None:
        self._path = Path(state_file)
        self._data = dict(_DEFAULT)
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            try:
                with open(self._path) as fh:
                    self._data = json.load(fh)
                    # Migrate old format
                    if "seen_message_ids" not in self._data:
                        self._data["seen_message_ids"] = []
            except Exception as exc:
                logger.warning("Could not load state file %s: %s — starting fresh", self._path, exc)
                self._data = dict(_DEFAULT)

    def save(self) -> None:
        try:
            self._path.write_text(json.dumps(self._data, indent=2))
        except Exception as exc:
            logger.error("Failed to save state file: %s", exc)

    @property
    def seen_ids(self) -> set:
        return set(self._data.get("seen_message_ids", []))

    def mark_seen(self, message_id: str) -> None:
        ids = self._data.setdefault("seen_message_ids", [])
        if message_id not in ids:
            ids.append(message_id)

    def set_last_run(self, ts: str) -> None:
        self._data["last_run_ts"] = ts

    @property
    def last_run_ts(self) -> Optional[str]:
        return self._data.get("last_run_ts")
