from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import os


@dataclass
class Config:
    # ── Mailbox ────────────────────────────────────────────────────────────────
    target_mailbox: str = ""
    credentials_path: str = "./credentials.json"
    token_path: str = "./token.json"

    # ── Gmail search ──────────────────────────────────────────────────────────
    gmail_query: str = 'subject:("CustomerFirst Confirmation" "PFS Orlando")'
    since_date: Optional[str] = None   # YYYY-MM-DD
    before_date: Optional[str] = None  # YYYY-MM-DD

    # ── Output ────────────────────────────────────────────────────────────────
    output_dir: str = "./out"
    csv_filename: str = "pfg_line_items.csv"
    xlsx_enabled: bool = False
    xlsx_filename: str = "pfg_line_items.xlsx"
    errors_filename: str = "parse_errors.csv"
    state_file: str = "./pfg_state.json"

    # ── Azure SQL ─────────────────────────────────────────────────────────────
    proxy_url: str = "http://127.0.0.1:5001/query"
    db_enabled: bool = True

    # ── Behaviour ─────────────────────────────────────────────────────────────
    week_start: str = "Mon"   # "Mon" or "Sun"
    dry_run: bool = False
    include_category_placeholder: bool = False

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            target_mailbox=os.getenv("PFG_TARGET_MAILBOX", ""),
            credentials_path=os.getenv("PFG_CREDENTIALS_PATH", "./credentials.json"),
            token_path=os.getenv("PFG_TOKEN_PATH", "./token.json"),
            gmail_query=os.getenv(
                "PFG_GMAIL_QUERY",
                'subject:("CustomerFirst Confirmation" "PFS Orlando")',
            ),
            output_dir=os.getenv("PFG_OUTPUT_DIR", "./out"),
            csv_filename=os.getenv("PFG_CSV_FILENAME", "pfg_line_items.csv"),
            xlsx_enabled=os.getenv("PFG_XLSX_ENABLED", "false").lower() == "true",
            xlsx_filename=os.getenv("PFG_XLSX_FILENAME", "pfg_line_items.xlsx"),
            errors_filename=os.getenv("PFG_ERRORS_FILENAME", "parse_errors.csv"),
            state_file=os.getenv("PFG_STATE_FILE", "./pfg_state.json"),
            week_start=os.getenv("PFG_WEEK_START", "Mon"),
            include_category_placeholder=os.getenv(
                "PFG_CATEGORY_PLACEHOLDER", "false"
            ).lower() == "true",
            proxy_url=os.getenv("PFG_PROXY_URL", "http://127.0.0.1:5001/query"),
            db_enabled=os.getenv("PFG_DB_ENABLED", "true").lower() != "false",
        )
