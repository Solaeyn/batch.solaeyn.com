/**
 * Builder page: assemble command blocks, preview the generated .bat via the
 * authoritative server generator, then download or save the script.
 */

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

type BlockField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

type BlockDefinition = {
  type: string;
  label: string;
  description: string;
  category: string;
  fields: BlockField[];
};

type Block = {
  id: string;
  type: string;
  params: Record<string, string>;
};

type BuilderState = {
  scriptId: number | null;
  name: string;
  description: string;
  settings: { echoOff: boolean; title: string; color: string };
  blocks: Block[];
};

const paletteList = document.getElementById("paletteList") as HTMLElement | null;
const paletteSearch = document.getElementById("paletteSearch") as HTMLInputElement | null;
const blockList = document.getElementById("blockList") as HTMLElement | null;
const blockCountEl = document.getElementById("blockCount") as HTMLElement | null;
const previewCode = document.getElementById("previewCode") as HTMLElement | null;
const builderStatus = document.getElementById("builderStatus") as HTMLElement | null;
const builderMessage = document.getElementById("builderMessage") as HTMLElement | null;

const scriptNameEl = document.getElementById("scriptName") as HTMLInputElement | null;
const scriptDescriptionEl = document.getElementById("scriptDescription") as HTMLInputElement | null;
const settingEchoOffEl = document.getElementById("settingEchoOff") as HTMLInputElement | null;
const settingTitleEl = document.getElementById("settingTitle") as HTMLInputElement | null;
const settingColorEl = document.getElementById("settingColor") as HTMLInputElement | null;

const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement | null;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement | null;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement | null;

let definitions: BlockDefinition[] = [];
const definitionMap = new Map<string, BlockDefinition>();

const state: BuilderState = {
  scriptId: null,
  name: "",
  description: "",
  settings: { echoOff: true, title: "", color: "" },
  blocks: []
};

let previewText = "";
let previewFileName = "script.bat";
let previewTimer: number | null = null;

