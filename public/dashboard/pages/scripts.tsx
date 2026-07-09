/** Scripts page: list, search, delete, and download saved scripts. */

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

const listEl = document.getElementById("scriptsList") as HTMLElement | null;
const countEl = document.getElementById("scriptsCount") as HTMLElement | null;
const searchEl = document.getElementById("scriptSearch") as HTMLInputElement | null;
const messageEl = document.getElementById("dashboardMessage") as HTMLElement | null;

let allScripts: ScriptSummary[] = [];
let searchTerm = "";

const setMessage = (text: string, ok = false) => {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.classList.toggle("ok", ok);
};

const render = () => {
  if (!listEl) return;
  const filtered = searchTerm
    ? allScripts.filter((script) => script.name.toLowerCase().includes(searchTerm))
    : allScripts;

  if (countEl) countEl.textContent = `${allScripts.length} script${allScripts.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    listEl.innerHTML = allScripts.length
      ? `<p class="empty-state">No scripts match your search.</p>`
      : `<p class="empty-state">No scripts yet. <a href="/home/builder">Build your first one.</a></p>`;
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (script) => `
        <article class="script-card" data-script-id="${script.id}">
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
            <button class="btn-xs danger" type="button" data-action="delete" data-id="${script.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
};

const deleteScript = async (id: number) => {
  if (!window.confirm("Delete this script? This cannot be undone.")) return;
  const result = await api(`/api/scripts/${id}`, { method: "DELETE" });
  if (result.status === 401 || result.status === 403) {
    window.location.href = "/login";
    return;
  }
  if (!result.ok) {
    setMessage((result.data as any).message || "Failed to delete script.");
    return;
  }
  allScripts = allScripts.filter((script) => script.id !== id);
  render();
  setMessage("Script deleted.", true);
};

listEl?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest('[data-action="delete"]') as HTMLElement | null;
  if (!target) return;
  const id = Number(target.dataset.id);
  if (id) deleteScript(id);
});

searchEl?.addEventListener("input", () => {
  searchTerm = (searchEl.value || "").trim().toLowerCase();
  render();
});

const load = async () => {
  const result = await api("/api/scripts");
  if (result.status === 401 || result.status === 403) {
    window.location.href = "/login";
    return;
  }
  if (!result.ok) {
    if (listEl) listEl.innerHTML = `<p class="empty-state">Failed to load scripts.</p>`;
    return;
  }
  allScripts = ((result.data as any).scripts || []) as ScriptSummary[];
  render();
};

load();
