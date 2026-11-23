"""Analyst agent: evaluates severity, KEV status, LLM impact & priority."""

import json
from typing import Any, Dict, List, Optional
import anthropic

from app.clients.kev import KEVClient, kev_catalog
from app.config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL

SYSTEM_PROMPT = (
    "You are a senior application security engineer. Given a vulnerability, the package, "
    "whether it is actively exploited (CISA KEV), and the severity, write a 2-sentence "
    "plain-English impact statement for a developer who uses this library, and assign "
    "priority P0 (exploited or critical), P1 (high), P2 (medium), P3 (low). Respond with JSON only."
)


def compute_fallback_priority(severity: str, in_kev: bool) -> str:
    """Deterministic priority assignment when LLM is unavailable."""
    if in_kev or severity.upper() == "CRITICAL":
        return "P0"
    if severity.upper() == "HIGH":
        return "P1"
    if severity.upper() in ("MEDIUM", "MODERATE"):
        return "P2"
    return "P3"


def build_fallback_impact(pkg: str, vuln_id: str, severity: str, in_kev: bool, summary: str) -> str:
    """Deterministic plain-English impact statement."""
    if in_kev:
        return (
            f"{pkg} is affected by {vuln_id}, which is actively exploited according to CISA KEV. "
            f"Immediate upgrade is required to mitigate active attacks."
        )
    clean_summary = summary.strip().rstrip(".")
    if clean_summary:
        return f"{pkg} has a {severity.lower()} severity vulnerability ({vuln_id}): {clean_summary}."
    return f"{pkg} is vulnerable to {vuln_id} with assessed {severity.lower()} severity impact."


async def _call_llm_for_batch(batch: List[Dict[str, Any]], client: anthropic.AsyncAnthropic) -> Optional[List[Dict[str, str]]]:
    """Invoke Anthropic API for a batch of findings, returning parsed JSON."""
    prompt_payload = [
        {
            "vuln_id": f["vuln_id"],
            "package": f["package"],
            "version": f["version"],
            "severity": f["severity"],
            "in_kev": bool(f.get("in_kev")),
            "summary": f.get("summary", ""),
        }
        for f in batch
    ]
    user_msg = (
        f"Analyze these {len(batch)} vulnerabilities and return a JSON list of objects with keys: "
        f"'vuln_id', 'priority' ('P0'|'P1'|'P2'|'P3'), and 'impact' (2 plain sentences):\n"
        f"{json.dumps(prompt_payload)}"
    )

    for attempt in range(2):
        try:
            response = await client.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=1500,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            raw_text = response.content[0].text.strip()
            # Clean markdown code blocks if wrapped
            if raw_text.startswith("```"):
                raw_text = raw_text.split("\n", 1)[-1]
                if raw_text.endswith("```"):
                    raw_text = raw_text.rsplit("```", 1)[0].strip()
            parsed = json.loads(raw_text)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            if attempt == 1:
                return None
    return None


async def analyze_findings(
    findings: List[Dict[str, Any]],
    kev_client: Optional[KEVClient] = None,
    api_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Analyze a list of findings: check KEV and assign priority & impact."""
    kev = kev_client or kev_catalog
    await kev.load_catalog()

    # Step 1: Check KEV for each finding
    for f in findings:
        f["in_kev"] = 1 if kev.is_in_kev(f["vuln_id"], f.get("aliases")) else 0

    key = api_key if api_key is not None else ANTHROPIC_API_KEY
    llm_results: Dict[str, Dict[str, str]] = {}

    if key:
        client = anthropic.AsyncAnthropic(api_key=key)
        # Process in batches of 10
        batch_size = 10
        for i in range(0, len(findings), batch_size):
            batch = findings[i : i + batch_size]
            batch_resp = await _call_llm_for_batch(batch, client)
            if batch_resp:
                for item in batch_resp:
                    if isinstance(item, dict) and "vuln_id" in item:
                        llm_results[item["vuln_id"]] = item

    # Step 2: Merge LLM result or apply deterministic fallback
    analyzed: List[Dict[str, Any]] = []
    for f in findings:
        v_id = f["vuln_id"]
        in_kev_bool = bool(f["in_kev"])
        sev = f.get("severity", "UNKNOWN")

        if v_id in llm_results:
            prio = llm_results[v_id].get("priority")
            impact = llm_results[v_id].get("impact")
        else:
            prio = None
            impact = None

        # Validate priority format
        if prio not in ("P0", "P1", "P2", "P3"):
            prio = compute_fallback_priority(sev, in_kev_bool)

        if not impact or not isinstance(impact, str):
            impact = build_fallback_impact(
                f["package"], v_id, sev, in_kev_bool, f.get("summary", "")
            )

        f_copy = dict(f)
        f_copy["priority"] = prio
        f_copy["impact"] = impact
        analyzed.append(f_copy)

    return analyzed
