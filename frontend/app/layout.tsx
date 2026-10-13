import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deadlock Detection Simulator",
  description:
    "An interactive simulator for multiple-instance deadlock detection, with a step-by-step trace of the algorithm.",
};

// Runs in <head> before the page paints, so the right theme is set from the
// first frame. Order of preference: saved choice, then the system setting,
// then light. Every browser call is wrapped in try/catch because storage can
// be blocked (private windows, strict privacy settings).
const themeScript = `
(function () {
  var theme = null;
  try { theme = window.localStorage.getItem("dds-theme"); } catch (e) { theme = null; }
  if (theme !== "light" && theme !== "dark") {
    var dark = false;
    try { dark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { dark = false; }
    theme = dark ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the script above adds data-theme to <html>
    // before React loads. This only silences that one attribute difference.
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
