"""CISA Known Exploited Vulnerabilities (KEV) client and matcher."""

import time
from typing import Any, Dict, List, Optional, Set
import httpx

CISA_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"


class KEVClient:
    """Client for downloading and querying the CISA KEV catalog."""

    def __init__(self, cache_ttl_seconds: int = 3600) -> None:
        self.cache_ttl = cache_ttl_seconds
        self._cve_set: Set[str] = set()
        self._last_fetched: float = 0.0

    async def load_catalog(self, force_refresh: bool = False) -> Set[str]:
        """Download CISA KEV catalog if not cached or expired."""
        now = time.time()
        if not force_refresh and self._cve_set and self._last_fetched > 0 and (now - self._last_fetched) < self.cache_ttl:
            return self._cve_set

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(CISA_KEV_URL)
                resp.raise_for_status()
                data = resp.json()
                vulnerabilities = data.get("vulnerabilities", [])
                new_set = {
                    v["cveID"].strip().upper()
                    for v in vulnerabilities
                    if "cveID" in v and isinstance(v["cveID"], str)
                }
                self._cve_set = new_set
                self._last_fetched = now
        except Exception:
            # Fallback to previously cached set if available, else empty set
            if not self._cve_set:
                self._cve_set = set()

        return self._cve_set

    def is_in_kev(self, vuln_id: str, aliases: Optional[List[str]] = None) -> bool:
        """Check whether vuln_id or any of its aliases are in the KEV catalog."""
        if not self._cve_set:
            return False

        candidates = [vuln_id.strip().upper()]
        if aliases:
            candidates.extend(a.strip().upper() for a in aliases if isinstance(a, str))

        return any(c in self._cve_set for c in candidates if c.startswith("CVE-"))


# Global singleton KEV client for shared run caching
kev_catalog = KEVClient()
