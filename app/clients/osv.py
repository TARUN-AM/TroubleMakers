"""OSV (Open Source Vulnerabilities) API client and helper functions."""

from typing import Any, Dict, List, Optional
import httpx
from cvss import CVSS3
from packaging.version import InvalidVersion, Version, parse as parse_version

OSV_QUERY_URL = "https://api.osv.dev/v1/query"


def extract_severity(vuln: Dict[str, Any]) -> str:
    """Determine normalized severity (CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN)."""
    db_specific = vuln.get("database_specific") or {}
    sev = db_specific.get("severity")
    if isinstance(sev, str) and sev.strip():
        sev_upper = sev.strip().upper()
        if "CRIT" in sev_upper:
            return "CRITICAL"
        if "HIGH" in sev_upper:
            return "HIGH"
        if "MED" in sev_upper or "MOD" in sev_upper:
            return "MEDIUM"
        if "LOW" in sev_upper:
            return "LOW"

    for s_entry in vuln.get("severity", []):
        score_type = s_entry.get("type", "")
        vector = s_entry.get("score", "")
        if "CVSS" in score_type.upper() and vector:
            try:
                cvss_obj = CVSS3(vector)
                severities = cvss_obj.severities()
                if severities and severities[0]:
                    return severities[0].upper()
            except Exception:
                continue

    return "UNKNOWN"


def compute_fixed_version(vuln: Dict[str, Any], current_ver_str: str) -> Optional[str]:
    """Find the lowest fixed version strictly greater than current version."""
    try:
        current_v = parse_version(current_ver_str)
    except InvalidVersion:
        current_v = None

    candidate_fixes: List[Version] = []
    raw_candidates: List[str] = []

    for aff in vuln.get("affected", []):
        for rng in aff.get("ranges", []):
            for ev in rng.get("events", []):
                fix = ev.get("fixed")
                if fix:
                    raw_candidates.append(fix)
                    try:
                        parsed = parse_version(fix)
                        if current_v is None or parsed > current_v:
                            candidate_fixes.append(parsed)
                    except InvalidVersion:
                        pass

    if candidate_fixes:
        candidate_fixes.sort()
        return str(candidate_fixes[0])
    return raw_candidates[0] if raw_candidates else None


class OSVClient:
    """Async client for querying the OSV database."""

    def __init__(self, timeout: float = 12.0) -> None:
        self.timeout = timeout

    async def query_package(
        self, name: str, ecosystem: str, version: str
    ) -> List[Dict[str, Any]]:
        """Query OSV for vulnerabilities in a specific package and version."""
        payload = {
            "package": {"name": name, "ecosystem": ecosystem},
            "version": version,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(OSV_QUERY_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("vulns", [])
