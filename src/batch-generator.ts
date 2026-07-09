/**
 * Core logic for Solaeyn's .bat Builder.
 *
 * A script is a list of typed blocks plus a small set of script-level settings.
 * The generator turns that structured data into a valid Windows batch (.bat)
 * file. Normalization keeps user input safe to store and predictable to render.
 *
 * This module is intentionally pure (no I/O) so it can run on the server for the
 * authoritative download and be mirrored client-side for the live preview.
 */

export type BatchBlockType =
  | "comment"
  | "echo"
  | "blank"
  | "pause"
  | "cls"
  | "title"
  | "color"
  | "set"
  | "prompt"
  | "label"
  | "goto"
  | "run"
  | "start"
  | "cd"
  | "mkdir"
  | "del"
  | "copy"
  | "move"
  | "timeout"
  | "ifexist"
  | "exit"
  | "raw";

export type BatchBlock = {
  id: string;
  type: BatchBlockType;
  params: Record<string, string>;
};

export type BatchScriptSettings = {
  echoOff: boolean;
  title: string;
  color: string;
};

export type BatchScriptDraft = {
  settings: BatchScriptSettings;
  blocks: BatchBlock[];
};

export type BatchBlockFieldType = "text" | "textarea" | "select";

export type BatchBlockField = {
  key: string;
  label: string;
  type: BatchBlockFieldType;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

export type BatchBlockDefinition = {
  type: BatchBlockType;
  label: string;
  description: string;
  category: "output" | "flow" | "files" | "system";
  fields: BatchBlockField[];
};

export const MAX_BLOCKS = 200;
export const MAX_FIELD_LENGTH = 2000;

/** Catalog of every supported block, used by both the server and the client. */
export const BATCH_BLOCK_DEFINITIONS: BatchBlockDefinition[] = [
  {
    type: "comment",
    label: "Comment",
    description: "A REM note that is ignored when the script runs.",
    category: "output",
    fields: [{ key: "text", label: "Text", type: "textarea", placeholder: "Describe what happens next" }]
  },
  {
    type: "echo",
    label: "Echo text",
    description: "Print a line of text to the console.",
    category: "output",
    fields: [{ key: "text", label: "Message", type: "text", placeholder: "Hello world" }]
  },
  {
    type: "blank",
    label: "Blank line",
    description: "Print an empty line (echo.).",
    category: "output",
    fields: []
  },
  {
    type: "pause",
    label: "Pause",
    description: "Wait for the user to press a key.",
    category: "system",
    fields: []
  },
  {
    type: "cls",
    label: "Clear screen",
    description: "Clear the console window.",
    category: "system",
    fields: []
  },
  {
    type: "title",
    label: "Window title",
    description: "Set the console window title.",
    category: "system",
    fields: [{ key: "text", label: "Title", type: "text", placeholder: "My Script" }]
  },
  {
    type: "color",
    label: "Console color",
    description: "Set background and text color (two hex digits).",
    category: "system",
    fields: [{ key: "code", label: "Color code", type: "text", placeholder: "0A" }]
  },
  {
    type: "set",
    label: "Set variable",
    description: "Assign a value to a variable.",
    category: "flow",
    fields: [
      { key: "name", label: "Name", type: "text", placeholder: "MYVAR" },
      { key: "value", label: "Value", type: "text", placeholder: "some value" }
    ]
  },
  {
    type: "prompt",
    label: "Ask for input",
    description: "Prompt the user and store the answer in a variable.",
    category: "flow",
    fields: [
      { key: "name", label: "Variable", type: "text", placeholder: "NAME" },
      { key: "message", label: "Prompt", type: "text", placeholder: "Enter your name:" }
    ]
  },
  {
    type: "label",
    label: "Label",
    description: "Define a jump target (:label).",
    category: "flow",
    fields: [{ key: "name", label: "Label name", type: "text", placeholder: "menu" }]
  },
  {
    type: "goto",
    label: "Go to label",
    description: "Jump to a defined label.",
    category: "flow",
    fields: [{ key: "label", label: "Label name", type: "text", placeholder: "menu" }]
  },
  {
    type: "run",
    label: "Run command",
    description: "Run a program or command line.",
    category: "system",
    fields: [{ key: "command", label: "Command", type: "text", placeholder: "ipconfig /all" }]
  },
  {
    type: "start",
    label: "Start program",
    description: "Open a program, file, or URL in a new process.",
    category: "system",
    fields: [{ key: "target", label: "Target", type: "text", placeholder: "https://solaeyn.com" }]
  },
  {
    type: "cd",
    label: "Change directory",
    description: "Change the working directory.",
    category: "files",
    fields: [{ key: "path", label: "Path", type: "text", placeholder: "C:\\Projects" }]
  },
  {
    type: "mkdir",
    label: "Make directory",
    description: "Create a folder.",
    category: "files",
    fields: [{ key: "path", label: "Path", type: "text", placeholder: "C:\\Projects\\new" }]
  },
  {
    type: "del",
    label: "Delete file",
    description: "Delete a file quietly.",
    category: "files",
    fields: [{ key: "path", label: "Path", type: "text", placeholder: "C:\\temp\\old.log" }]
  },
  {
    type: "copy",
    label: "Copy file",
    description: "Copy a file to a new location.",
    category: "files",
    fields: [
      { key: "source", label: "Source", type: "text", placeholder: "C:\\a.txt" },
      { key: "dest", label: "Destination", type: "text", placeholder: "C:\\backup\\a.txt" }
    ]
  },
  {
    type: "move",
    label: "Move file",
    description: "Move a file to a new location.",
    category: "files",
    fields: [
      { key: "source", label: "Source", type: "text", placeholder: "C:\\a.txt" },
      { key: "dest", label: "Destination", type: "text", placeholder: "C:\\archive\\a.txt" }
    ]
  },
  {
    type: "timeout",
    label: "Wait (timeout)",
    description: "Pause for a number of seconds.",
    category: "system",
    fields: [{ key: "seconds", label: "Seconds", type: "text", placeholder: "5" }]
  },
  {
    type: "ifexist",
    label: "If file exists",
    description: "Run a command only when a path exists.",
    category: "flow",
    fields: [
      { key: "path", label: "Path", type: "text", placeholder: "C:\\config.ini" },
      { key: "command", label: "Command", type: "text", placeholder: "echo Found it" }
    ]
  },
  {
    type: "exit",
    label: "Exit",
    description: "Exit the script with a status code.",
    category: "flow",
    fields: [{ key: "code", label: "Exit code", type: "text", placeholder: "0" }]
  },
  {
    type: "raw",
    label: "Raw line",
    description: "Insert one or more literal batch lines.",
    category: "system",
    fields: [{ key: "text", label: "Lines", type: "textarea", placeholder: "echo advanced usage" }]
  }
];

const BLOCK_DEFINITION_MAP = new Map<BatchBlockType, BatchBlockDefinition>(
  BATCH_BLOCK_DEFINITIONS.map((definition) => [definition.type, definition])
);

export const BATCH_BLOCK_TYPES = new Set<BatchBlockType>(BATCH_BLOCK_DEFINITIONS.map((d) => d.type));

const clampField = (value: unknown) => String(value ?? "").slice(0, MAX_FIELD_LENGTH);

/** Remove characters that would break out of a single batch line. */
const stripLineBreaks = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const sanitizeLabelName = (value: string) =>
  stripLineBreaks(value).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);

