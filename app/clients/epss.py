"""EPSS (Exploit Prediction Scoring System) API client via FIRST.org."""

import time
from typing import Dict, List, Optional
import httpx

EPSS_API_URL = "https://api.first.org/data/v1/epss"


class EPSSClient:
    """Client for fetching live EPSS exploit probabilities for CVEs."""

    def __init__(self, cache_ttl_seconds: int = 3600) -> None:
        self.cache_ttl = cache_ttl_seconds
        self._cache: Dict[str, Dict[str, float]] = {}
        self._last_fetched: Dict[str, float] = {}

    async def get_scores(self, cves: List[str]) -> Dict[str, Dict[str, float]]:
        """Fetch EPSS probability and percentile for a list of CVE IDs."""
        now = time.time()
        normalized_cves = [
            c.strip().upper() for c in cves if c and c.strip().upper().startswith("CVE-")
        ]
        unique_cves = list(set(normalized_cves))

        # Check in-memory cache
        to_fetch = [
            c for c in unique_cves
            if c not in self._cache or (now - self._last_fetched.get(c, 0)) >= self.cache_ttl
        ]

        if not to_fetch:
            return {c: self._cache[c] for c in unique_cves if c in self._cache}

        # Query in batches of up to 50
        batch_size = 50
        for i in range(0, len(to_fetch), batch_size):
            batch = to_fetch[i : i + batch_size]
            cve_param = ",".join(batch)
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(f"{EPSS_API_URL}?cve={cve_param}")
                    if resp.status_code == 200:
                        data = resp.json().get("data", [])
                        for item in data:
                            cve_id = item.get("cve", "").upper()
                            try:
                                score = float(item.get("epss", 0.0))
                                pct = float(item.get("percentile", 0.0))
                                self._cache[cve_id] = {"epss": score, "percentile": pct}
                                self._last_fetched[cve_id] = now
                            except (ValueError, TypeError):
                                pass
            except Exception:
                # Resilient fallback: return whatever is in cache without crashing
                pass

        return {c: self._cache[c] for c in unique_cves if c in self._cache}


# Global singleton EPSS client
epss_client = EPSSClient()
