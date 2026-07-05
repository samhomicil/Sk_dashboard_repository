from __future__ import annotations
import os
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def get_gmail_service(credentials_path: str, token_path: str):
    """Return an authenticated Gmail API service object."""
    creds = None

    if Path(token_path).exists():
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception:
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as exc:
                print(
                    f"\n[AUTH ERROR] Token refresh failed: {exc}\n"
                    "Delete token.json and re-run to trigger a new OAuth flow.",
                    file=sys.stderr,
                )
                sys.exit(1)
        else:
            if not Path(credentials_path).exists():
                print(
                    f"\n[AUTH ERROR] Credentials file not found: {credentials_path}\n"
                    "Download OAuth 2.0 credentials from Google Cloud Console "
                    "(APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON) "
                    f"and save to {credentials_path}.",
                    file=sys.stderr,
                )
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(token_path, "w") as fh:
            fh.write(creds.to_json())

    try:
        service = build("gmail", "v1", credentials=creds)
        return service
    except Exception as exc:
        print(f"\n[AUTH ERROR] Failed to build Gmail service: {exc}", file=sys.stderr)
        sys.exit(1)
