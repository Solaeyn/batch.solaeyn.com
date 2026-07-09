import { describe, expect, it } from "vitest";
import {
  BATCH_BLOCK_DEFINITIONS,
  generateBatchScript,
  normalizeBlocks,
  normalizeDraft,
  normalizeSettings,
  toBatchFileName,
  type BatchBlock
} from "../src/batch-generator.ts";

const block = (type: string, params: Record<string, string> = {}): BatchBlock => ({
  id: `id-${type}`,
  type: type as BatchBlock["type"],
  params
});

describe("batch block catalog", () => {
  it("exposes stable kebab/lowercase block types", () => {
    for (const definition of BATCH_BLOCK_DEFINITIONS) {
      expect(definition.type).toMatch(/^[a-z_]+$/);
      expect(definition.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps block types unique", () => {
    const types = BATCH_BLOCK_DEFINITIONS.map((entry) => entry.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe("normalizeSettings", () => {
  it("defaults echoOff to true and sanitizes color/title", () => {
    expect(normalizeSettings(undefined)).toEqual({ echoOff: true, title: "", color: "" });
    expect(normalizeSettings({ echoOff: false, title: "My  Tool\n", color: "zz0aQ" })).toEqual({
      echoOff: false,
      title: "My  Tool",
      color: "0A"
    });
  });
});

describe("normalizeBlocks", () => {
  it("drops unknown block types and keeps only declared fields", () => {
    const blocks = normalizeBlocks([
      { type: "echo", params: { text: "hello", bogus: "x" } },
      { type: "not-a-real-block", params: {} },
      { type: "pause", params: {} }
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("echo");
    expect(blocks[0].params).toEqual({ text: "hello" });
    expect(blocks[0].params).not.toHaveProperty("bogus");
    expect(blocks[1].type).toBe("pause");
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeBlocks(null)).toEqual([]);
    expect(normalizeBlocks("nope")).toEqual([]);
  });
});

describe("generateBatchScript", () => {
  it("adds @echo off, title, and color from settings", () => {
    const output = generateBatchScript({
      settings: { echoOff: true, title: "Demo", color: "0A" },
      blocks: [block("echo", { text: "hi" })]
    });

    expect(output.startsWith("@echo off\r\n")).toBe(true);
    expect(output).toContain("title Demo\r\n");
    expect(output).toContain("color 0A\r\n");
    expect(output).toContain("echo hi\r\n");
    expect(output.endsWith("\r\n")).toBe(true);
  });

  it("omits @echo off when disabled", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [block("echo", { text: "hi" })]
    });
    expect(output).toBe("echo hi\r\n");
  });

  it("renders empty echo as echo. and blank line block", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [block("echo", { text: "" }), block("blank", {})]
    });
    expect(output).toBe("echo.\r\necho.\r\n");
  });

  it("quotes set and prompt variables and sanitizes names", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [
        block("set", { name: "MY VAR!", value: "hello world" }),
        block("prompt", { name: "name", message: "Your name:" })
      ]
    });
    expect(output).toContain('set "MYVAR=hello world"');
    expect(output).toContain('set /p "name=Your name: "');
  });

  it("renders labels, goto, and if exist", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [
        block("label", { name: "menu" }),
        block("goto", { label: "menu" }),
        block("ifexist", { path: "C:\\a.txt", command: "echo found" })
      ]
    });
    expect(output).toContain(":menu\r\n");
    expect(output).toContain("goto menu\r\n");
    expect(output).toContain('if exist "C:\\a.txt" echo found\r\n');
  });

  it("renders file and system commands with quoting", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [
        block("cd", { path: "C:\\Projects" }),
        block("mkdir", { path: "C:\\Projects\\new" }),
        block("copy", { source: "a.txt", dest: "b.txt" }),
        block("start", { target: "https://solaeyn.com" }),
        block("timeout", { seconds: "5" }),
        block("exit", { code: "1" })
      ]
    });
    expect(output).toContain('cd /d "C:\\Projects"');
    expect(output).toContain('mkdir "C:\\Projects\\new"');
    expect(output).toContain('copy "a.txt" "b.txt"');
    expect(output).toContain('start "" "https://solaeyn.com"');
    expect(output).toContain("timeout /t 5 /nobreak");
    expect(output).toContain("exit /b 1");
  });

  it("drops incomplete blocks that would produce broken commands", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [
        block("copy", { source: "a.txt", dest: "" }),
        block("goto", { label: "" }),
        block("echo", { text: "kept" })
      ]
    });
    expect(output).toBe("echo kept\r\n");
  });

  it("prevents newline injection in single-line commands", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [block("echo", { text: "line1\r\nshutdown /s" })]
    });
    expect(output).toBe("echo line1 shutdown /s\r\n");
  });

  it("preserves multi-line comment and raw blocks", () => {
    const output = generateBatchScript({
      settings: { echoOff: false, title: "", color: "" },
      blocks: [
        block("comment", { text: "line one\nline two" }),
        block("raw", { text: "echo a\necho b" })
      ]
    });
    expect(output).toContain("REM line one\r\nREM line two\r\n");
    expect(output).toContain("echo a\r\necho b\r\n");
  });
});

describe("normalizeDraft", () => {
  it("returns safe defaults for garbage input", () => {
    expect(normalizeDraft(null)).toEqual({
      settings: { echoOff: true, title: "", color: "" },
      blocks: []
    });
  });
});

describe("toBatchFileName", () => {
  it("produces a safe .bat filename", () => {
    expect(toBatchFileName("My Cool Script")).toBe("My-Cool-Script.bat");
    expect(toBatchFileName("../../etc/passwd")).toBe("etcpasswd.bat");
    expect(toBatchFileName("")).toBe("script.bat");
  });
});
