/** Overview page: workspace stats and recent scripts. */

const getCookieValue = (name: string) => {
  const encoded = `${encodeURIComponent(name)}=`;
  const parts = document.cookie ? document.cookie.split(";") : [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(encoded)) continue;
    return decodeURIComponent(trimmed.slice(encoded.length));
  }
  return "";
};

const api = async (url: string, opts: RequestInit = {}) => {
  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const csrf = getCookieValue("csrfToken");
  if (csrf) headers.set("x-csrf-token", csrf);
  const response = await fetch(url, { credentials: "same-origin", ...opts, headers });
  let data: Record<string, unknown> = {};
  if ((response.headers.get("content-type") || "").includes("application/json")) {
    data = await response.json();
  }
  return { ok: response.ok, status: response.status, data };
};

const escapeHtml = (value: string) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

type ScriptSummary = {
  id: number;
  name: string;
  description: string | null;
  blockCount: number;
  updatedAt: string;
};

const setText = (id: string, value: string) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

const renderRecent = (scripts: ScriptSummary[]) => {
  const container = document.getElementById("recentScripts");
  if (!container) return;

  if (!scripts.length) {
    container.innerHTML = `<p class="empty-state">No scripts yet. <a href="/home/builder">Build your first one.</a></p>`;
    return;
  }

  container.innerHTML = scripts
    .map(
      (script) => `
        <article class="script-card">
          <div class="script-card-main">
            <h3>${escapeHtml(script.name)}</h3>
            ${script.description ? `<p>${escapeHtml(script.description)}</p>` : ""}
            <div class="script-card-meta">
              <span>${script.blockCount} block${script.blockCount === 1 ? "" : "s"}</span>
              <span>Edited ${escapeHtml(formatDate(script.updatedAt))}</span>
            </div>
          </div>
          <div class="script-card-actions">
            <a class="btn-xs" href="/home/builder?script=${script.id}">Edit</a>
            <a class="btn-xs" href="/api/scripts/${script.id}/download">Download</a>
          </div>
        </article>
      `
    )
    .join("");
};

const load = async () => {
  const result = await api("/api/dashboard/overview");
  if (result.status === 401 || result.status === 403) {
    window.location.href = "/login";
    return;
  }
  if (!result.ok) return;

  const overview = (result.data as any).overview || {};
  const recent = ((result.data as any).recent || []) as ScriptSummary[];

  setText("statScripts", String(overview.totalScripts ?? 0));
  setText("statBlocks", String(overview.totalBlocks ?? 0));
  setText("statLimit", String(overview.maxScripts ?? "--"));
  setText("statLast", formatDate(overview.lastUpdatedAt));
  setText("overviewUpdated", overview.totalScripts ? `${overview.totalScripts} saved` : "Empty");

  renderRecent(recent);
};

load();
