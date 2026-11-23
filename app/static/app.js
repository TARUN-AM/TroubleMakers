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

    let epssBadge = '';
    if (f.epss_percentile && f.epss_percentile > 0) {
      const pct = Math.round(f.epss_percentile * 100);
      const isHigh = pct >= 80;
      const scorePct = (f.epss_score * 100).toFixed(1);
      epssBadge = `<span class="${isHigh ? 'badge-epss-high' : 'badge-epss'}" title="EPSS: ${scorePct}% exploit probability">EPSS ${pct}th%</span>`;
    }

    const fixedText = f.fixed_version ? `&rarr; Upgrade to <strong>${escapeHtml(f.fixed_version)}</strong>` : 'No safe fix available';

    return `
      <div class="finding-item">
        <div class="finding-header">
          <div class="finding-meta">
            <span class="badge badge-${prio.toLowerCase()}">${prio}</span>
            <span class="mono" style="font-weight: 600; font-size: 13px;">${escapeHtml(f.package)} @ ${escapeHtml(f.version)}</span>
            <span class="badge" style="background: #F3F4F6; color: var(--ink-2);">${escapeHtml(f.ecosystem)}</span>
            ${kevBadge}
            ${epssBadge}
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

    if (run.pr_url) {
      const prContainer = document.getElementById("run-pr-container");
      const prLink = document.getElementById("run-pr-link");
      if (prContainer && prLink) {
        prContainer.style.display = "inline";
        prLink.href = run.pr_url;
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

    // Git Diff Patch Viewer
    const diffBox = document.getElementById("diff-preview-box");
    if (diffBox && data.diff_patch) {
      window._currentDiffPatch = data.diff_patch;
      const lines = data.diff_patch.split("\n");
      diffBox.innerHTML = lines.map(line => {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          return `<span class="diff-line-add">${escapeHtml(line)}</span>`;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          return `<span class="diff-line-del">${escapeHtml(line)}</span>`;
        } else if (line.startsWith("@@")) {
          return `<span class="diff-line-chunk">${escapeHtml(line)}</span>`;
        }
        return `<span>${escapeHtml(line)}</span>`;
      }).join("\n");
    }

    // Wire up buttons
    const copyBtn = document.getElementById("btn-copy-diff");
    if (copyBtn && !copyBtn._bound) {
      copyBtn._bound = true;
      copyBtn.addEventListener("click", () => {
        if (window._currentDiffPatch) {
          navigator.clipboard.writeText(window._currentDiffPatch).then(() => {
            const orig = copyBtn.textContent;
            copyBtn.textContent = "Copied to Clipboard!";
            setTimeout(() => { copyBtn.textContent = orig; }, 2000);
          });
        }
      });
    }

    const prBtn = document.getElementById("btn-create-pr");
    if (prBtn && !prBtn._bound) {
      prBtn._bound = true;
      prBtn.addEventListener("click", async () => {
        prBtn.disabled = true;
        prBtn.textContent = "Creating PR...";
        try {
          const res = await fetch(`/api/runs/${runId}/create-pr`, { method: "POST" });
          const resData = await res.json();
          if (resData.pr_url) {
            prBtn.textContent = "PR Created!";
            const prContainer = document.getElementById("run-pr-container");
            const prLink = document.getElementById("run-pr-link");
            if (prContainer && prLink) {
              prContainer.style.display = "inline";
              prLink.href = resData.pr_url;
            }
          }
        } catch (e) {
          alert("Error creating PR: " + e);
          prBtn.disabled = false;
          prBtn.textContent = "Create Pull Request";
        }
      });
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

/* ==================== GOOEY NAV COMPONENT ==================== */

const GN_MAX_DROPS = 32;
const GN_MAX_PILLS = 4;
const GN_MARGIN = 72;

const GN_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const GN_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uSize;
uniform float uRatio;
uniform vec4 uPills[${GN_MAX_PILLS}];
uniform vec4 uHover;
uniform vec4 uDrops[${GN_MAX_DROPS}];
uniform vec2 uTails[${GN_MAX_DROPS}];
uniform vec3 uTints[${GN_MAX_DROPS}];
uniform int uCount;
uniform float uSmooth;
uniform vec3 uPill;
uniform vec4 uHoverColor;
uniform float uShadow;

out vec4 outColor;

float sdPill(vec2 p, vec4 box) {
  vec2 extent = max(box.zw, vec2(0.0));
  float r = min(extent.x, extent.y);
  vec2 q = abs(p - box.xy) - extent + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

vec4 blend(vec4 a, vec4 b, float k) {
  float h = clamp(0.5 + 0.5 * (b.w - a.w) / k, 0.0, 1.0);
  return vec4(mix(b.rgb, a.rgb, h), mix(b.w, a.w, h) - k * h * (1.0 - h));
}

vec4 field(vec2 p) {
  vec4 shape = vec4(uPill, 1e5);
  for (int i = 0; i < ${GN_MAX_PILLS}; i++) {
    vec4 pill = uPills[i];
    if (pill.z <= 0.0) continue;
    shape = blend(shape, vec4(uPill, sdPill(p, pill)), uSmooth);
  }
  for (int i = 0; i < ${GN_MAX_DROPS}; i++) {
    if (i >= uCount) break;
    vec4 drop = uDrops[i];
    if (drop.z <= 0.0) continue;
    float d = sdCapsule(p, drop.xy, drop.xy - uTails[i], drop.z);
    if (d > shape.w + uSmooth) continue;
    shape = blend(shape, vec4(uTints[i], d), uSmooth);
  }
  return shape;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uRatio - gl_FragCoord.y) / uRatio;
  vec4 shape = field(p);
  float d = shape.w;
  float aa = max(fwidth(d), 0.35);
  float body = clamp(0.5 - d / aa, 0.0, 1.0);

  vec2 grad = vec2(dFdx(d), -dFdy(d));
  vec2 n = length(grad) > 0.0001 ? normalize(grad) : vec2(0.0, 1.0);
  float rim = (1.0 - smoothstep(0.0, 1.6, -d)) * max(0.0, -n.y) * 0.3;
  vec3 fill = mix(shape.rgb, vec3(1.0), rim) * (1.0 - 0.06 * max(0.0, n.y) * (1.0 - smoothstep(0.0, 6.0, -d)));

  float lifted = field(p - vec2(0.0, 3.0)).w;
  float shadow = (1.0 - smoothstep(-3.0, 9.0, lifted)) * uShadow * (1.0 - body);

  float hover = clamp(0.5 - sdPill(p, uHover) / aa, 0.0, 1.0) * uHoverColor.a;

  vec4 color = vec4(0.0, 0.0, 0.0, shadow);
  color = vec4(uHoverColor.rgb * hover, hover) + color * (1.0 - hover);
  color = vec4(fill * body, body) + color * (1.0 - body);
  outColor = color;
}
`;

