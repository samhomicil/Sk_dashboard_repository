#!/usr/bin/env python3
"""
PFG / PFS CustomerFirst Order-Confirmation Email Extractor
Run: python main.py [--since YYYY-MM-DD] [--before YYYY-MM-DD] [--dry-run]
"""
from __future__ import annotations
import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pfg.auth import get_gmail_service
from pfg.categorize import apply_categories
from pfg.config import Config
from pfg.db import ensure_table, load_existing_ids, insert_rows, get_store_watermarks
from pfg.fetch import list_message_ids, fetch_message, extract_text_body, get_header
from pfg.output import CsvWriter, ErrorLog, refresh_xlsx
from pfg.parse import parse_email
from pfg.schema import build_rows, columns
from pfg.state import RunState
from pfg.validate import validate_order

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="PFG email extractor")
    p.add_argument("--since", metavar="YYYY-MM-DD", help="Only fetch mail after this date")
    p.add_argument("--before", metavar="YYYY-MM-DD", help="Only fetch mail before this date")
    p.add_argument("--dry-run", action="store_true", help="Parse only; write nothing")
    p.add_argument("--query", help="Override Gmail search query")
    p.add_argument("--credentials", help="Path to OAuth credentials JSON")
    p.add_argument("--token", help="Path to saved token JSON")
    p.add_argument("--output-dir", help="Output directory")
    p.add_argument("--xlsx", action="store_true", help="Also write XLSX output")
    p.add_argument("--reset-state", action="store_true", help="Clear seen-IDs and start fresh")
    p.add_argument("--week-start", choices=["Mon", "Sun"], help="Week-start day for order_week")
    p.add_argument(
        "--print-watermarks", action="store_true",
        help="Print {store_number: max(order_date)} as JSON and exit -- no Gmail/local state needed. "
             "Used by the cloud routine to decide the Gmail search 'after:' date per store.",
    )
    p.add_argument(
        "--from-json", metavar="PATH",
        help="Skip Gmail auth/fetch entirely and process a pre-fetched JSON file instead: "
             '[{"id": "...", "subject": "...", "body": "..."}, ...]. Used by the cloud routine, '
             "which fetches emails via the Gmail MCP connector (no local OAuth token in the sandbox) "
             "and hands the raw text to this script for parsing/insert/categorize.",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()

    cfg = Config.from_env()

    # CLI overrides
    if args.since:
        cfg.since_date = args.since
    if args.before:
        cfg.before_date = args.before
    if args.dry_run:
        cfg.dry_run = True
    if args.query:
        cfg.gmail_query = args.query
    if args.credentials:
        cfg.credentials_path = args.credentials
    if args.token:
        cfg.token_path = args.token
    if args.output_dir:
        cfg.output_dir = args.output_dir
    if args.xlsx:
        cfg.xlsx_enabled = True
    if args.week_start:
        cfg.week_start = args.week_start

    if args.print_watermarks:
        print(json.dumps(get_store_watermarks(cfg.proxy_url)))
        return

    Path(cfg.output_dir).mkdir(parents=True, exist_ok=True)
    csv_path = str(Path(cfg.output_dir) / cfg.csv_filename)
    xlsx_path = str(Path(cfg.output_dir) / cfg.xlsx_filename)
    errors_path = str(Path(cfg.output_dir) / cfg.errors_filename)

    state = RunState(cfg.state_file)
    if args.reset_state:
        logger.info("Resetting state (clearing seen message IDs)")
        state._data["seen_message_ids"] = []

    col_list = columns(cfg)
    csv_writer = CsvWriter(csv_path, col_list)
    error_log = ErrorLog(errors_path)

    run_ts = datetime.now(timezone.utc)
    logger.info("Run started at %s", run_ts.strftime("%Y-%m-%d %H:%M:%S UTC"))

    # ── Azure SQL setup ───────────────────────────────────────────────────────
    db_existing_ids: set[str] = set()
    if cfg.db_enabled:
        logger.info("Connecting to Azure SQL via proxy %s", cfg.proxy_url)
        ensure_table(cfg.proxy_url)
        db_existing_ids = load_existing_ids(cfg.proxy_url)
        logger.info("  %d existing rows in DB", len(db_existing_ids))

    # ── Fetch: either live Gmail (local OAuth) or pre-fetched JSON (cloud routine) ──
    service = None
    if args.from_json:
        logger.info("Reading pre-fetched emails from %s (no Gmail auth needed)", args.from_json)
        with open(args.from_json) as f:
            message_stubs = json.load(f)
        # Pre-fetched messages have no local "seen" state to check against (a cloud
        # routine clone is fresh every run) -- the caller is responsible for only
        # including messages after the relevant per-store watermark.
    else:
        service = get_gmail_service(cfg.credentials_path, cfg.token_path)
        message_stubs = list_message_ids(
            service,
            query=cfg.gmail_query,
            since=cfg.since_date,
            before=cfg.before_date,
            already_seen=state.seen_ids,
        )

    if not message_stubs:
        logger.info("No new messages found. Exiting.")
        return

    logger.info("Processing %d message(s)...", len(message_stubs))

    # ── Counters ──────────────────────────────────────────────────────────────
    n_parsed_ok = 0
    n_flagged = 0
    n_failed = 0
    n_rows_written = 0

    for stub in message_stubs:
        msg_id = stub["id"]
        try:
            if args.from_json:
                subject = stub.get("subject", "")
                body = stub.get("body", "")
            else:
                message = fetch_message(service, msg_id)
                subject = get_header(message, "Subject")
                body = extract_text_body(message)

            if not body.strip():
                logger.warning("[%s] Empty body — skipping", msg_id)
                error_log.write(msg_id, "", "empty_body", subject)
                n_failed += 1
                state.mark_seen(msg_id)
                continue

            result = parse_email(body, subject)
            h = result.header

            if not h.order_number:
                logger.warning("[%s] Could not extract order number — skipping", msg_id)
                error_log.write(msg_id, "", "no_order_number", subject)
                n_failed += 1
                state.mark_seen(msg_id)
                continue

            logger.info(
                "  Order %s | Store %s | %d items | $%.2f",
                h.order_number,
                h.store_number,
                len(result.items),
                h.order_total or 0,
            )

            # Validation
            vr = validate_order(result, msg_id)
            if vr.flagged:
                n_flagged += 1
                for w in vr.warnings:
                    logger.warning("  FLAGGED: %s", w)
                    error_log.write(msg_id, h.order_number, "validation_warning", w)

            # Unparsed lines
            for uline in result.unparsed_lines:
                error_log.write(msg_id, h.order_number, "unparsed_line", uline)

            # Build output rows
            rows = build_rows(result.header, result.items, msg_id, subject, run_ts, cfg)

            # Write to Azure SQL (primary)
            if cfg.db_enabled:
                db_written = insert_rows(
                    rows, db_existing_ids, cfg.proxy_url, cfg.dry_run
                )
                n_rows_written += db_written
                if db_written:
                    logger.info("    → %d rows → Azure SQL", db_written)

            # Write to CSV (local audit copy, deduped independently)
            csv_writer.write_rows(rows, dry_run=cfg.dry_run)

            n_parsed_ok += 1

            state.mark_seen(msg_id)

        except Exception as exc:
            logger.error("[%s] Unexpected error: %s", msg_id, exc, exc_info=True)
            error_log.write(msg_id, "", "unexpected_error", str(exc))
            n_failed += 1
            # Still mark seen so we don't retry a consistently broken message forever;
            # operator can --reset-state to re-attempt if needed
            state.mark_seen(msg_id)

    # ── Auto-categorize new rows ──────────────────────────────────────────────
    if cfg.db_enabled and n_rows_written > 0:
        logger.info("Auto-categorizing %d new rows...", n_rows_written)
        apply_categories(cfg.proxy_url, dry_run=cfg.dry_run)

    # ── XLSX refresh ──────────────────────────────────────────────────────────
    if cfg.xlsx_enabled and not cfg.dry_run and n_rows_written > 0:
        refresh_xlsx(csv_path, xlsx_path, col_list)

    # ── State save ────────────────────────────────────────────────────────────
    if not cfg.dry_run:
        state.set_last_run(run_ts.isoformat())
        state.save()

    # ── Summary ───────────────────────────────────────────────────────────────
    logger.info(
        "\n── Run summary ────────────────────────────────────\n"
        "  Messages scanned : %d\n"
        "  Parsed OK        : %d\n"
        "  Flagged (warn)   : %d\n"
        "  Failed           : %d\n"
        "  Rows written     : %d\n"
        "  Azure SQL        : %s\n"
        "  CSV (audit)      : %s\n"
        "  Errors log       : %s\n"
        "───────────────────────────────────────────────────",
        len(message_stubs),
        n_parsed_ok,
        n_flagged,
        n_failed,
        n_rows_written,
        "smoothieking.pfg_order_line_items" if (cfg.db_enabled and not cfg.dry_run) else "(disabled or dry-run)",
        csv_path if not cfg.dry_run else "(dry-run, not written)",
        errors_path,
    )


if __name__ == "__main__":
    main()
