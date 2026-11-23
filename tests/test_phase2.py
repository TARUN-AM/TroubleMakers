"""Unit tests for Phase 2: Scanner and OSV integration."""

import pytest
from app.agents.scanner import parse_package_json, parse_requirements
from app.clients.osv import compute_fixed_version, extract_severity


def test_parse_requirements() -> None:
    """Test requirements.txt parsing with various formats and comments."""
    sample = """
    # Primary dependencies
    requests==2.20.0
    flask>=0.12.2 # pinned flask
    urllib3~=1.25.8
    --extra-index-url https://pypi.org/simple
    -r other-requirements.txt
    
    # duplicates should be deduplicated
    requests==2.28.0
    """
    deps = parse_requirements(sample)
    assert len(deps) == 3
    names = [d["name"] for d in deps]
    assert names == ["requests", "flask", "urllib3"]
    assert deps[0]["version"] == "2.20.0"
    assert deps[0]["ecosystem"] == "PyPI"
    assert deps[1]["version"] == "0.12.2"
    assert deps[2]["version"] == "1.25.8"


def test_parse_package_json() -> None:
    """Test package.json parsing with dependencies and devDependencies."""
    sample = """
    {
      "name": "sample-app",
      "dependencies": {
        "lodash": "^4.17.15",
        "express": "~4.16.0"
      },
      "devDependencies": {
        "mocha": ">=8.0.0",
        "invalid-pkg": "git+https://github.com/foo/bar.git"
      }
    }
    """
    deps = parse_package_json(sample)
    assert len(deps) == 3
    dep_dict = {d["name"]: d for d in deps}
    assert "lodash" in dep_dict
    assert dep_dict["lodash"]["version"] == "4.17.15"
    assert dep_dict["lodash"]["ecosystem"] == "npm"
    assert dep_dict["express"]["version"] == "4.16.0"
    assert dep_dict["mocha"]["version"] == "8.0.0"


def test_extract_severity_from_db_specific() -> None:
    """Test severity extraction when database_specific is present."""
    vuln = {"database_specific": {"severity": "HIGH"}}
    assert extract_severity(vuln) == "HIGH"

    vuln_crit = {"database_specific": {"severity": "CRITICAL"}}
    assert extract_severity(vuln_crit) == "CRITICAL"


def test_extract_severity_from_cvss() -> None:
    """Test severity extraction fallback from CVSS vector."""
    vuln = {
        "severity": [
            {
                "type": "CVSS_V3",
                "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",  # 9.8 Critical
            }
        ]
    }
    sev = extract_severity(vuln)
    assert sev in ("CRITICAL", "HIGH")


def test_compute_fixed_version() -> None:
    """Test calculation of lowest safe fixed version greater than current version."""
    vuln = {
        "affected": [
            {
                "ranges": [
                    {
                        "events": [
                            {"introduced": "0"},
                            {"fixed": "2.20.0"},
                            {"fixed": "2.31.0"},
                            {"fixed": "2.25.0"},
                        ]
                    }
                ]
            }
        ]
    }
    # Current is 2.20.0, lowest fix strictly > 2.20.0 is 2.25.0
    fix = compute_fixed_version(vuln, "2.20.0")
    assert fix == "2.25.0"
