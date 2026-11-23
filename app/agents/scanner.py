"""Scanner agent: parses requirements.txt and package.json."""

import json
import re
from typing import Any, Dict, List, Optional
from app.clients.github import GitHubClient

DEP_PIN_REGEX = re.compile(
    r"^([a-zA-Z0-9_\-\.]+)\s*(?:==|>=|<=|~=|=~|=)\s*([a-zA-Z0-9_\-\.\+]+)"
)


def parse_requirements(content: str) -> List[Dict[str, str]]:
    """Parse python requirements.txt into list of ecosystem, name, version."""
    dependencies: List[Dict[str, str]] = []
    seen = set()

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue

        # Strip inline comments
        if "#" in line:
            line = line.split("#", 1)[0].strip()

        match = DEP_PIN_REGEX.match(line)
        if match:
            pkg_name = match.group(1).strip()
            version = match.group(2).strip()
            key = ("PyPI", pkg_name.lower())
            if key not in seen:
                seen.add(key)
                dependencies.append(
                    {"ecosystem": "PyPI", "name": pkg_name, "version": version}
                )
    return dependencies


def parse_package_json(content: str) -> List[Dict[str, str]]:
    """Parse javascript package.json into list of ecosystem, name, version."""
    dependencies: List[Dict[str, str]] = []
    seen = set()

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return dependencies

    all_deps: Dict[str, str] = {}
    if isinstance(data.get("dependencies"), dict):
        all_deps.update(data["dependencies"])
    if isinstance(data.get("devDependencies"), dict):
        all_deps.update(data["devDependencies"])

    for name, raw_ver in all_deps.items():
        clean_ver = re.sub(r"^[\^~>=<v]+", "", str(raw_ver).strip())
        # If version has spaces or ranges, take the first valid part
        clean_ver = clean_ver.split()[0].split("-")[0]
        if clean_ver and clean_ver[0].isdigit():
            key = ("npm", name.lower())
            if key not in seen:
                seen.add(key)
                dependencies.append(
                    {"ecosystem": "npm", "name": name, "version": clean_ver}
                )
    return dependencies


async def scan_repo(
    repo: str, github_client: Optional[GitHubClient] = None
) -> List[Dict[str, str]]:
    """Scan repository for dependencies across requirements.txt and package.json."""
    client = github_client or GitHubClient()
    deps: List[Dict[str, str]] = []

    req_content = await client.get_file_content(repo, "requirements.txt")
    if req_content:
        deps.extend(parse_requirements(req_content))

    pkg_content = await client.get_file_content(repo, "package.json")
    if pkg_content:
        deps.extend(parse_package_json(pkg_content))

    return deps
