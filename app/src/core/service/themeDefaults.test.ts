import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_SETTINGS, resolveStartupThemeSettings } from "./themeDefaults";

describe("default theme settings", () => {
  it("opens a new installation in the light Morandi theme", () => {
    expect(DEFAULT_THEME_SETTINGS).toEqual({
      theme: "morandi",
      themeMode: "light",
      lightTheme: "morandi",
      darkTheme: "dark",
    });
  });

  it("migrates the legacy generated dark-blue setting before the first render", () => {
    expect(
      resolveStartupThemeSettings({
        theme: "dark-blue",
        darkTheme: "dark",
      }),
    ).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it("preserves a dark theme that the user explicitly selected", () => {
    expect(
      resolveStartupThemeSettings({
        theme: "dark-blue",
        darkTheme: "dark-blue",
      }),
    ).toEqual({
      theme: "dark-blue",
      themeMode: "dark",
      lightTheme: "morandi",
      darkTheme: "dark-blue",
    });
  });

  it("respects an explicitly stored dark mode", () => {
    expect(
      resolveStartupThemeSettings({
        theme: "morandi",
        themeMode: "dark",
        darkTheme: "dark",
      }),
    ).toEqual({
      theme: "dark",
      themeMode: "dark",
      lightTheme: "morandi",
      darkTheme: "dark",
    });
  });
});
