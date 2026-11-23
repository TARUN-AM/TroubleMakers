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

// Auto-initialize GooeyNav on all pages
document.addEventListener("DOMContentLoaded", () => {
  const mainNav = document.getElementById("main-nav");
  if (mainNav) initGooeyNav(mainNav);
});
