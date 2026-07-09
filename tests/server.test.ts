import request from "supertest";
import { renderDashboardPage } from "../src/dashboard-pages.ts";

process.env.NODE_ENV = "test";
process.env.AUTH_LOGIN_URL = "https://solaeyn.com/login";
process.env.SESSION_COOKIE_DOMAIN = ".solaeyn.com";

let app: any;

beforeAll(async () => {
  ({ app } = await import("../src/server.ts"));
});

describe("dashboard page rendering", () => {
  it("renders each section with the shared shell and both scripts", () => {
    for (const section of ["overview", "scripts", "builder"] as const) {
      const html = renderDashboardPage(section, "test-nonce");
      expect(html).toContain("<!doctype html>");
      expect(html).toContain('src="/batch-dashboard.js"');
      expect(html).toContain(`src="/dashboard/pages/${section}.js"`);
      expect(html).toContain('nonce="test-nonce"');
      expect(html).toContain(`data-workspace-section="${section}"`);
    }
  });
});

describe("API auth behavior", () => {
  it("returns JSON 401 for protected reads when unauthenticated", async () => {
    const res = await request(app).get("/api/scripts");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ success: false });
  });

  it("returns JSON 401 for protected writes when unauthenticated", async () => {
    const res = await request(app).post("/api/scripts").send({ name: "test" });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ success: false });
  });

  it("protects the block and command catalogs behind auth", async () => {
    const blocks = await request(app).get("/api/blocks/catalog");
    const commands = await request(app).get("/api/commands/catalog");
    expect(blocks.status).toBe(401);
    expect(commands.status).toBe(401);
    expect(commands.body).toMatchObject({ success: false });
  });
});

describe("page auth behavior", () => {
  it("redirects unauthenticated dashboard requests to the login URL", async () => {
    const res = await request(app).get("/home");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://solaeyn.com/login");
  });

  it("redirects /login to the configured auth URL", async () => {
    const res = await request(app).get("/login");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://solaeyn.com/login");
  });
});

describe("security headers", () => {
  it("sets a content security policy with a script nonce", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.headers["content-security-policy"]).toContain("script-src");
    expect(res.headers["content-security-policy"]).toContain("'nonce-");
  });
});
