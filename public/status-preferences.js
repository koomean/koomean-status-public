"use strict";

(() => {
  const storageKeys = { theme: "koomean-status-theme", language: "koomean-status-language" };
  const choices = { theme: ["system", "light", "dark"], language: ["system", "th", "en"] };
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const themeColor = document.querySelector('meta[name="theme-color"]');

  function read(preference) {
    try {
      const value = localStorage.getItem(storageKeys[preference]);
      if (choices[preference].includes(value)) return value;
    } catch {
      // Use the system preference if browser storage is unavailable.
    }
    return "system";
  }

  const selected = { theme: read("theme"), language: read("language") };

  function applyTheme() {
    const theme = selected.theme === "system" ? (systemTheme.matches ? "dark" : "light") : selected.theme;
    root.dataset.theme = theme;
    themeColor.setAttribute("content", theme === "dark" ? "#101722" : "#f4f6fa");
  }

  function set(preference, value) {
    if (!choices[preference]?.includes(value)) return;
    selected[preference] = value;
    try {
      if (value === "system") localStorage.removeItem(storageKeys[preference]);
      else localStorage.setItem(storageKeys[preference], value);
    } catch {
      // Keep the current choice for this page even without persistent storage.
    }
    if (preference === "theme") applyTheme();
  }

  systemTheme.addEventListener("change", () => {
    if (selected.theme === "system") applyTheme();
  });
  applyTheme();
  globalThis.statusPreferences = { get: (preference) => selected[preference], set };
})();
