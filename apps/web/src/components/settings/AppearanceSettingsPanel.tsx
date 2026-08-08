import {
  DEFAULT_GLASS_OPACITY,
  MAX_GLASS_OPACITY,
  MIN_GLASS_OPACITY,
} from "@notcodex/contracts/settings";
import { useState, type CSSProperties } from "react";

import { useCustomThemes } from "../../hooks/useCustomThemes";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { ThemeLibrary } from "./ThemeSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

export function AppearanceSettingsPanel() {
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer className="max-w-5xl">
      <SettingsSection id="appearance" title="Appearance">
        <ThemeLibrary
          appearanceMode={appearanceMode}
          customThemes={customThemes}
          initialAppearance={resolvedTheme}
          refreshTheme={refreshTheme}
          isImportOpen={isImportThemeOpen}
          setAppearanceMode={setAppearanceMode}
          setTheme={setTheme}
          setThemeHalf={setThemeHalf}
          theme={theme}
          themeHalves={themeHalves}
          onImportOpenChange={setIsImportThemeOpen}
        />

        <SettingsRow
          title="Glass opacity"
          description="Control the transparency of menus, dialogs, toasts, and the composer."
          resetAction={
            settings.glassOpacity !== DEFAULT_GLASS_OPACITY ? (
              <SettingResetButton
                label="glass opacity"
                onClick={() => updateSettings({ glassOpacity: DEFAULT_GLASS_OPACITY })}
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label="Glass opacity"
                className="settings-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) =>
                  updateSettings({ glassOpacity: Number(event.currentTarget.value) })
                }
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
