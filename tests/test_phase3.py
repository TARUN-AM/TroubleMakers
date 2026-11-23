"""Unit tests for Phase 3: Analyst agent, KEV catalog, and fallback mode."""

import pytest
from app.agents.analyst import (
    analyze_findings,
    build_fallback_impact,
    compute_fallback_priority,
)
from app.clients.kev import KEVClient


def test_compute_fallback_priority() -> None:
    """Test deterministic priority mapping."""
    # KEV must always be P0
    assert compute_fallback_priority("LOW", in_kev=True) == "P0"
    assert compute_fallback_priority("UNKNOWN", in_kev=True) == "P0"

    # Severity mappings when not in KEV
    assert compute_fallback_priority("CRITICAL", in_kev=False) == "P0"
    assert compute_fallback_priority("HIGH", in_kev=False) == "P1"
    assert compute_fallback_priority("MEDIUM", in_kev=False) == "P2"
    assert compute_fallback_priority("MODERATE", in_kev=False) == "P2"
    assert compute_fallback_priority("LOW", in_kev=False) == "P3"
    assert compute_fallback_priority("UNKNOWN", in_kev=False) == "P3"


def test_build_fallback_impact() -> None:
    """Test fallback impact text generation."""
    impact_kev = build_fallback_impact("requests", "CVE-2023-1234", "HIGH", True, "Some issue")
    assert "actively exploited according to CISA KEV" in impact_kev

    impact_norm = build_fallback_impact("requests", "GHSA-xxxx", "HIGH", False, "Header leak")
    assert "requests has a high severity vulnerability (GHSA-xxxx): Header leak." == impact_norm


def test_kev_matching_with_mock_catalog() -> None:
    """Test KEVClient matcher with seeded CVEs."""
    client = KEVClient()
    client._cve_set = {"CVE-2021-44228", "CVE-2023-32681"}

    # Direct match on vuln_id
    assert client.is_in_kev("CVE-2021-44228") is True
    assert client.is_in_kev("CVE-2099-0000") is False

    # Match via aliases
    assert client.is_in_kev("GHSA-j8r2-6x86-q33q", ["CVE-2023-32681"]) is True
    assert client.is_in_kev("GHSA-xxxx-yyyy-zzzz", ["CVE-2099-9999"]) is False


@pytest.mark.asyncio
async def test_analyst_fallback_mode_no_api_key() -> None:
    """Verify that Analyst operates deterministically when no API key is provided."""
    import time
    mock_kev = KEVClient()
    mock_kev._cve_set = {"CVE-2023-32681"}
    mock_kev._last_fetched = time.time()

    raw_findings = [
        {
            "package": "requests",
            "ecosystem": "PyPI",
            "version": "2.20.0",
            "vuln_id": "GHSA-j8r2-6x86-q33q",
            "aliases": ["CVE-2023-32681"],
            "severity": "MEDIUM",
            "summary": "Proxy-Authorization header leak",
            "fixed_version": "2.31.0",
        },
        {
            "package": "flask",
            "ecosystem": "PyPI",
            "version": "0.12.2",
            "vuln_id": "GHSA-562c-5r94-xh97",
            "aliases": ["CVE-2018-1000656"],
            "severity": "HIGH",
            "summary": "DoS vulnerability in JSON encoding",
            "fixed_version": "0.12.3",
        },
    ]

    # Explicitly pass api_key="" to test fallback mode
    results = await analyze_findings(raw_findings, kev_client=mock_kev, api_key="")

    assert len(results) == 2

    # First finding matches KEV via alias -> must be P0
    f1 = results[0]
    assert f1["in_kev"] == 1
    assert f1["priority"] == "P0"
    assert "actively exploited" in f1["impact"]

    # Second finding is HIGH severity and not in KEV -> must be P1
    f2 = results[1]
    assert f2["in_kev"] == 0
    assert f2["priority"] == "P1"
    assert "high severity" in f2["impact"]
