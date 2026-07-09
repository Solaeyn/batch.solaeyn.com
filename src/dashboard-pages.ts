import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DashboardPageSection = "overview" | "scripts" | "builder";

type DashboardPageConfig = {
  route: string;
  railLabel: string;
  title: string;
  subtitle: string;
  fragmentFile: string;
  primaryActionLabel: string;
  primaryActionHref: string;
};

const DASHBOARD_PAGE_CONFIG: Record<DashboardPageSection, DashboardPageConfig> = {
  overview: {
    route: "/home",
    railLabel: "Overview",
    title: "Overview",
    subtitle: "Your saved batch scripts, block totals, and recent activity.",
    fragmentFile: "overview.html",
    primaryActionLabel: "New script",
    primaryActionHref: "/home/builder"
  },
  scripts: {
    route: "/home/scripts",
    railLabel: "Scripts",
    title: "Scripts",
    subtitle: "Manage, edit, and download the .bat scripts you have saved.",
    fragmentFile: "scripts.html",
    primaryActionLabel: "New script",
    primaryActionHref: "/home/builder"
  },
  builder: {
    route: "/home/builder",
    railLabel: "Builder",
    title: "Builder",
    subtitle: "Add command blocks, preview the generated .bat, and download or save.",
    fragmentFile: "builder.html",
    primaryActionLabel: "All scripts",
    primaryActionHref: "/home/scripts"
  }
};

const fragmentDirectory = path.join(__dirname, "..", "private", "dashboard");

const readDashboardFragment = (fileName: string) =>
  readFileSync(path.join(fragmentDirectory, fileName), "utf8");

const DASHBOARD_PAGE_CONTENT = Object.fromEntries(
  Object.entries(DASHBOARD_PAGE_CONFIG).map(([section, config]) => [section, readDashboardFragment(config.fragmentFile)])
) as Record<DashboardPageSection, string>;

const DASHBOARD_NAV_ICONS: Record<DashboardPageSection, string> = {
  overview: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 10.5 12 3l9 7.5"></path>
      <path d="M5 9.5V20h14V9.5"></path>
    </svg>
  `,
  scripts: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 3h6l4 4v14H6V5a2 2 0 0 1 2-2z"></path>
      <path d="M14 3v4h4"></path>
      <path d="M9 13h6"></path>
      <path d="M9 17h4"></path>
    </svg>
  `,
  builder: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="5" rx="1.5"></rect>
      <rect x="3" y="12" width="18" height="5" rx="1.5"></rect>
      <path d="M8 19h8"></path>
    </svg>
  `
};

const renderWorkspaceLink = (currentSection: DashboardPageSection, section: DashboardPageSection) => {
  const config = DASHBOARD_PAGE_CONFIG[section];
  const isActive = currentSection === section;

  return `
    <a class="rail-link${isActive ? " active" : ""}" href="${config.route}"${isActive ? ' aria-current="page"' : ""} data-workspace-section="${section}">
      <span class="nav-icon" aria-hidden="true">${DASHBOARD_NAV_ICONS[section]}</span>
      <span class="rail-label">${config.railLabel}</span>
    </a>
  `;
};

export const renderDashboardPage = (section: DashboardPageSection, cspNonce = "") => {
  const config = DASHBOARD_PAGE_CONFIG[section];
  const scriptNonceAttribute = cspNonce ? ` nonce="${cspNonce}"` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${config.title} - Solaeyn's .bat Builder</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/batch-dashboard.css" />
    <link rel="stylesheet" href="/dashboard/styles/base.css" />
    <link rel="stylesheet" href="/dashboard/styles/${section}.css" />
  </head>
  <body data-workspace-section="${section}">
    <main class="workspace-shell">
      <aside class="workspace-rail" id="workspaceRail" aria-label="Workspace navigation">
        <div class="rail-brand">
          <span class="rail-brand-mark" aria-hidden="true">.bat</span>
          <div>
            <p>Solaeyn</p>
            <span>.bat Builder</span>
          </div>
        </div>

        <nav class="rail-nav">
          ${renderWorkspaceLink(section, "overview")}
          ${renderWorkspaceLink(section, "scripts")}
          ${renderWorkspaceLink(section, "builder")}
        </nav>

        <div class="rail-user">
          <div class="avatar" id="userAvatar">?</div>
          <div class="rail-user-info">
            <p id="userChip">loading</p>
            <button id="logoutButton" class="logout-link" type="button">Sign out</button>
          </div>
        </div>
      </aside>

      <button class="mobile-nav-backdrop" id="mobileNavBackdrop" type="button" aria-label="Close navigation"></button>

      <section class="workspace-main">
        <header class="topbar">
          <div class="brand-wrap">
            <div class="mobile-brand-line" aria-label="Workspace header">
              <button
                class="mobile-menu-btn"
                id="mobileMenuBtn"
                type="button"
                aria-label="Open navigation"
                aria-controls="workspaceRail"
                aria-expanded="false"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M4 7h16"></path>
                  <path d="M4 12h16"></path>
                  <path d="M4 17h16"></path>
                </svg>
              </button>
              <span class="mobile-brand-mark" aria-hidden="true">.bat</span>
              <span class="mobile-brand-name">Solaeyn</span>
            </div>
            <span class="page-kicker">Solaeyn / .bat Builder</span>
            <h1 id="greeting">${config.title}</h1>
            <p class="brand-sub">${config.subtitle}</p>
          </div>

          <div class="topbar-actions">
            <button class="btn btn-ghost btn-compact" id="refreshBtn" type="button">Refresh</button>
            <a class="btn btn-primary" href="${config.primaryActionHref}">${config.primaryActionLabel}</a>
          </div>
        </header>

        ${DASHBOARD_PAGE_CONTENT[section]}

        <p id="dashboardMessage" class="dashboard-message" aria-live="polite"></p>
      </section>
    </main>

    <script type="module" src="/batch-dashboard.js"${scriptNonceAttribute}></script>
    <script type="module" src="/dashboard/pages/${section}.js"${scriptNonceAttribute}></script>
  </body>
</html>`;
};
