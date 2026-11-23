"""Advisory agent: checks known vulnerabilities for a single package."""

from typing import Any, Dict, List, Optional
from app.clients.osv import OSVClient, compute_fixed_version, extract_severity


async def check_package_vulnerabilities(
    dep: Dict[str, str], osv_client: Optional[OSVClient] = None
) -> List[Dict[str, Any]]:
    """Query OSV for a package and return normalized vulnerability findings."""
    client = osv_client or OSVClient()
    name = dep["name"]
    ecosystem = dep["ecosystem"]
    version = dep["version"]

    vulns = await client.query_package(name=name, ecosystem=ecosystem, version=version)
    findings: List[Dict[str, Any]] = []

    for v in vulns:
        vuln_id = v.get("id", "")
        aliases = v.get("aliases", [])
        severity = extract_severity(v)
        fixed_v = compute_fixed_version(v, version)
        summary = v.get("summary") or (v.get("details") or "")[:200]

        findings.append(
            {
                "package": name,
                "ecosystem": ecosystem,
                "version": version,
                "vuln_id": vuln_id,
                "aliases": aliases,
                "severity": severity,
                "summary": summary,
                "fixed_version": fixed_v,
            }
        )

    return findings
