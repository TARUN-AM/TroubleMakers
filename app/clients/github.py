"""GitHub REST API client."""

import base64
import re
from typing import Optional
import httpx
from app.config import GITHUB_TOKEN

REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def validate_repo_name(repo: str) -> bool:
    """Validate owner/repo format to prevent malformed queries or injection."""
    return bool(REPO_PATTERN.match(repo.strip()))


class GitHubClient:
    """Client for reading repository files and managing issues."""

    def __init__(self, token: Optional[str] = None) -> None:
        self.token = token or GITHUB_TOKEN
        self.headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "VulnerabilityWatch-Agent/1.0",
        }
        if self.token:
            self.headers["Authorization"] = f"Bearer {self.token}"

    async def get_file_content(self, repo: str, path: str) -> Optional[str]:
        """Fetch raw text content of a file from a GitHub repository."""
        if not validate_repo_name(repo):
            raise ValueError(f"Invalid repository format: {repo}. Expected 'owner/repo'.")

        url = f"https://api.github.com/repos/{repo}/contents/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=self.headers)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()

            data = resp.json()
            if isinstance(data, dict) and data.get("encoding") == "base64":
                raw_bytes = base64.b64decode(data["content"])
                return raw_bytes.decode("utf-8", errors="replace")
            elif isinstance(data, dict) and "content" in data:
                return data["content"]
            return None
