import { describe, expect, it } from "vitest";
import { WINDOWS_COMMANDS } from "../src/windows-commands.ts";

describe("windows command reference", () => {
  it("provides a substantial catalog", () => {
    expect(WINDOWS_COMMANDS.length).toBeGreaterThan(120);
  });

  it("gives every command a name, category, and description", () => {
    for (const command of WINDOWS_COMMANDS) {
      expect(command.name.trim().length).toBeGreaterThan(0);
      expect(command.category.trim().length).toBeGreaterThan(0);
      expect(command.description.trim().length).toBeGreaterThan(10);
    }
  });

  it("has no duplicate command names", () => {
    const names = WINDOWS_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("supports sentence-style keyword lookup in descriptions", () => {
    // Mirrors the builder's token scoring: rank by number of matching tokens.
    const search = (query: string) => {
      const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
      return WINDOWS_COMMANDS
        .map((command) => {
          const haystack = `${command.name} ${command.category} ${command.description}`.toLowerCase();
          let score = 0;
          for (const token of tokens) {
            if (command.name.toLowerCase() === token) score += 5;
            else if (haystack.includes(token)) score += 1;
          }
          return { name: command.name, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.name);
    };

    expect(search("show my ip address")).toContain("ipconfig");
    expect(search("delete a folder")).toContain("rmdir");
    expect(search("end a running process")).toContain("taskkill");
  });
});
