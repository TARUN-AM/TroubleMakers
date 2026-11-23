"""CLI demo script: parses dependency files and queries OSV in parallel."""

import asyncio
from pathlib import Path
import sys
import time
from typing import Dict, List

# Ensure project root is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.agents.advisory import check_package_vulnerabilities
from app.agents.scanner import parse_package_json, parse_requirements

DEMO_DIR = ROOT_DIR / "demo"


async def main() -> None:
    """Run parallel advisory check on demo dependencies."""
    print("=" * 70)
    print("Vulnerability Watch - Scanner + OSV Advisory Agent Demo")
    print("=" * 70)

    # 1. Parse requirements.txt
    req_file = DEMO_DIR / "requirements.txt"
    pypi_deps = parse_requirements(req_file.read_text(encoding="utf-8"))
    print(f"[*] Parsed {len(pypi_deps)} Python packages from {req_file.name}")

    # 2. Parse package.json
    pkg_file = DEMO_DIR / "package.json"
    npm_deps = parse_package_json(pkg_file.read_text(encoding="utf-8"))
    print(f"[*] Parsed {len(npm_deps)} npm packages from {pkg_file.name}")

    all_deps = pypi_deps + npm_deps
    print(f"[*] Total packages to check: {len(all_deps)}")
    print(f"[*] Spawning {len(all_deps)} Advisory agents in parallel...\n")

    start_time = time.perf_counter()

    # 3. Parallel execution of advisory agents
    tasks = [check_package_vulnerabilities(dep) for dep in all_deps]
    results: List[List[Dict]] = await asyncio.gather(*tasks)

    elapsed = time.perf_counter() - start_time
    total_findings = sum(len(f) for f in results)

    print(f"[+] All advisory tasks completed in {elapsed:.2f} seconds.")
    print(f"[+] Found {total_findings} total vulnerabilities across {len(all_deps)} packages.\n")

    # 4. Display findings
    print(f"{'PACKAGE':<12} {'ECO':<6} {'VERSION':<10} {'VULN ID':<18} {'SEVERITY':<10} {'FIXED':<12}")
    print("-" * 70)

    for dep, findings in zip(all_deps, results):
        if not findings:
            print(f"{dep['name']:<12} {dep['ecosystem']:<6} {dep['version']:<10} {'(No known vulns)':<18} {'OK':<10} {'-':<12}")
            continue
        for f in findings:
            fixed = f['fixed_version'] or 'None'
            print(f"{f['package']:<12} {f['ecosystem']:<6} {f['version']:<10} {f['vuln_id']:<18} {f['severity']:<10} {fixed:<12}")

    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
