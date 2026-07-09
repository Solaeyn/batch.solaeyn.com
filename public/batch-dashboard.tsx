/**
 * Shared dashboard shell logic loaded on every page: user identity, sign out,
 * and mobile navigation. Page-specific behavior lives in the per-page scripts.
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

const shellApi = async (url: string, opts: RequestInit = {}) => {
  const headers = new Headers(opts.headers || {});
  if (!(opts.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const csrfToken = getCookieValue("csrfToken");
  if (csrfToken) headers.set("x-csrf-token", csrfToken);

  const response = await fetch(url, { credentials: "same-origin", ...opts, headers });
  let data: Record<string, unknown> = {};
  if ((response.headers.get("content-type") || "").includes("application/json")) {
    data = await response.json();
  }
  return { ok: response.ok, status: response.status, data };
};

const redirectToLogin = () => {
  window.location.href = "/login";
};

const initUser = async () => {
  const userChip = document.getElementById("userChip");
  const userAvatar = document.getElementById("userAvatar");

  const result = await shellApi("/api/me");
  if (result.status === 401 || result.status === 403) {
    redirectToLogin();
    return;
  }

  const user = (result.data as { user?: { username?: string } }).user;
  const username = user?.username || "User";
  if (userChip) userChip.textContent = username;
  if (userAvatar) userAvatar.textContent = username.slice(0, 1).toUpperCase();
};

const initLogout = () => {
  const logoutButton = document.getElementById("logoutButton") as HTMLButtonElement | null;
  if (!logoutButton) return;
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    await shellApi("/api/logout", { method: "POST" }).catch(() => {});
    redirectToLogin();
  });
};

const initMobileNav = () => {
  const shell = document.querySelector(".workspace-shell") as HTMLElement | null;
  const menuBtn = document.getElementById("mobileMenuBtn") as HTMLButtonElement | null;
  const backdrop = document.getElementById("mobileNavBackdrop") as HTMLButtonElement | null;
  if (!shell || !menuBtn) return;

  const setOpen = (open: boolean) => {
    shell.classList.toggle("mobile-nav-open", open);
    document.body.classList.toggle("mobile-nav-open", open);
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  menuBtn.addEventListener("click", () => setOpen(!shell.classList.contains("mobile-nav-open")));
  backdrop?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
};

const initRefresh = () => {
  const refreshBtn = document.getElementById("refreshBtn") as HTMLButtonElement | null;
  refreshBtn?.addEventListener("click", () => window.location.reload());
};

initUser();
initLogout();
initMobileNav();
initRefresh();
