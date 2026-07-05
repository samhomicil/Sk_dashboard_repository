from __future__ import annotations
import base64
import logging
import time
from typing import Generator, Optional

import html2text

logger = logging.getLogger(__name__)


def _build_query(base_query: str, since: Optional[str], before: Optional[str]) -> str:
    """Append date filters to the base Gmail search query."""
    parts = [base_query]
    if since:
        # Gmail uses after:YYYY/MM/DD
        parts.append(f"after:{since.replace('-', '/')}")
    if before:
        parts.append(f"before:{before.replace('-', '/')}")
    return " ".join(parts)


def list_message_ids(
    service,
    query: str,
    since: Optional[str] = None,
    before: Optional[str] = None,
    already_seen: Optional[set] = None,
) -> list[dict]:
    """Return list of {id, threadId} dicts matching the query, excluding already_seen."""
    full_query = _build_query(query, since, before)
    logger.info("Gmail query: %s", full_query)

    results = []
    page_token = None

    while True:
        kwargs = {"userId": "me", "q": full_query, "maxResults": 500}
        if page_token:
            kwargs["pageToken"] = page_token

        resp = service.users().messages().list(**kwargs).execute()
        messages = resp.get("messages", [])

        for msg in messages:
            if already_seen and msg["id"] in already_seen:
                continue
            results.append(msg)

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    logger.info("Found %d new messages", len(results))
    return results


def fetch_message(service, message_id: str) -> dict:
    """Fetch full message payload for a given message id."""
    return (
        service.users()
        .messages()
        .get(userId="me", id=message_id, format="full")
        .execute()
    )


def _decode_part(part: dict) -> Optional[str]:
    """Base64-decode a message part's body data."""
    data = part.get("body", {}).get("data", "")
    if not data:
        return None
    return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")


def extract_text_body(message: dict) -> str:
    """Extract plain text from a Gmail message, preferring text/plain."""
    payload = message.get("payload", {})
    return _extract_from_payload(payload)


def _extract_from_payload(payload: dict) -> str:
    mime = payload.get("mimeType", "")

    if mime == "text/plain":
        text = _decode_part(payload)
        return text or ""

    if mime == "text/html":
        html = _decode_part(payload)
        if html:
            h = html2text.HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            h.body_width = 0
            return h.handle(html)
        return ""

    # multipart/* — recurse through parts, prefer plain
    parts = payload.get("parts", [])
    plain_parts = [p for p in parts if p.get("mimeType") == "text/plain"]
    html_parts = [p for p in parts if p.get("mimeType") == "text/html"]
    other_parts = [
        p for p in parts if p.get("mimeType", "").startswith("multipart/")
    ]

    for p in plain_parts:
        text = _decode_part(p)
        if text:
            return text

    for p in other_parts:
        text = _extract_from_payload(p)
        if text:
            return text

    for p in html_parts:
        html = _decode_part(p)
        if html:
            h = html2text.HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            h.body_width = 0
            return h.handle(html)

    return ""


def get_header(message: dict, name: str) -> str:
    headers = message.get("payload", {}).get("headers", [])
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""
