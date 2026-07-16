import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

const optionalBoolean = (name: string) =>
  Config.boolean(name).pipe(Config.option, Config.map(Option.getOrElse(() => false)));

const commaSeparatedStrings = (name: string) =>
  trimmedString(name).pipe(
    Config.map(
      Option.match({
        onNone: () => [],
        onSome: (value) =>
          value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
      }),
    ),
  );

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  notCodexHome: trimmedString("NOT_CODEX_HOME"),
  devServerUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option),
  appUserModelIdOverride: trimmedString("NOT_CODEX_DESKTOP_APP_USER_MODEL_ID"),
  devRemoteNotCodexServerEntryPath: trimmedString(
    "NOT_CODEX_DEV_REMOTE_NOT_CODEX_SERVER_ENTRY_PATH",
  ),
  configuredBackendPort: Config.port("NOT_CODEX_PORT").pipe(Config.option),
  commitHashOverride: trimmedString("NOT_CODEX_COMMIT_HASH"),
  desktopLanHostOverride: trimmedString("NOT_CODEX_DESKTOP_LAN_HOST"),
  desktopHttpsEndpointUrls: commaSeparatedStrings("NOT_CODEX_DESKTOP_HTTPS_ENDPOINTS"),
  otlpTracesUrl: trimmedString("NOT_CODEX_OTLP_TRACES_URL"),
  otlpExportIntervalMs: Config.int("NOT_CODEX_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: optionalBoolean("NOT_CODEX_DISABLE_AUTO_UPDATE"),
  mockUpdates: optionalBoolean("NOT_CODEX_DESKTOP_MOCK_UPDATES"),
  mockUpdateServerPort: Config.port("NOT_CODEX_DESKTOP_MOCK_UPDATE_SERVER_PORT").pipe(
    Config.withDefault(3000),
  ),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