const localId = () => `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const setMessage = (text: string, tone: "ok" | "error" = "ok") => {
  if (!builderMessage) return;
  builderMessage.textContent = text;
  builderMessage.classList.toggle("error", tone === "error");
};

/* ---------- Palette ---------- */
const renderPalette = () => {
  if (!paletteList) return;
  const term = (paletteSearch?.value || "").trim().toLowerCase();
  const filtered = term
    ? definitions.filter(
        (def) => def.label.toLowerCase().includes(term) || def.description.toLowerCase().includes(term)
      )
    : definitions;

  if (!filtered.length) {
    paletteList.innerHTML = `<p class="empty-state">No blocks match.</p>`;
    return;
  }

  paletteList.innerHTML = filtered
    .map(
      (def) => `
        <button class="palette-item" type="button" data-add="${escapeHtml(def.type)}">
          <strong>${escapeHtml(def.label)}</strong>
          <span>${escapeHtml(def.description)}</span>
        </button>
      `
    )
    .join("");
};

/* ---------- Block list ---------- */
const renderBlocks = () => {
  if (!blockList) return;
  if (blockCountEl) blockCountEl.textContent = `${state.blocks.length} block${state.blocks.length === 1 ? "" : "s"}`;

  if (!state.blocks.length) {
    blockList.innerHTML = `<p class="empty-state">No blocks yet. Add one from the left panel.</p>`;
    return;
  }

  blockList.innerHTML = state.blocks
    .map((block, index) => {
      const def = definitionMap.get(block.type);
      const label = def?.label || block.type;
      const fields = def?.fields || [];
      const fieldsHtml = fields.length
        ? fields
            .map((field) => {
              const value = block.params[field.key] ?? "";
              if (field.type === "textarea") {
                return `
                  <label class="field">
                    <span>${escapeHtml(field.label)}</span>
                    <textarea class="text-input" rows="2" data-field="${escapeHtml(field.key)}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value)}</textarea>
                  </label>`;
              }
              return `
                <label class="field">
                  <span>${escapeHtml(field.label)}</span>
                  <input class="text-input" type="text" data-field="${escapeHtml(field.key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || "")}" />
                </label>`;
            })
            .join("")
        : `<p class="block-empty-note">No settings for this block.</p>`;

      return `
        <article class="block-card" data-block-id="${escapeHtml(block.id)}">
          <div class="block-card-head">
            <div class="block-card-title">
              <span class="block-index">${index + 1}</span>
              <strong>${escapeHtml(label)}</strong>
            </div>
            <div class="block-card-actions">
              <button class="btn-xs" type="button" data-move="up" ${index === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
              <button class="btn-xs" type="button" data-move="down" ${index === state.blocks.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
              <button class="btn-xs danger" type="button" data-remove aria-label="Remove">✕</button>
            </div>
          </div>
          <div class="block-fields">${fieldsHtml}</div>
        </article>`;
    })
    .join("");
};

/* ---------- Preview (authoritative, debounced) ---------- */
const requestPreview = async () => {
  const result = await api("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      name: state.name || "script",
      settings: state.settings,
      blocks: state.blocks
    })
  });

  if (result.status === 401 || result.status === 403) {
    window.location.href = "/login";
    return;
  }
  if (!result.ok) {
    setMessage((result.data as any).message || "Failed to generate preview.", "error");
    return;
  }

  previewText = String((result.data as any).script || "");
  previewFileName = String((result.data as any).fileName || "script.bat");
  if (previewCode) previewCode.textContent = previewText;
};

const schedulePreview = () => {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(requestPreview, 220);
};

/* ---------- Mutations ---------- */
const addBlock = (type: string) => {
  const def = definitionMap.get(type);
  if (!def) return;
  const params: Record<string, string> = {};
  for (const field of def.fields) params[field.key] = "";
  state.blocks.push({ id: localId(), type, params });
  renderBlocks();
  schedulePreview();
};

const removeBlock = (id: string) => {
  state.blocks = state.blocks.filter((block) => block.id !== id);
  renderBlocks();
  schedulePreview();
};

const moveBlock = (id: string, direction: "up" | "down") => {
  const index = state.blocks.findIndex((block) => block.id === id);
  if (index === -1) return;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.blocks.length) return;
  const [block] = state.blocks.splice(index, 1);
  state.blocks.splice(target, 0, block);
  renderBlocks();
  schedulePreview();
};

/* ---------- Event wiring ---------- */
paletteSearch?.addEventListener("input", renderPalette);

paletteList?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest("[data-add]") as HTMLElement | null;
  if (!target) return;
  addBlock(String(target.dataset.add));
});

blockList?.addEventListener("click", (event) => {
  const card = (event.target as HTMLElement).closest(".block-card") as HTMLElement | null;
  if (!card) return;
  const id = String(card.dataset.blockId);

  const removeTarget = (event.target as HTMLElement).closest("[data-remove]");
  if (removeTarget) {
    removeBlock(id);
    return;
  }
  const moveTarget = (event.target as HTMLElement).closest("[data-move]") as HTMLElement | null;
  if (moveTarget) {
    moveBlock(id, moveTarget.dataset.move === "up" ? "up" : "down");
  }
});

blockList?.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  const fieldKey = input.dataset.field;
  if (!fieldKey) return;
  const card = input.closest(".block-card") as HTMLElement | null;
  if (!card) return;
  const block = state.blocks.find((entry) => entry.id === card.dataset.blockId);
  if (!block) return;
  block.params[fieldKey] = input.value;
  schedulePreview();
});

scriptNameEl?.addEventListener("input", () => {
  state.name = scriptNameEl.value;
  schedulePreview();
});
scriptDescriptionEl?.addEventListener("input", () => {
  state.description = scriptDescriptionEl.value;
});
settingEchoOffEl?.addEventListener("change", () => {
  state.settings.echoOff = settingEchoOffEl.checked;
  schedulePreview();
});
settingTitleEl?.addEventListener("input", () => {
  state.settings.title = settingTitleEl.value;
  schedulePreview();
});
settingColorEl?.addEventListener("input", () => {
  state.settings.color = settingColorEl.value;
  schedulePreview();
});

copyBtn?.addEventListener("click", async () => {
  await requestPreview();
  try {
    await navigator.clipboard.writeText(previewText);
    setMessage("Copied to clipboard.");
  } catch {
    setMessage("Copy failed. Select the preview text manually.", "error");
  }
});

downloadBtn?.addEventListener("click", async () => {
  await requestPreview();
  const blob = new Blob([previewText], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = previewFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setMessage("Downloaded .bat file.");
});

saveBtn?.addEventListener("click", async () => {
  const name = (state.name || "").trim();
  if (name.length < 2) {
    setMessage("Give your script a name (at least 2 characters).", "error");
    scriptNameEl?.focus();
    return;
  }

  saveBtn.disabled = true;
  const payload = {
    name,
    description: state.description,
    settings: state.settings,
    blocks: state.blocks
  };

  const result = state.scriptId
    ? await api(`/api/scripts/${state.scriptId}`, { method: "PATCH", body: JSON.stringify(payload) })
    : await api("/api/scripts", { method: "POST", body: JSON.stringify(payload) });

  saveBtn.disabled = false;

  if (result.status === 401 || result.status === 403) {
    window.location.href = "/login";
    return;
  }
  if (!result.ok) {
    setMessage((result.data as any).message || "Failed to save script.", "error");
    return;
  }

  const script = (result.data as any).script;
  if (script?.id) {
    state.scriptId = Number(script.id);
    if (builderStatus) builderStatus.textContent = "Saved";
    const url = new URL(window.location.href);
    url.searchParams.set("script", String(state.scriptId));
    window.history.replaceState({}, "", url.toString());
  }
  setMessage("Script saved.");
});

/* ---------- Load ---------- */
const applyScript = (script: any) => {
  state.scriptId = Number(script.id);
  state.name = script.name || "";
  state.description = script.description || "";
  state.settings = {
    echoOff: script.settings?.echoOff !== false,
    title: script.settings?.title || "",
    color: script.settings?.color || ""
  };
  state.blocks = Array.isArray(script.blocks)
    ? script.blocks.map((block: any) => ({
        id: block.id || localId(),
        type: block.type,
        params: block.params && typeof block.params === "object" ? block.params : {}
      }))
    : [];

  if (scriptNameEl) scriptNameEl.value = state.name;
  if (scriptDescriptionEl) scriptDescriptionEl.value = state.description;
  if (settingEchoOffEl) settingEchoOffEl.checked = state.settings.echoOff;
  if (settingTitleEl) settingTitleEl.value = state.settings.title;
  if (settingColorEl) settingColorEl.value = state.settings.color;
  if (builderStatus) builderStatus.textContent = "Editing";
};

const load = async () => {
  const catalog = await api("/api/blocks/catalog");
  if (catalog.status === 401 || catalog.status === 403) {
    window.location.href = "/login";
    return;
  }
  definitions = ((catalog.data as any).blocks || []) as BlockDefinition[];
  definitionMap.clear();
  for (const def of definitions) definitionMap.set(def.type, def);
  renderPalette();

  const scriptId = new URLSearchParams(window.location.search).get("script");
  if (scriptId && /^\d+$/.test(scriptId)) {
    const result = await api(`/api/scripts/${scriptId}`);
    if (result.ok && (result.data as any).script) {
      applyScript((result.data as any).script);
    }
  }

  renderBlocks();
  await requestPreview();
};

load();
