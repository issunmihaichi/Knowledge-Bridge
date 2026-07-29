export const DEFAULT_THEME_SETTINGS = {
  theme: "morandi",
  themeMode: "light",
  lightTheme: "morandi",
  darkTheme: "dark",
} as const;

export type ThemeSettings = {
  theme: string;
  themeMode: "light" | "dark";
  lightTheme: string;
  darkTheme: string;
};

export function resolveStartupThemeSettings(saved: Partial<ThemeSettings>): ThemeSettings {
  const merged: ThemeSettings = { ...DEFAULT_THEME_SETTINGS, ...saved };
  const inferredMode = saved.themeMode ?? (saved.theme && saved.theme === merged.darkTheme ? "dark" : "light");

  return {
    ...merged,
    themeMode: inferredMode,
    theme: inferredMode === "dark" ? merged.darkTheme : merged.lightTheme,
  };
}