const sanitizeVarName = (value: string) =>
  stripLineBreaks(value).replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);

const sanitizeColorCode = (value: string) => {
  const code = stripLineBreaks(value).replace(/[^0-9A-Fa-f]/g, "").slice(0, 2);
  return code.toUpperCase();
};

const sanitizeNumber = (value: string, fallback: number) => {
  const parsed = Number.parseInt(stripLineBreaks(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

let idCounter = 0;
const generateBlockId = () => {
  idCounter += 1;
  return `blk_${Date.now().toString(36)}_${idCounter.toString(36)}`;
};

/** Normalize an untrusted block into a safe, stored shape. Returns null if unusable. */
export function normalizeBlock(raw: unknown): BatchBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const type = String(input.type || "") as BatchBlockType;
  if (!BATCH_BLOCK_TYPES.has(type)) return null;

  const definition = BLOCK_DEFINITION_MAP.get(type)!;
  const rawParams = (input.params && typeof input.params === "object" ? input.params : {}) as Record<string, unknown>;
  const params: Record<string, string> = {};

  for (const field of definition.fields) {
    params[field.key] = clampField(rawParams[field.key]);
  }

  const id = typeof input.id === "string" && input.id.trim()
    ? input.id.trim().slice(0, 64)
    : generateBlockId();

  return { id, type, params };
}

/** Normalize an untrusted list of blocks. */
export function normalizeBlocks(raw: unknown): BatchBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: BatchBlock[] = [];
  for (const entry of raw) {
    const block = normalizeBlock(entry);
    if (block) blocks.push(block);
    if (blocks.length >= MAX_BLOCKS) break;
  }
  return blocks;
}

/** Normalize script-level settings. */
export function normalizeSettings(raw: unknown): BatchScriptSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    echoOff: input.echoOff !== false,
    title: stripLineBreaks(clampField(input.title)).slice(0, 200),
    color: sanitizeColorCode(clampField(input.color))
  };
}

