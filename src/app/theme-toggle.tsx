"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = (localStorage.getItem("theme") as Theme) || "system";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function cycle() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  const label = theme === "system" ? "시스템" : theme === "light" ? "라이트" : "다크";
  const icon = theme === "system" ? "💻" : theme === "light" ? "☀️" : "🌙";

  return (
    <button
      onClick={cycle}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--surface)] text-[var(--foreground)] border border-[color-mix(in_srgb,var(--foreground)_15%,transparent)] shadow-sm hover:opacity-80 transition-opacity"
      aria-label="테마 전환"
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
