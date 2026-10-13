"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "dds-theme";
type Theme = "light" | "dark";

// The page's theme lives on <html data-theme="...">. The script in layout.tsx
// sets it before first paint; this component reads and changes it.
function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// Tell React when the attribute changes, so the label stays correct.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

// On the server (and while hydrating) the theme is unknown, so we render a
// neutral label. That keeps server and browser HTML identical.
function readThemeOnServer(): Theme | null {
  return null;
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, readTheme, readThemeOnServer);

  function toggle() {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage is blocked: the theme still changes now, it just will not be remembered.
    }
  }

  const target = theme === "dark" ? "light" : "dark";
  const label = theme === null ? "Switch colour theme" : `Switch to ${target} theme`;
  const text = theme === null ? "Theme" : target === "dark" ? "Dark" : "Light";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className="min-h-10 border border-ink px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink transition-colors hover:bg-ink hover:text-paper"
    >
      {text}
    </button>
  );
}