export function normalizeDraft(raw: unknown): BatchScriptDraft {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    settings: normalizeSettings(input.settings),
    blocks: normalizeBlocks(input.blocks)
  };
}

const line = (value: string) => value;

/** Render a single block to one or more batch lines. */
function renderBlock(block: BatchBlock): string[] {
  const p = block.params;

  switch (block.type) {
    case "comment": {
      const text = clampField(p.text);
      if (!text) return ["REM"];
      return text.split(/\r?\n/).map((entry) => `REM ${entry}`.trimEnd());
    }
    case "echo": {
      const text = stripLineBreaks(clampField(p.text));
      return [text ? `echo ${text}` : "echo."];
    }
    case "blank":
      return ["echo."];
    case "pause":
      return ["pause"];
    case "cls":
      return ["cls"];
    case "title":
      return [`title ${stripLineBreaks(clampField(p.text))}`.trimEnd()];
    case "color": {
      const code = sanitizeColorCode(clampField(p.code));
      return code ? [`color ${code}`] : [];
    }
    case "set": {
      const name = sanitizeVarName(clampField(p.name));
      if (!name) return [];
      const value = stripLineBreaks(clampField(p.value));
      return [`set "${name}=${value}"`];
    }
    case "prompt": {
      const name = sanitizeVarName(clampField(p.name));
      if (!name) return [];
      const message = stripLineBreaks(clampField(p.message));
      return [`set /p "${name}=${message}${message ? " " : ""}"`];
    }
    case "label": {
      const name = sanitizeLabelName(clampField(p.name));
      return name ? [`:${name}`] : [];
    }
    case "goto": {
      const label = sanitizeLabelName(clampField(p.label));
      return label ? [`goto ${label}`] : [];
    }
    case "run": {
      const command = stripLineBreaks(clampField(p.command));
      return command ? [command] : [];
    }
    case "start": {
      const target = stripLineBreaks(clampField(p.target));
      return target ? [`start "" "${target}"`] : [];
    }
    case "cd": {
      const dir = stripLineBreaks(clampField(p.path));
      return dir ? [`cd /d "${dir}"`] : [];
    }
    case "mkdir": {
      const dir = stripLineBreaks(clampField(p.path));
      return dir ? [`mkdir "${dir}"`] : [];
    }
    case "del": {
      const target = stripLineBreaks(clampField(p.path));
      return target ? [`del /q "${target}"`] : [];
    }
    case "copy": {
      const source = stripLineBreaks(clampField(p.source));
      const dest = stripLineBreaks(clampField(p.dest));
      if (!source || !dest) return [];
      return [`copy "${source}" "${dest}"`];
    }
    case "move": {
      const source = stripLineBreaks(clampField(p.source));
      const dest = stripLineBreaks(clampField(p.dest));
      if (!source || !dest) return [];
      return [`move "${source}" "${dest}"`];
    }
    case "timeout": {
      const seconds = sanitizeNumber(clampField(p.seconds), 5);
      return [`timeout /t ${seconds} /nobreak`];
    }
    case "ifexist": {
      const target = stripLineBreaks(clampField(p.path));
      const command = stripLineBreaks(clampField(p.command));
      if (!target || !command) return [];
      return [`if exist "${target}" ${command}`];
    }
    case "exit": {
      const code = sanitizeNumber(clampField(p.code), 0);
      return [`exit /b ${code}`];
    }
    case "raw": {
      const text = clampField(p.text);
      if (!text) return [];
      return text.split(/\r?\n/).map((entry) => entry.replace(/\r/g, ""));
    }
    default:
      return [];
  }
}

/** Generate the full .bat script text from a normalized draft. */
export function generateBatchScript(draft: BatchScriptDraft): string {
  const normalized = normalizeDraft(draft);
  const lines: string[] = [];

  if (normalized.settings.echoOff) {
    lines.push(line("@echo off"));
  }

  if (normalized.settings.title) {
    lines.push(`title ${normalized.settings.title}`);
  }

  if (normalized.settings.color) {
    lines.push(`color ${normalized.settings.color}`);
  }

  for (const block of normalized.blocks) {
    lines.push(...renderBlock(block));
  }

  // Batch files run best with CRLF line endings and a trailing newline.
  return lines.join("\r\n") + "\r\n";
}

/** Turn a script name into a safe .bat filename. */
export function toBatchFileName(name: string): string {
  const base = String(name || "")
    .trim()
    .replace(/[^A-Za-z0-9 _.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return `${base || "script"}.bat`;
}
