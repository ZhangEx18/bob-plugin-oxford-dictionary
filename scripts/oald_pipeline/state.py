from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


STAGE_TABLES = {
    "extract_lookup": "key",
    "extract_links": "key",
    "normalized_entries": "key",
    "relation_parents": "key",
    "relation_edges": "key",
    "blocked_forms": "key",
    "final_entries": "key",
    "build_metrics": "key",
    "meta": "key",
}


class StateStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self._ensure_schema()

    def close(self) -> None:
        self.conn.close()

    def _ensure_schema(self) -> None:
        for table, key_name in STAGE_TABLES.items():
            self.conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    {key_name} TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
        self.conn.commit()

    def clear_table(self, table: str) -> None:
        self.conn.execute(f"DELETE FROM {table}")
        self.conn.commit()

    def replace_many(self, table: str, rows: list[tuple[str, Any]]) -> None:
        self.clear_table(table)
        self.conn.executemany(
            f"INSERT OR REPLACE INTO {table} (key, payload) VALUES (?, ?)",
            [(key, json.dumps(payload, ensure_ascii=False)) for key, payload in rows],
        )
        self.conn.commit()

    def replace_many_chunked(self, table: str, rows: list[tuple[str, Any]], chunk_size: int = 5000) -> None:
        self.clear_table(table)
        for index in range(0, len(rows), chunk_size):
            chunk = rows[index:index + chunk_size]
            self.conn.executemany(
                f"INSERT OR REPLACE INTO {table} (key, payload) VALUES (?, ?)",
                [(key, json.dumps(payload, ensure_ascii=False)) for key, payload in chunk],
            )
            self.conn.commit()

    def upsert_one(self, table: str, key: str, payload: Any) -> None:
        self.conn.execute(
            f"INSERT OR REPLACE INTO {table} (key, payload) VALUES (?, ?)",
            (key, json.dumps(payload, ensure_ascii=False)),
        )
        self.conn.commit()

    def upsert_many_chunked(self, table: str, rows: list[tuple[str, Any]], chunk_size: int = 5000) -> None:
        for index in range(0, len(rows), chunk_size):
            chunk = rows[index:index + chunk_size]
            self.conn.executemany(
                f"INSERT OR REPLACE INTO {table} (key, payload) VALUES (?, ?)",
                [(key, json.dumps(payload, ensure_ascii=False)) for key, payload in chunk],
            )
            self.conn.commit()

    def load_all(self, table: str) -> dict[str, Any]:
        rows = self.conn.execute(f"SELECT key, payload FROM {table}").fetchall()
        return {key: json.loads(payload) for key, payload in rows}

    def iter_rows(self, table: str, chunk_size: int = 1000):
        cursor = self.conn.execute(f"SELECT key, payload FROM {table}")
        while True:
            rows = cursor.fetchmany(chunk_size)
            if not rows:
                break
            for key, payload in rows:
                yield key, json.loads(payload)

    def load_one(self, table: str, key: str) -> Any | None:
        row = self.conn.execute(
            f"SELECT payload FROM {table} WHERE key = ?",
            (key,),
        ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def has_key(self, table: str, key: str) -> bool:
        row = self.conn.execute(
            f"SELECT 1 FROM {table} WHERE key = ? LIMIT 1",
            (key,),
        ).fetchone()
        return row is not None
