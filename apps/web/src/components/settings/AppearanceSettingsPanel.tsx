import {
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_GLASS_OPACITY,
  MAX_GLASS_OPACITY,
  MAX_TERMINAL_FONT_SIZE,
  MIN_GLASS_OPACITY,
  MIN_TERMINAL_FONT_SIZE,
} from "@notcodex/contracts/settings";
import { useMemo, useState, type CSSProperties } from "react";

import { DEFAULT_CODE_FONT_STACK, resolveDefaultFamilyLabel } from "../../appearanceFonts";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { Input } from "../ui/input";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { discoverInstalledFonts, FontFamilyPicker, useFontEnumeration } from "./FontFamilyPicker";
import { TerminalFontPreview } from "./TerminalFontPreview";
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
  const fontEnumeration = useFontEnumeration();
  const defaultTerminalFamily = useMemo(
    () => resolveDefaultFamilyLabel(DEFAULT_CODE_FONT_STACK) ?? "System monospace",
    [],
  );
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

      <SettingsSection id="typography" title="Typography">
        <SettingsRow
          title="Terminal font"
          description="Choose the monospace family and size used by every terminal pane. New splits inherit the same settings."
          resetAction={
            settings.fontFamilyTerminal.length > 0 ||
            settings.fontSizeTerminal !== DEFAULT_TERMINAL_FONT_SIZE ? (
              <SettingResetButton
                label="terminal font"
                onClick={() =>
                  updateSettings({
                    fontFamilyTerminal: "",
                    fontSizeTerminal: DEFAULT_TERMINAL_FONT_SIZE,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="grid w-full grid-cols-[minmax(0,1fr)_7.5rem] gap-2 sm:w-96">
              {fontEnumeration.status === "granted" ? (
                <FontFamilyPicker
                  ariaLabel="Terminal font family"
                  defaultFamily={defaultTerminalFamily}
                  onSelect={(fontFamilyTerminal) => updateSettings({ fontFamilyTerminal })}
                  requireMonospace
                  selectedFamily={settings.fontFamilyTerminal}
                />
              ) : (
                <Input
                  aria-label="Terminal font family"
                  maxLength={200}
                  onChange={(event) =>
                    updateSettings({ fontFamilyTerminal: event.currentTarget.value })
                  }
                  onFocus={discoverInstalledFonts}
                  placeholder={defaultTerminalFamily}
                  value={settings.fontFamilyTerminal}
                />
              )}
              <NumberField
                aria-label="Terminal font size"
                className="w-full"
                max={MAX_TERMINAL_FONT_SIZE}
                min={MIN_TERMINAL_FONT_SIZE}
                onValueChange={(fontSizeTerminal) => {
                  if (fontSizeTerminal !== null) updateSettings({ fontSizeTerminal });
                }}
                size="sm"
                value={settings.fontSizeTerminal}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement aria-label="Decrease terminal font size" />
                  <NumberFieldInput aria-label="Terminal font size in pixels" />
                  <NumberFieldIncrement aria-label="Increase terminal font size" />
                </NumberFieldGroup>
              </NumberField>
            </div>
          }
        >
          <TerminalFontPreview
            family={settings.fontFamilyTerminal}
            size={settings.fontSizeTerminal}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