function gnParseColor(val) {
  if (!val) return [0.06, 0.46, 0.43, 1];
  const s = String(val).trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const clean = hex[1].length === 3 ? hex[1].replace(/./g, d => d + d) : hex[1];
    return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16) / 255).concat(1);
  }
  const rgba = /rgba?\(([^)]+)\)/i.exec(s);
  if (rgba) {
    const parts = rgba[1].split(',').map(p => parseFloat(p));
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
  }
  return [0.06, 0.46, 0.43, 1];
}

const gnClamp01 = v => Math.min(1, Math.max(0, v));

const gnTravelEase = t => {
  const x = gnClamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

const gnBezier = (a, b, c, d, t) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

const gnPillPath = (x, y, w, h) => {
  if (w <= 0.5 || h <= 0.5) return '';
  const r = Math.min(w, h) / 2;
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
};

function gnCompileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

const GN_UNIFORMS = [
  'uSize', 'uRatio', 'uPills', 'uHover', 'uDrops', 'uTails',
  'uTints', 'uCount', 'uSmooth', 'uPill', 'uHoverColor', 'uShadow'
];

function gnBuildPipeline(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, gnCompileShader(gl, gl.VERTEX_SHADER, GN_VERTEX));
  gl.attachShader(program, gnCompileShader(gl, gl.FRAGMENT_SHADER, GN_FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const uniforms = Object.fromEntries(GN_UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)]));
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return { program, uniforms, buffer, position: gl.getAttribLocation(program, 'aPosition') };
}

