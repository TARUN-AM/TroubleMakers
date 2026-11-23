/**
 * Vulnerability Watch - Frontend JavaScript application
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

/* ==================== DASHBOARD ==================== */

async function loadRuns() {
  const tbody = document.getElementById("runs-table-body");
  if (!tbody) return;

  try {
    const res = await fetch("/api/runs");
    const data = await res.json();
    const runs = data.runs || [];

    if (runs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No scan runs recorded yet. Start a scan above!</td></tr>`;
      return;
    }

    tbody.innerHTML = runs.map(r => {
      const urgentBadge = r.urgent
        ? `<span class="badge-urgent">URGENT</span>`
        : `<span style="color: var(--ink-2); font-size: 11px;">Normal</span>`;
      return `
        <tr>
          <td class="mono">#${r.id}</td>
          <td class="mono"><strong><a href="/runs/${r.id}">${escapeHtml(r.repo)}</a></strong></td>
          <td><span class="mono" style="font-size: 11px;">${escapeHtml(r.trigger)}</span></td>
          <td><span class="badge-status status-${r.status}">${r.status}</span></td>
          <td>${urgentBadge}</td>
          <td><span class="mono">${r.findings_count || 0}</span></td>
          <td style="color: var(--ink-2); font-size: 12px;">${formatDate(r.started_at)}</td>
          <td><a href="/runs/${r.id}" class="btn btn-secondary btn-sm">View &rarr;</a></td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Failed to load runs:", err);
  }
}

async function loadWatchedRepos() {
  const container = document.getElementById("watched-list");
  const countEl = document.getElementById("watched-count");
  if (!container) return;

  try {
    const res = await fetch("/api/repos");
    const data = await res.json();
    const repos = data.repos || [];

    if (countEl) countEl.textContent = `${repos.filter(r => r.watched).length} active`;

    if (repos.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No watched repositories configured yet.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${repos.map(r => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg);">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="mono" style="font-weight: 500;">${escapeHtml(r.full_name)}</span>
              <span class="badge ${r.watched ? 'status-done' : 'status-pending'}">${r.watched ? 'Auto-scan Active' : 'Paused'}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button onclick="toggleWatchedRepo(${r.id})" class="btn btn-secondary btn-sm">
                ${r.watched ? 'Pause' : 'Activate'}
              </button>
              <button onclick="deleteWatchedRepo(${r.id})" class="btn btn-secondary btn-sm" style="color: var(--p0);" title="Remove repo">
                &times;
              </button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    console.error("Failed to load watched repos:", err);
  }
}

async function toggleWatchedRepo(repoId) {
  try {
    await fetch(`/api/repos/${repoId}`, { method: "PATCH" });
    await loadWatchedRepos();
  } catch (err) {
    alert("Failed to toggle repository: " + err);
  }
}

async function deleteWatchedRepo(repoId) {
  if (!confirm("Remove this repository from watch list?")) return;
  try {
    await fetch(`/api/repos/${repoId}`, { method: "DELETE" });
    await loadWatchedRepos();
  } catch (err) {
    alert("Failed to delete repository: " + err);
  }
}

function initDashboard() {
  loadRuns();
  loadWatchedRepos();

  const refreshBtn = document.getElementById("btn-refresh-runs");
  if (refreshBtn) refreshBtn.addEventListener("click", loadRuns);

  const scanForm = document.getElementById("scan-form");
  if (scanForm) {
    scanForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const repoInput = document.getElementById("repo-input");
      const injectCheck = document.getElementById("inject-failure-check");
      const repo = repoInput.value.trim();
      if (!repo) return;

      const btn = document.getElementById("btn-scan");
      btn.disabled = true;
      btn.textContent = "Starting...";

      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: repo,
            inject_failure: injectCheck ? injectCheck.checked : false,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          alert(err.detail || "Error starting scan run");
          btn.disabled = false;
          btn.textContent = "Scan";
          return;
        }

        const data = await res.json();
        window.location.href = `/runs/${data.run_id}`;
      } catch (err) {
        alert("Failed to trigger scan: " + err);
        btn.disabled = false;
        btn.textContent = "Scan";
      }
    });
  }

  const simPushBtn = document.getElementById("btn-simulate-push");
  if (simPushBtn) {
    simPushBtn.addEventListener("click", async () => {
      const repoInput = document.getElementById("repo-input");
      let repo = repoInput.value.trim();
      if (!repo) repo = "demo/vulnerable-app";

      simPushBtn.disabled = true;
      simPushBtn.textContent = "Simulating...";

      try {
        const res = await fetch("/api/simulate-push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: repo,
            touched_files: ["requirements.txt", "package.json"],
          }),
        });
        const data = await res.json();
        if (data.run_id) {
          window.location.href = `/runs/${data.run_id}`;
        }
      } catch (err) {
        alert("Simulation failed: " + err);
        simPushBtn.disabled = false;
        simPushBtn.textContent = "Simulate push";
      }
    });
  }

  const addRepoForm = document.getElementById("add-repo-form");
  if (addRepoForm) {
    addRepoForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("add-repo-input");
      const val = input.value.trim();
      if (!val) return;

      try {
        const res = await fetch("/api/repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_name: val }),
        });
        if (res.ok) {
          input.value = "";
          await loadWatchedRepos();
        } else {
          const err = await res.json();
          alert(err.detail || "Failed to add repo");
        }
      } catch (err) {
        alert("Error adding repo: " + err);
      }
    });
  }
}

