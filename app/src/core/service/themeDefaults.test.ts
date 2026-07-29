import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_SETTINGS } from "./themeDefaults";

describe("default theme settings", () => {
  it("opens a new installation in the light Morandi theme", () => {
    expect(DEFAULT_THEME_SETTINGS).toEqual({
      theme: "morandi",
      themeMode: "light",
      lightTheme: "morandi",
      darkTheme: "dark",
    });
  });
});