function initGooeyNav(navEl, options = {}) {
  if (!navEl) return;

  const stage = navEl.querySelector('.gooey-nav__stage');
  const canvas = navEl.querySelector('.gooey-nav__canvas');
  const list = navEl.querySelector('.gooey-nav__list');
  const overlay = navEl.querySelector('.gooey-nav__list--active');
  const fallback = navEl.querySelector('.gooey-nav__fallback');
  if (!stage || !canvas || !list || !overlay || !fallback) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let gl = null;
  let pipeline = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (gl) pipeline = gnBuildPipeline(gl);
  } catch (e) {
    gl = null;
    pipeline = null;
  }

  fallback.style.display = pipeline ? 'none' : 'block';
  canvas.style.display = pipeline ? 'block' : 'none';

  const computedStyle = getComputedStyle(navEl);
  const pillColor = computedStyle.getPropertyValue('--gn-pill').trim() || '#0F766E';
  const pillRgb = gnParseColor(pillColor);
  const hoverRgb = gnParseColor('rgba(15, 118, 110, 0.08)');

  const settings = {
    animationTime: options.animationTime ?? 500,
    particleCount: options.particleCount ?? 12,
    timeVariance: options.timeVariance ?? 250,
    spread: options.spread ?? 42,
    gooeyness: options.gooeyness ?? 0.45,
    wobble: options.wobble ?? 0.45,
    hoverEffect: options.hoverEffect ?? true,
    pillRgb: pillRgb,
    tints: [],
    hoverRgb: hoverRgb,
    shadow: 0.15
  };

  const view = { width: 0, height: 0 };
  let rects = [];
  let target = 0;
  const pills = new Map();
  const drops = [];
  const hover = { x: 0, y: 0, w: 0, h: 0, alpha: 0, index: -1 };
  const pillData = new Float32Array(GN_MAX_PILLS * 4);
  const dropData = new Float32Array(GN_MAX_DROPS * 4);
  const tailData = new Float32Array(GN_MAX_DROPS * 2);
  const tintData = new Float32Array(GN_MAX_DROPS * 3);
  let raf = 0;
  let last = 0;
  let disposed = false;

  const measure = () => {
    const box = stage.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    view.width = box.width;
    view.height = box.height;
    const outerWidth = box.width + GN_MARGIN * 2;
    const outerHeight = box.height + GN_MARGIN * 2;
    Object.assign(canvas.style, {
      left: `${-GN_MARGIN}px`,
      top: `${-GN_MARGIN}px`,
      width: `${outerWidth}px`,
      height: `${outerHeight}px`
    });
    const width = Math.max(1, Math.round(outerWidth * ratio));
    const height = Math.max(1, Math.round(outerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    rects = Array.from(list.children).map(item => {
      const rect = item.getBoundingClientRect();
      return { x: rect.left - box.left, y: rect.top - box.top, w: rect.width, h: rect.height };
    });
  };

  const trace = (boxes, blobs, smooth) => {
    const field = (x, y) => {
      let d = 1e5;
      const merge = value => {
        const h = gnClamp01(0.5 + (0.5 * (value - d)) / smooth);
        d = value + (d - value) * h - smooth * h * (1 - h);
      };
      for (const box of boxes) {
        const r = Math.min(box.hw, box.hh);
        const qx = Math.abs(x - box.cx) - box.hw + r;
        const qy = Math.abs(y - box.cy) - box.hh + r;
        merge(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
      }
      for (const blob of blobs) {
        const px = x - blob.x;
        const py = y - blob.y;
        const bx = -blob.tx;
        const by = -blob.ty;
        const span = bx * bx + by * by;
        const h = span > 0.0001 ? gnClamp01((px * bx + py * by) / span) : 0;
        const value = Math.hypot(px - bx * h, py - by * h) - blob.r;
        if (value > d + smooth) continue;
        merge(value);
      }
      return d;
    };
    const step = 2;
    const parts = [];
    for (let y = 0; y < view.height; y += 1) {
      const cy = y + 0.5;
      let previous = field(0, cy);
      let start = previous < 0 ? 0 : null;
      for (let x = step; x <= view.width + step; x += step) {
        const value = field(Math.min(x, view.width), cy);
        if (previous < 0 !== value < 0) {
          const cross = x - step + (step * previous) / (previous - value);
          if (value < 0) start = cross;
          else if (start !== null) {
            parts.push(`M${start.toFixed(1)},${y}H${cross.toFixed(1)}V${y + 1}H${start.toFixed(1)}Z`);
            start = null;
          }
        }
        previous = value;
      }
      if (start !== null) parts.push(`M${start.toFixed(1)},${y}H${view.width}V${y + 1}H${start.toFixed(1)}Z`);
    }
    return parts.join('');
  };

  const pill = index => {
    if (!pills.has(index)) pills.set(index, { mass: 0, scale: 0, velocity: 0, outgoing: 0 });
    return pills.get(index);
  };

  const shape = (index, amount) => {
    const rect = rects[index];
    if (!rect || amount <= 0.002) return null;
    const h = rect.h * Math.min(1.08, 0.42 + 0.58 * Math.sqrt(Math.max(0, amount)));
    const w = Math.max(h, rect.w * Math.pow(Math.max(0, amount), 0.75));
    return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
  };

  const plan = (drop, index, now, fresh) => {
    const rect = rects[index];
    if (!rect) return;
    const reach = Math.max(0, settings.spread);
    const ex = rect.x + rect.w / 2 + (Math.random() - 0.5) * rect.w * 0.45;
    const ey = rect.y + rect.h / 2 + (Math.random() - 0.5) * rect.h * 0.2;
    const base = Math.max(0.15, settings.animationTime / 1000);
    const variance = (Math.random() - 0.5) * (Math.max(0, settings.timeVariance) / 1000);
    const duration = Math.max(0.15, base * (0.62 + Math.random() * 0.32) + variance * 0.6);
    const out = Math.random() * Math.PI * 2;
    const into = Math.random() * Math.PI * 2;
    const burst = reach * (0.7 + Math.random() * 0.6);
    const swing = reach * (0.55 + Math.random() * 0.55);
    const carry = Math.min(duration / 3, 0.12);
    drop.index = index;
    drop.start = now;
    drop.duration = duration;
    drop.path = [
      drop.x,
      drop.y,
      fresh ? drop.x + Math.cos(out) * burst * 1.6 : drop.x + drop.vx * carry,
      fresh ? drop.y + Math.sin(out) * burst * 1.6 : drop.y + drop.vy * carry,
      ex + Math.cos(into) * swing * 1.5,
      ey + Math.sin(into) * swing * 1.5,
      ex,
      ey
    ];
  };

  const emit = (from, to, now) => {
    const source = pills.get(from);
    const rect = rects[from];
    if (!source || !rect || !rects[to]) return;
    const available = source.mass - source.outgoing;
    if (available <= 0.002) return;
    const room = GN_MAX_DROPS - drops.length;
    const count = Math.min(room, Math.max(1, Math.round(Math.max(1, settings.particleCount) * available)));
    if (count <= 0) return;
    const window = Math.max(0.15, settings.animationTime / 1000) * 0.16;
    for (let i = 0; i < count; i++) {
      const mass = available / count;
      source.outgoing += mass;
      drops.push({
        x: rect.x + rect.w / 2 + (Math.random() - 0.5) * rect.w * 0.6,
        y: rect.y + rect.h / 2 + (Math.random() - 0.5) * rect.h * 0.3,
        vx: 0,
        vy: 0,
        mass,
        size: 0.8 + Math.random() * 0.4,
        given: 0,
        source: from,
        index: to,
        leave: now + Math.random() * window * 1000,
        emerged: 0,
        absorbed: 0,
        state: 'waiting',
        tint: settings.pillRgb
      });
    }
  };

  const render = () => {
    const height = rects[target]?.h ?? rects[0]?.h ?? 32;
    const smooth = height * (0.18 + 0.5 * gnClamp01(settings.gooeyness));
    const boxes = [];
    const blobs = [];
    for (const [index, state] of pills) {
      const box = shape(index, state.scale);
      if (box) boxes.push({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, hw: box.w / 2, hh: box.h / 2 });
    }
    for (const drop of drops) {
      if (drop.state === 'waiting') continue;
      const radius = 0.26 * height * drop.size * Math.min(drop.emerged, 1 - drop.absorbed);
      if (radius <= 0.05) continue;
      const speed = Math.hypot(drop.vx, drop.vy);
      const length = Math.min(radius * 1.1, speed * 0.018);
      blobs.push({
        x: drop.x,
        y: drop.y,
        r: radius,
        tx: speed > 0.01 ? (drop.vx / speed) * length : 0,
        ty: speed > 0.01 ? (drop.vy / speed) * length : 0,
        tint: drop.tint
      });
    }

    const settledPill = boxes.length === 1 && !blobs.length;
    if (settledPill) {
      const box = boxes[0];
      overlay.style.clipPath = `path('${gnPillPath(box.cx - box.hw, box.cy - box.hh, box.hw * 2, box.hh * 2)}')`;
    } else {
      overlay.style.clipPath = `path('${trace(boxes, blobs, smooth) || 'M0,0Z'}')`;
    }
    overlay.style.visibility = 'visible';

    if (!pipeline || !gl) {
      const box = shape(target, 1);
      if (box) {
        fallback.style.transform = `translate(${box.x.toFixed(2)}px, ${box.y.toFixed(2)}px)`;
        fallback.style.width = `${box.w}px`;
        fallback.style.height = `${box.h}px`;
      }
      fallback.style.opacity = box ? '1' : '0';
      return;
    }

    let slot = 0;
    for (const box of boxes) {
      if (slot >= GN_MAX_PILLS) break;
      pillData[slot * 4] = box.cx + GN_MARGIN;
      pillData[slot * 4 + 1] = box.cy + GN_MARGIN;
      pillData[slot * 4 + 2] = box.hw;
      pillData[slot * 4 + 3] = box.hh;
      slot += 1;
    }
    pillData.fill(0, slot * 4);
    let count = 0;
    for (const blob of blobs) {
      if (count >= GN_MAX_DROPS) break;
      dropData[count * 4] = blob.x + GN_MARGIN;
      dropData[count * 4 + 1] = blob.y + GN_MARGIN;
      dropData[count * 4 + 2] = blob.r;
      dropData[count * 4 + 3] = 0;
      tailData[count * 2] = blob.tx;
      tailData[count * 2 + 1] = blob.ty;
      const tint = blob.tint || settings.pillRgb;
      tintData[count * 3] = tint[0];
      tintData[count * 3 + 1] = tint[1];
      tintData[count * 3 + 2] = tint[2];
      count += 1;
    }

    const { program, uniforms, buffer, position } = pipeline;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uniforms.uSize, view.width + GN_MARGIN * 2, view.height + GN_MARGIN * 2);
    gl.uniform1f(uniforms.uRatio, canvas.width / Math.max(1, view.width + GN_MARGIN * 2));
    gl.uniform4fv(uniforms.uPills, pillData);
    gl.uniform4f(uniforms.uHover, hover.x + GN_MARGIN, hover.y + GN_MARGIN, hover.w / 2, hover.h / 2);
    gl.uniform4fv(uniforms.uDrops, dropData);
    gl.uniform2fv(uniforms.uTails, tailData);
    gl.uniform3fv(uniforms.uTints, tintData);
    gl.uniform1i(uniforms.uCount, count);
    gl.uniform1f(uniforms.uSmooth, smooth);
    gl.uniform3f(uniforms.uPill, settings.pillRgb[0], settings.pillRgb[1], settings.pillRgb[2]);
    gl.uniform4f(uniforms.uHoverColor, settings.hoverRgb[0], settings.hoverRgb[1], settings.hoverRgb[2], settings.hoverRgb[3] * hover.alpha);
    gl.uniform1f(uniforms.uShadow, settings.shadow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const frame = now => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    const emergeTime = 0.09;
    const absorbTime = 0.12;

    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i];
      if (drop.state === 'waiting') {
        if (now < drop.leave) continue;
        drop.state = 'flying';
        plan(drop, drop.index, now, true);
      }
      if (drop.state === 'flying') {
        drop.emerged = Math.min(1, drop.emerged + dt / emergeTime);
        const source = pills.get(drop.source);
        if (source && drop.given < drop.mass) {
          const step = Math.min(drop.mass * (dt / emergeTime), drop.mass - drop.given);
          source.mass = Math.max(0, source.mass - step);
          source.outgoing = Math.max(0, source.outgoing - step);
          drop.given += step;
        }
        const t = gnClamp01((now - drop.start) / 1000 / drop.duration);
        const eased = gnTravelEase(t);
        const [x0, y0, x1, y1, x2, y2, x3, y3] = drop.path;
        const x = gnBezier(x0, x1, x2, x3, eased);
        const y = gnBezier(y0, y1, y2, y3, eased);
        if (dt > 0) {
          drop.vx = (x - drop.x) / dt;
          drop.vy = (y - drop.y) / dt;
        }
        drop.x = x;
        drop.y = y;
        if (t >= 1) drop.state = 'absorbing';
      }
      if (drop.state === 'absorbing') {
        const step = Math.min(1 - drop.absorbed, dt / absorbTime);
        drop.absorbed += step;
        drop.vx *= 0.8;
        drop.vy *= 0.8;
        const host = pill(drop.index);
        host.mass = Math.min(1, host.mass + drop.mass * step);
        if (drop.absorbed >= 1) drops.splice(i, 1);
      }
    }

    const zeta = reduced ? 1 : 1 - 0.72 * gnClamp01(settings.wobble);
    const omega = 26;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (const [index, state] of pills) {
      for (let n = 0; n < steps; n++) {
        state.velocity += (omega * omega * (state.mass - state.scale) - 2 * zeta * omega * state.velocity) * h;
        state.scale += state.velocity * h;
      }
      if (index !== target && state.mass <= 0.002 && state.outgoing <= 0.002 && Math.abs(state.scale) < 0.004) {
        pills.delete(index);
      }
    }

    if (hover.index >= 0 && rects[hover.index]) {
      const rect = rects[hover.index];
      const k = 1 - Math.exp(-dt / 0.06);
      hover.x += (rect.x + rect.w / 2 - hover.x) * k;
      hover.y += (rect.y + rect.h / 2 - hover.y) * k;
      hover.w += (rect.w - hover.w) * k;
      hover.h += (rect.h - hover.h) * k;
    }
    const hoverGoal = settings.hoverEffect && hover.index >= 0 && hover.index !== target ? 1 : 0;
    hover.alpha += (hoverGoal - hover.alpha) * (1 - Math.exp(-dt / 0.08));

    render();

    const host = pills.get(target);
    const resting =
      drops.length === 0 &&
      pills.size === 1 &&
      host &&
      Math.abs(host.mass - host.scale) < 0.0008 &&
      Math.abs(host.velocity) < 0.004;
    const hoverRect = rects[hover.index];
    const hovering =
      Math.abs(hoverGoal - hover.alpha) > 0.003 ||
      (hoverRect && Math.abs(hoverRect.x + hoverRect.w / 2 - hover.x) + Math.abs(hoverRect.w - hover.w) > 0.1);
    if (!resting || hovering) raf = requestAnimationFrame(frame);
    else {
      host.mass = 1;
      host.scale = 1;
      host.velocity = 0;
      hover.alpha = hoverGoal;
      render();
    }
  };

  const wake = () => {
    if (raf || disposed) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const settle = index => {
    pills.clear();
    drops.length = 0;
    target = index;
    const state = pill(index);
    state.mass = 1;
    state.scale = 1;
    state.velocity = 0;
    render();
  };

  const go = (index, animate) => {
    if (index === target) return;
    if (!rects[index] || !animate || reduced || target < 0) {
      settle(index);
      return;
    }
    const now = performance.now();
    target = index;
    pill(index);
    for (const drop of drops) {
      drop.index = index;
      if (drop.state === 'flying') plan(drop, index, now, false);
      if (drop.state === 'absorbing') {
        drop.state = 'flying';
        drop.mass *= 1 - drop.absorbed;
        drop.absorbed = 0;
        plan(drop, index, now, false);
      }
    }
    for (const from of [...pills.keys()]) {
      if (from !== index) emit(from, index, now);
    }
    wake();
  };

  const onOver = event => {
    const item = event.target.closest('[data-gooey-index]');
    if (!item || !list.contains(item)) return;
    const index = Number(item.dataset.gooeyIndex);
    const rect = rects[index];
    if (!rect) return;
    if (hover.alpha < 0.01) {
      hover.x = rect.x + rect.w / 2;
      hover.y = rect.y + rect.h / 2;
      hover.w = rect.w;
      hover.h = rect.h;
    }
    hover.index = index;
    wake();
  };

  const onLeave = () => {
    hover.index = -1;
    wake();
  };

  const onClick = event => {
    const item = event.target.closest('[data-gooey-index]');
    if (!item || !list.contains(item)) return;
    const index = Number(item.dataset.gooeyIndex);
    list.querySelectorAll('.gooey-nav__item').forEach((el, i) => {
      if (i === index) el.setAttribute('data-active', '');
      else el.removeAttribute('data-active');
    });
    go(index, true);
  };

  const resizeObserver = new ResizeObserver(() => {
    measure();
    if (!drops.length) settle(target < 0 ? 0 : target);
    else render();
  });
  resizeObserver.observe(stage);
  resizeObserver.observe(list);

  list.addEventListener('pointerover', onOver);
  list.addEventListener('pointerleave', onLeave);
  list.addEventListener('click', onClick);

  // Initial active item detection
  const activeItem = list.querySelector('.gooey-nav__item[data-active]');
  const initialIndex = activeItem ? Number(activeItem.dataset.gooeyIndex) : 0;
  target = initialIndex;

  measure();
  settle(initialIndex);
  document.fonts?.ready?.then(() => {
    if (disposed) return;
    measure();
    if (!drops.length) settle(target);
  });
}

// Auto-initialize GooeyNav and GradientASCII on page load
document.addEventListener("DOMContentLoaded", () => {
  const mainNav = document.getElementById("main-nav");
  if (mainNav) initGooeyNav(mainNav);

  const asciiEl = document.getElementById("dashboard-ascii");
  if (asciiEl) {
    initGradientASCII(asciiEl, {
      colors: ['#0F766E', '#14B8A6', '#99F6E4', '#FBFAF7'],
      shape: 'horizon',
      characters: ' =+xX0S8#@',
      cellSize: 15,
      density: 0.75,
      glyphOpacity: 0.45,
      gradientOpacity: 0.4,
      lightMode: true,
      grain: 0.03,
      speed: 0.7,
      glow: 0.15,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
    });
  }
});

/* ==================== GRADIENT ASCII COMPONENT ==================== */

const GA_MAX_COLORS = 8;
const GA_MAX_CLICKS = 4;
const GA_MAX_TRAIL = 24;
const GA_CLICK_LIFE = 1.2;
const GA_TRAIL_LIFE = 0.7;
const GA_TRAIL_STEP = 0.015;
const GA_INTRO_SECONDS = 2.4;
const GA_ATLAS_CELL_W = 60;
const GA_ATLAS_CELL_H = 100;
const GA_ATLAS_COLUMNS = 16;
const GA_FONT_SCALE = 0.78;
const GA_SHAPES = { horizon: 0, pinch: 1, rise: 2, eclipse: 3 };
const GA_CLICK_EFFECTS = { none: 0, wave: 1, burst: 2 };

const GA_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GA_COMMON = `
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

const GA_FIELD = `#version 300 es
precision highp float;
precision highp int;
uniform float uAspect;
uniform float uTime;
uniform int uShape;
uniform vec3 uRamp[8];
uniform int uCount;
uniform float uScale;
uniform float uSoftness;
uniform float uFlow;
uniform vec2 uSeed;
uniform vec4 uTrail[24];
uniform float uRadius;
uniform vec4 uClicks[4];
uniform int uClickEffect;
uniform float uIntro;
uniform float uFrame;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;
${GA_COMMON}
vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy) * 2.0 - 1.0;
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i), f);
  float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return 0.5 + 0.5 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec3 labToRgb(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 horizon(vec2 p, float time, out float order) {
  float span = 0.5 * max(uAspect, 1.0);
  float x = p.x / span;
  float arch = -0.17 - 0.2 * x * x + 0.02 * sin(time * 0.6);
  float soft = mix(0.05, 0.22, uSoftness);
  float edge = p.y - arch;
  float rim = 0.38 * smoothstep(-soft, 0.42, edge);
  vec2 sun = vec2(0.08 * sin(time * 0.31) * span, 0.58);
  float spread = length((p - sun) / vec2(0.95 * span, 0.75));
  float sky = mix(0.55, 1.0, smoothstep(0.2, 0.95, spread));
  order = clamp(edge * 1.3, 0.0, 1.0);
  return vec3(rim, sky, smoothstep(0.18, 0.62, edge));
}

vec3 pinch(vec2 p, float time, out float order) {
  float span = 0.5 * max(uAspect, 0.75);
  float x = p.x / span;
  float sway = 0.02 * sin(x * 1.7 + time * 0.55);
  float breathe = 1.0 + 0.06 * sin(time * 0.8);
  float width = (0.13 + 0.22 * x * x) * breathe * mix(0.85, 1.2, uSoftness);
  float y = abs(p.y - sway) / width;
  float t = exp(-pow(y, 2.2)) * (0.42 + 0.58 * exp(-x * x * 1.8));
  order = clamp(abs(p.y - sway) * 2.4 + abs(x) * 0.3, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 rise(vec2 p, float time, out float order) {
  float wide = max(uAspect, 0.9);
  vec2 center = vec2(0.05 * sin(time * 0.45) * wide, -0.7);
  vec2 radius = vec2(0.82 * wide, 0.64 * (1.0 + 0.04 * sin(time * 0.8)));
  float d = length((p - center) / radius);
  float soft = mix(0.6, 1.15, uSoftness);
  float t = clamp(pow(clamp(1.0 - d, 0.0, 1.0), soft) * 1.35, 0.0, 1.0);
  order = clamp((d - 0.2) * 1.3, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 eclipse(vec2 p, float time, out float order) {
  float fit = min(1.0, uAspect * 1.25);
  float r = 0.23 * fit * (1.0 + 0.015 * sin(time * 0.9));
  float angle = atan(p.y, p.x);
  float rays = noise(vec2(cos(angle), sin(angle)) * 2.2 + time * 0.08) * 0.8 + 0.6;
  float d = length(p) - r;
  float reach = mix(0.07, 0.15, uSoftness) * rays * fit;
  float t = smoothstep(-0.006, 0.006 + 0.02 * uSoftness, d) * exp(-max(d, 0.0) / reach);
  order = clamp(d * 2.0, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec4 tone(float t) {
  float x = smoothstep(0.3, 1.0, t) * float(uCount - 1);
  int index = int(floor(x));
  return vec4(mix(uRamp[index], uRamp[min(index + 1, uCount - 1)], fract(x)), smoothstep(0.0, 0.38, t));
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float time = uTime;
  vec2 q = p / uScale;
  vec2 warp = vec2(
    noise(q * 1.6 + uSeed + vec2(0.0, time * 0.3)),
    noise(q * 1.6 + uSeed.yx + vec2(4.3, -time * 0.24))
  ) - 0.5;
  q += warp * uFlow * (uShape == 3 ? 0.04 : 0.18);
  float order = 0.0;
  vec3 shape;
  if (uShape == 0) shape = horizon(q, time, order);
  else if (uShape == 1) shape = pinch(q, time, order);
  else if (uShape == 2) shape = rise(q, time, order);
  else shape = eclipse(q, time, order);

  float reveal = clamp((uIntro * 1.45 - order) / 0.45, 0.0, 1.0);
  reveal = reveal * reveal * (3.0 - 2.0 * reveal);

  float scramble = 0.0;
  for (int i = 0; i < 24; i++) {
    vec4 point = uTrail[i];
    if (point.z <= 0.0) continue;
    vec2 d = p - point.xy;
    scramble = max(scramble, point.z * exp(-dot(d, d) / (uRadius * uRadius)));
  }
  for (int i = 0; i < 4; i++) {
    vec4 c = uClicks[i];
    if (c.w <= 0.0) continue;
    float d = length(p - c.xy);
    if (uClickEffect == 1) {
      scramble = max(scramble, exp(-pow((d - c.z * 0.75) / 0.06, 2.0)) * c.w);
    } else if (uClickEffect == 2) {
      float size = 0.08 + 0.22 * (1.0 - exp(-c.z * 5.0));
      scramble = max(scramble, (1.0 - smoothstep(size * 0.6, size, d)) * c.w);
    }
  }
  vec2 t = clamp(shape.xy * mix(0.7, 1.0, reveal), 0.0, 1.0);
  vec4 mixed = mix(tone(t.x), tone(t.y), shape.z);
  vec3 color = encode(labToRgb(mixed.rgb));
  float alpha = mixed.a * reveal;
  float dither = (hash12(gl_FragCoord.xy + uFrame * 13.7) - 0.5) / 255.0;
  outColor = clamp(vec4(color * alpha + dither, alpha + dither), 0.0, 1.0);
  outAux = vec4(reveal, scramble, 0.0, 1.0);
}`;

const GA_GLYPHS = `
uniform sampler2D uField;
uniform sampler2D uAux;
uniform sampler2D uAtlas;
uniform vec2 uResolution;
uniform vec2 uCell;
uniform vec2 uOffset;
uniform vec2 uAtlasGrid;
uniform float uCount;
uniform float uDensity;
uniform float uOpacity;
uniform float uFlicker;
uniform float uDepth;
uniform float uGlyphTime;
uniform float uSeedValue;
uniform float uLight;
${GA_COMMON}
float sampleGlyph(float index, vec2 local, vec2 coord, float soft) {
  float column = mod(index, uAtlasGrid.x);
  float row = floor(index / uAtlasGrid.x);
  vec2 atlasUv = vec2((column + local.x) / uAtlasGrid.x, (row + 1.0 - local.y) / uAtlasGrid.y);
  vec2 continuous = coord / uAtlasGrid;
  float scale = exp2(soft);
  return textureGrad(uAtlas, atlasUv, dFdx(continuous) * scale, dFdy(continuous) * scale).a;
}

vec4 glyphAt(vec2 px) {
  vec2 coord = (px - uOffset) / uCell;
  vec2 cell = floor(coord);
  vec2 local = coord - cell;
  vec2 uv = clamp(((cell + 0.5) * uCell + uOffset) / uResolution, vec2(0.0), vec2(1.0));
  vec4 field = texture(uField, uv);
  vec4 aux = texture(uAux, uv);
  vec3 visible = uLight > 0.5 ? field.rgb + (1.0 - field.a) : field.rgb;
  float luma = dot(visible, vec3(0.2126, 0.7152, 0.0722));
  float value = uLight > 0.5 ? clamp((1.0 - luma) * 1.5, 0.0, 1.0) : luma;
  float pick = hash12(cell + uSeedValue * 7.31);
  float level = hash12(cell * 1.73 + 4.1 + uSeedValue);
  float tick = floor(uGlyphTime * 9.0 + level * 9.0);
  float wobble = (hash12(cell * 2.31 + tick * 17.7) - 0.5) * uFlicker * 0.4 + (level - 0.5) * 0.1;
  float tone = clamp(pow(value, 0.75) + wobble, 0.0, 1.0);
  float index = floor(tone * (uCount - 1.0) + 0.5);
  float decode = max(aux.g, 1.0 - aux.r);
  if (decode > 0.02) {
    float frame = floor(uGlyphTime * 20.0);
    if (hash12(cell * 3.7 + frame * 5.3) < decode * 1.25) index = 1.0 + floor(hash12(cell + frame * 1.37) * (uCount - 1.0));
  }
  float present = step(pick, uDensity * mix(1.0, 0.3 + tone * 1.1, 0.55));
  float cutoff = smoothstep(0.03, 0.1, value);
  float focus = step(hash12(cell * 0.71 + 9.2 + uSeedValue), uDepth);
  float coverage = sampleGlyph(index, local, coord, focus * 1.2);
  float alpha = uOpacity * present * cutoff * coverage * mix(1.0, 0.35 + 0.65 * level, 0.55) * (1.0 - focus * 0.5);
  if (uLight < 0.5) {
    vec3 light = field.rgb * 0.55 + vec3(0.03) * field.a;
    return vec4(light * alpha, 0.6 * field.a * alpha);
  }
  vec3 ink = visible * 0.8;
  return vec4(ink * alpha, alpha);
}
`;

const GA_HALO = `#version 300 es
precision highp float;
uniform float uDownscale;
in vec2 vUv;
out vec4 outColor;
${GA_GLYPHS}
void main() {
  outColor = glyphAt(gl_FragCoord.xy * uDownscale);
}`;

const GA_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 sum = texture(uSource, vUv) * 0.2270270270;
  sum += texture(uSource, vUv + uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uSource, vUv - uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uSource, vUv + uStep * 3.2307692308) * 0.0702702703;
  sum += texture(uSource, vUv - uStep * 3.2307692308) * 0.0702702703;
  outColor = sum;
}`;

const GA_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uHalo;
uniform float uGlow;
uniform float uGradient;
uniform float uGrain;
uniform float uFrame;
in vec2 vUv;
out vec4 outColor;
${GA_GLYPHS}
void main() {
  vec4 base = texture(uField, vUv) * uGradient;
  vec4 glyph = glyphAt(gl_FragCoord.xy);
  vec4 halo = texture(uHalo, vUv) * uGlow;
  vec4 color;
  if (uLight < 0.5) {
    color = base + glyph + halo;
  } else {
    color = glyph + base * (1.0 - glyph.a);
    color += halo * 0.6 * (1.0 - color.a);
  }
  float grain = (hash12(gl_FragCoord.xy + uFrame * vec2(17.0, 59.0)) + hash12(gl_FragCoord.xy * 1.31 + uFrame * 7.0) - 1.0) * uGrain;
  float body = clamp(color.a, 0.0, 1.0);
  color.rgb += grain * (0.25 + body) * 0.5;
  color.a = clamp(color.a, 0.0, 1.0);
  color.rgb = clamp(color.rgb, 0.0, color.a);
  outColor = color;
}`;

const gaClamp = (v, min, max) => Math.min(max, Math.max(min, v));
const gaToLinear = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const gaToLab = ([r, g, b]) => {
  const lr = gaToLinear(r);
  const lg = gaToLinear(g);
  const lb = gaToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
};

function gaCompileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function gaLinkProgram(gl, fragmentSource) {
  const vertex = gaCompileShader(gl, gl.VERTEX_SHADER, GA_VERTEX);
  const fragment = gaCompileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return { program, uniforms: {} };
}

function gaResolveUniforms(gl, item) {
  if (!gl.getProgramParameter(item.program, gl.LINK_STATUS)) return false;
  const count = gl.getProgramParameter(item.program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(item.program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    item.uniforms[name] = gl.getUniformLocation(item.program, name);
  }
  return true;
}

function gaCreateTarget(gl, count) {
  const textures = Array.from({ length: count }, () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  });
  return { textures, framebuffer: gl.createFramebuffer(), width: 0, height: 0 };
}

function gaSizeTarget(gl, target, width, height) {
  if (target.width === width && target.height === height) return;
  target.width = width;
  target.height = height;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  target.textures.forEach((texture, i) => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function gaBuildAtlas(gl, characters, fontFamily) {
  const list = [...new Set([...characters].filter(char => char !== '\n' && char !== '\r'))];
  if (!list.length) list.push(' ');
  const font = `300 ${Math.round(GA_ATLAS_CELL_H * GA_FONT_SCALE)}px ${fontFamily}`;
  const columns = Math.min(GA_ATLAS_COLUMNS, list.length);
  const rows = Math.ceil(list.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = GA_ATLAS_CELL_W * columns;
  canvas.height = GA_ATLAS_CELL_H * rows;
  const context = canvas.getContext('2d');
  if (context) {
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#fff';
    list.forEach((char, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      context.fillText(char, column * GA_ATLAS_CELL_W + GA_ATLAS_CELL_W / 2, row * GA_ATLAS_CELL_H + GA_ATLAS_CELL_H / 2 + 3);
    });
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, count: list.length, grid: [columns, rows] };
}

function initGradientASCII(container, options = {}) {
  if (!container) return;
  const canvas = container.querySelector('.gradient-ascii-canvas') || container.querySelector('canvas');
  if (!canvas) return;

  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false
    });
  } catch (e) {
    gl = null;
  }

  if (!gl) {
    canvas.style.display = 'none';
    return;
  }

  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  const field = gaLinkProgram(gl, GA_FIELD);
  const halo = gaLinkProgram(gl, GA_HALO);
  const blur = gaLinkProgram(gl, GA_BLUR);
  const composite = gaLinkProgram(gl, GA_COMPOSITE);
  if (!field || !halo || !blur || !composite) return;
  const programs = [field, halo, blur, composite];
  if (!parallel && !programs.every(item => gaResolveUniforms(gl, item))) {
    programs.forEach(item => gl.deleteProgram(item.program));
    return;
  }

  const vao = gl.createVertexArray();
  const fieldTarget = gaCreateTarget(gl, 2);
  const haloA = gaCreateTarget(gl, 1);
  const haloB = gaCreateTarget(gl, 1);

  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const parseColor = val => {
    let rgb = [0.06, 0.46, 0.43];
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000000';
      probe.fillStyle = val;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      rgb = [r / 255, g / 255, b / 255];
    }
    return rgb;
  };

  const palette = (options.colors && options.colors.length ? options.colors : ['#0F766E', '#14B8A6', '#99F6E4', '#FBFAF7']).slice(0, GA_MAX_COLORS);
  const settings = {
    colors: palette.length > 1 ? palette : [palette[0], palette[0]],
    shape: GA_SHAPES[options.shape] ?? 0,
    characters: options.characters || ' =+xX0S8#@',
    cellSize: gaClamp(options.cellSize ?? 16, 6, 64),
    density: gaClamp(options.density ?? 0.75, 0, 1),
    glyphOpacity: gaClamp(options.glyphOpacity ?? 0.45, 0, 1),
    glow: gaClamp(options.glow ?? 0.15, 0, 2),
    depthOfField: gaClamp(options.depthOfField ?? 0, 0, 1),
    flicker: gaClamp(options.flicker ?? 0.15, 0, 1),
    softness: gaClamp(options.softness ?? 0.6, 0, 1),
    scale: gaClamp(options.scale ?? 1.1, 0.4, 2.5),
    flow: gaClamp(options.flow ?? 0.4, 0, 2),
    speed: Math.max(0, options.speed ?? 0.7),
    gradientOpacity: gaClamp(options.gradientOpacity ?? 0.35, 0, 1),
    grain: gaClamp(options.grain ?? 0.03, 0, 0.4),
    variation: Math.max(0, options.variation ?? 0),
    mouseInteraction: options.mouseInteraction ?? true,
    scrambleRadius: gaClamp(options.scrambleRadius ?? 0.12, 0.02, 0.4),
    clickEffect: GA_CLICK_EFFECTS[options.clickEffect] ?? 1,
    intro: options.intro ?? true,
    lightMode: options.lightMode ?? true,
    fontFamily: options.fontFamily || '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    dpr: options.dpr
  };

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const view = { width: 1, height: 1, ratio: 1 };
  const ramp = new Float32Array(GA_MAX_COLORS * 3);
  const clickData = new Float32Array(GA_MAX_CLICKS * 4);
  const clicks = [];
  const trailData = new Float32Array(GA_MAX_TRAIL * 4);
  const trail = [];
  const pointer = { x: 0, y: 0, inside: false };
  let atlas = null;
  let time = 0;
  let glyphTime = 0;
  let introClock = settings.intro && !reduce ? 0 : 1;
  let frameSeed = 0;
  let grainClock = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let disposed = false;
  let ready = !parallel;

  const linked = () =>
    !parallel || programs.every(item => gl.getProgramParameter(item.program, parallel.COMPLETION_STATUS_KHR));

  const syncAtlas = () => {
    if (atlas) return;
    atlas = gaBuildAtlas(gl, settings.characters, settings.fontFamily);
  };

  const syncPalette = () => {
    settings.colors.forEach((color, i) => ramp.set(gaToLab(parseColor(color)), i * 3));
  };

  const bindGlyphs = (program, width, height) => {
    if (!atlas) return;
    const u = program.uniforms;
    const cellH = settings.cellSize * view.ratio;
    const cellW = cellH * (GA_ATLAS_CELL_W / GA_ATLAS_CELL_H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTarget.textures[0]);
    gl.uniform1i(u.uField, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fieldTarget.textures[1]);
    gl.uniform1i(u.uAux, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
    gl.uniform1i(u.uAtlas, 2);
    gl.uniform2f(u.uResolution, width, height);
    gl.uniform2f(u.uCell, cellW, cellH);
    gl.uniform2f(
      u.uOffset,
      (width - Math.ceil(width / cellW) * cellW) / 2,
      (height - Math.ceil(height / cellH) * cellH) / 2
    );
    gl.uniform2f(u.uAtlasGrid, atlas.grid[0], atlas.grid[1]);
    gl.uniform1f(u.uCount, atlas.count);
    gl.uniform1f(u.uDensity, settings.density);
    gl.uniform1f(u.uOpacity, settings.glyphOpacity);
    gl.uniform1f(u.uFlicker, reduce ? 0 : settings.flicker);
    gl.uniform1f(u.uDepth, settings.depthOfField);
    gl.uniform1f(u.uGlyphTime, glyphTime);
    gl.uniform1f(u.uSeedValue, settings.variation);
    gl.uniform1f(u.uLight, settings.lightMode ? 1 : 0);
  };

  const draw = () => {
    if (!ready) return;
    const aspect = view.width / view.height;
    syncAtlas();
    syncPalette();
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fieldTarget.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, fieldTarget.width, fieldTarget.height);
    gl.useProgram(field.program);
    const fu = field.uniforms;
    gl.uniform1f(fu.uAspect, aspect);
    gl.uniform1f(fu.uTime, time);
    gl.uniform1i(fu.uShape, settings.shape);
    gl.uniform3fv(fu.uRamp, ramp);
    gl.uniform1i(fu.uCount, settings.colors.length);
    gl.uniform1f(fu.uScale, settings.scale);
    gl.uniform1f(fu.uSoftness, settings.softness);
    gl.uniform1f(fu.uFlow, settings.flow);
    gl.uniform2f(fu.uSeed, settings.variation * 3.17, settings.variation * 1.91);
    gl.uniform4fv(fu.uTrail, trailData);
    gl.uniform1f(fu.uRadius, settings.scrambleRadius);
    gl.uniform4fv(fu.uClicks, clickData);
    gl.uniform1i(fu.uClickEffect, settings.clickEffect);
    gl.uniform1f(fu.uIntro, introClock);
    gl.uniform1f(fu.uFrame, frameSeed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const glowing = settings.glow > 0.001;
    if (glowing) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, haloA.framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, haloA.width, haloA.height);
      gl.useProgram(halo.program);
      bindGlyphs(halo, canvas.width, canvas.height);
      gl.uniform1f(halo.uniforms.uDownscale, canvas.width / haloA.width);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(blur.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(blur.uniforms.uSource, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, haloB.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, haloA.textures[0]);
      gl.uniform2f(blur.uniforms.uStep, 1 / haloA.width, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, haloA.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, haloB.textures[0]);
      gl.uniform2f(blur.uniforms.uStep, 0, 1 / haloA.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(composite.program);
    bindGlyphs(composite, canvas.width, canvas.height);
    const cu = composite.uniforms;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, haloA.textures[0]);
    gl.uniform1i(cu.uHalo, 3);
    gl.uniform1f(cu.uGlow, glowing ? settings.glow : 0);
    gl.uniform1f(cu.uGradient, settings.gradientOpacity);
    gl.uniform1f(cu.uGrain, settings.grain);
    gl.uniform1f(cu.uFrame, frameSeed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const resize = () => {
    view.width = Math.max(1, container.clientWidth);
    view.height = Math.max(1, container.clientHeight);
    view.ratio = Math.min(settings.dpr || window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(view.width * view.ratio));
    canvas.height = Math.max(1, Math.round(view.height * view.ratio));
    gaSizeTarget(
      gl,
      fieldTarget,
      Math.max(1, Math.round(canvas.width / 2)),
      Math.max(1, Math.round(canvas.height / 2))
    );
    const haloWidth = Math.max(1, Math.round(canvas.width / 4));
    const haloHeight = Math.max(1, Math.round(canvas.height / 4));
    gaSizeTarget(gl, haloA, haloWidth, haloHeight);
    gaSizeTarget(gl, haloB, haloWidth, haloHeight);
    draw();
    wake();
  };

  const updateInput = dt => {
    trail.forEach(point => { point.age += dt; });
    while (trail.length && trail[trail.length - 1].age > GA_TRAIL_LIFE) trail.pop();
    for (let i = 0; i < GA_MAX_TRAIL; i++) {
      const point = trail[i];
      if (!point) {
        trailData[i * 4 + 2] = 0;
        continue;
      }
      const k = 1 - point.age / GA_TRAIL_LIFE;
      trailData.set([point.x, point.y, k * k, 0], i * 4);
    }
    clicks.forEach(click => { click.age += dt; });
    while (clicks.length && clicks[clicks.length - 1].age > GA_CLICK_LIFE) clicks.pop();
    for (let i = 0; i < GA_MAX_CLICKS; i++) {
      const click = clicks[i];
      if (!click) {
        clickData[i * 4 + 3] = 0;
        continue;
      }
      const k = click.age / GA_CLICK_LIFE;
      const envelope = Math.min(1, click.age / 0.08) * (1 - k) * (1 - k);
      clickData.set([click.x, click.y, click.age, envelope], i * 4);
    }
  };

  const frame = now => {
    raf = 0;
    if (disposed || !visible || document.hidden) return;
    if (!ready) {
      if (!gl.isContextLost() && !linked()) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (!programs.every(item => gaResolveUniforms(gl, item))) return;
      ready = true;
    }
    const dt = last ? gaClamp((now - last) / 1000, 0.001, 0.05) : 1 / 60;
    last = now;
    if (!reduce) {
      time += dt * settings.speed * 0.5;
      glyphTime += dt * Math.max(settings.speed, 0.15);
    }
    if (introClock < 1) introClock = Math.min(1, introClock + dt / GA_INTRO_SECONDS);
    grainClock += dt;
    if (!reduce && grainClock > 1 / 24) {
      grainClock = 0;
      frameSeed = (frameSeed + 1) % 97;
    }
    updateInput(dt);
    draw();
    const busy = !reduce || introClock < 1 || clicks.length > 0 || trail.length > 0;
    if (busy) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  function wake() {
    if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  const locate = event => {
    const rect = container.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = 1 - (event.clientY - rect.top) / Math.max(1, rect.height);
    const aspect = rect.width / Math.max(1, rect.height);
    pointer.inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    pointer.x = (x - 0.5) * aspect;
    pointer.y = y - 0.5;
  };

  const onPointerMove = event => {
    locate(event);
    if (!pointer.inside || !settings.mouseInteraction || reduce) return;
    const head = trail[0];
    const gap = head ? Math.hypot(pointer.x - head.x, pointer.y - head.y) : Infinity;
    if (gap < GA_TRAIL_STEP) return;
    if (head && head.age < 0.1) {
      const steps = Math.min(6, Math.floor(gap / (GA_TRAIL_STEP * 2)));
      for (let i = 1; i <= steps; i++) {
        const k = i / (steps + 1);
        trail.unshift({ x: head.x + (pointer.x - head.x) * k, y: head.y + (pointer.y - head.y) * k, age: 0 });
      }
    }
    trail.unshift({ x: pointer.x, y: pointer.y, age: 0 });
    trail.length = Math.min(trail.length, GA_MAX_TRAIL);
    wake();
  };

  const onPointerDown = event => {
    locate(event);
    if (!pointer.inside || !settings.clickEffect || reduce) return;
    clicks.unshift({ x: pointer.x, y: pointer.y, age: 0 });
    if (clicks.length > GA_MAX_CLICKS) clicks.pop();
    wake();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) {
      last = 0;
      wake();
    }
  });
  intersection.observe(container);
  container.addEventListener('pointermove', onPointerMove, { passive: true });
  container.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('visibilitychange', () => { last = 0; wake(); });
  resize();
}