/* ==================== RUN DETAIL ==================== */

let activeEventSource = null;
const tasksMap = new Map();

function renderTaskRow(task) {
  let attemptStr = "";
  if (task.attempts > 1) {
    attemptStr = ` <span style="font-size: 11px; color: var(--ink-2);">(attempt ${task.attempts} of 3)</span>`;
  }
  return `
    <div class="timeline-row fade-in" id="task-row-${task.id}">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="badge" style="background: var(--bg); color: var(--ink); border: 1px solid var(--line);">${escapeHtml(task.agent)}</span>
        <span class="mono" style="font-size: 12px;">${escapeHtml(task.label)}</span>
        ${attemptStr}
      </div>
      <div>
        <span class="badge-status status-${task.status}">${task.status}</span>
      </div>
    </div>
  `;
}

function appendLogEntry(logStream, event) {
  const div = document.createElement("div");
  div.className = "log-entry";
  const ts = formatDate(event.ts);
  div.innerHTML = `
    <span class="log-ts">[${ts}]</span>
    <span class="log-agent">${escapeHtml(event.agent)}</span>
    <span>${escapeHtml(event.message)}</span>
  `;
  logStream.appendChild(div);
  logStream.scrollTop = logStream.scrollHeight;
}

function renderFindings(findings) {
  const container = document.getElementById("findings-container");
  const countEl = document.getElementById("finding-count");
  if (!container) return;

  if (countEl) countEl.textContent = `${findings.length} findings`;

  if (findings.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No vulnerability findings reported.</p></div>`;
    return;
  }

  // Sort: P0 first
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const sorted = [...findings].sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3));

  container.innerHTML = sorted.map(f => {
    const prio = f.priority || 'P3';
    const kevBadge = f.in_kev ? `<span class="badge-kev">CISA KEV EXPLOITED</span>` : '';
    const fixedText = f.fixed_version ? `&rarr; Upgrade to <strong>${escapeHtml(f.fixed_version)}</strong>` : 'No safe fix available';

    return `
      <div class="finding-item">
        <div class="finding-header">
          <div class="finding-meta">
            <span class="badge badge-${prio.toLowerCase()}">${prio}</span>
            <span class="mono" style="font-weight: 600; font-size: 13px;">${escapeHtml(f.package)} @ ${escapeHtml(f.version)}</span>
            <span class="badge" style="background: #F3F4F6; color: var(--ink-2);">${escapeHtml(f.ecosystem)}</span>
            ${kevBadge}
          </div>
          <div>
            <a href="https://osv.dev/vulnerability/${escapeHtml(f.vuln_id)}" target="_blank" rel="noopener" class="mono" style="font-size: 11px;">${escapeHtml(f.vuln_id)} &nearr;</a>
          </div>
        </div>
        <div style="font-size: 12px; color: var(--accent); margin-bottom: 4px;" class="mono">
          ${fixedText}
        </div>
        <div class="finding-impact">
          ${escapeHtml(f.impact || f.summary || "No detailed impact text.")}
        </div>
      </div>
    `;
  }).join("");
}

async function loadRunDetail(runId) {
  try {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return;
    const data = await res.json();
    const run = data.run;

    // Update Header
    document.getElementById("run-repo").textContent = run.repo;
    document.getElementById("run-trigger").textContent = run.trigger;
    document.getElementById("run-started").textContent = formatDate(run.started_at);

    const statusBadge = document.getElementById("run-status");
    statusBadge.className = `badge-status status-${run.status}`;
    statusBadge.textContent = run.status;

    const badgesContainer = document.getElementById("run-badges");
    if (run.urgent && !document.getElementById("urgent-badge-pill")) {
      const urgentPill = document.createElement("span");
      urgentPill.id = "urgent-badge-pill";
      urgentPill.className = "badge-urgent";
      urgentPill.textContent = "URGENT";
      badgesContainer.prepend(urgentPill);
    }

    if (run.issue_url) {
      const issueContainer = document.getElementById("run-issue-container");
      const issueLink = document.getElementById("run-issue-link");
      if (issueContainer && issueLink) {
        issueContainer.style.display = "inline";
        issueLink.href = run.issue_url;
      }
    }

    const progressBar = document.getElementById("run-progress");
    if (run.status === "done" || run.status === "failed") {
      progressBar.classList.remove("active");
    }

    // Tasks Timeline
    const timelineList = document.getElementById("timeline-list");
    const taskCountEl = document.getElementById("task-count");
    if (data.tasks && data.tasks.length > 0) {
      timelineList.innerHTML = "";
      data.tasks.forEach(t => {
        tasksMap.set(t.id, t);
        timelineList.insertAdjacentHTML("beforeend", renderTaskRow(t));
      });
      if (taskCountEl) taskCountEl.textContent = `${data.tasks.length} tasks`;
    }

    // Events Log
    const logStream = document.getElementById("log-stream");
    if (data.events && data.events.length > 0) {
      logStream.innerHTML = "";
      data.events.forEach(ev => appendLogEntry(logStream, ev));
    }

    // Findings
    renderFindings(data.findings || []);

    // Issue Preview
    const previewBox = document.getElementById("issue-preview-box");
    const issueStatus = document.getElementById("issue-status");
    if (data.issue_preview) {
      previewBox.textContent = data.issue_preview;
      if (issueStatus) issueStatus.textContent = "Ready";
    }

    return run.status;
  } catch (err) {
    console.error("Error loading run detail:", err);
  }
}

function initRunDetail(runId) {
  loadRunDetail(runId).then((status) => {
    if (status === "done" || status === "failed") return;

    // Connect SSE
    activeEventSource = new EventSource(`/api/runs/${runId}/stream`);

    activeEventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === "task") {
          const t = payload.task;
          tasksMap.set(t.id, t);

          const existingRow = document.getElementById(`task-row-${t.id}`);
          if (existingRow) {
            existingRow.outerHTML = renderTaskRow(t);
          } else {
            const list = document.getElementById("timeline-list");
            if (list.querySelector(".empty-state")) list.innerHTML = "";
            list.insertAdjacentHTML("beforeend", renderTaskRow(t));
          }
          const taskCountEl = document.getElementById("task-count");
          if (taskCountEl) taskCountEl.textContent = `${tasksMap.size} tasks`;

        } else if (payload.type === "event") {
          const logStream = document.getElementById("log-stream");
          if (logStream) appendLogEntry(logStream, payload);

        } else if (payload.type === "run") {
          const r = payload.run;
          const statusBadge = document.getElementById("run-status");
          if (statusBadge && r.status) {
            statusBadge.className = `badge-status status-${r.status}`;
            statusBadge.textContent = r.status;
          }

          if (r.status === "done" || r.status === "failed") {
            const progressBar = document.getElementById("run-progress");
            if (progressBar) progressBar.classList.remove("active");
            if (activeEventSource) activeEventSource.close();
            // Re-fetch full details for final findings & issue preview
            setTimeout(() => loadRunDetail(runId), 400);
          }
        }
      } catch (err) {
        console.error("Error parsing SSE chunk:", err);
      }
    };

    activeEventSource.onerror = () => {
      // Stream closed or error
      if (activeEventSource) activeEventSource.close();
      loadRunDetail(runId);
    };
  });
}
