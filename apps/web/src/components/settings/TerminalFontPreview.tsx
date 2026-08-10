import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import {
  appearanceFontStack,
  clampTerminalFontSize,
  DEFAULT_CODE_FONT_STACK,
} from "../../appearanceFonts";
import { useTheme } from "../../hooks/useTheme";
import { terminalThemeFromApp } from "../ThreadTerminalDrawer";

const TERMINAL_PROMPT =
  "\x1b[1;32m→\x1b[0m \x1b[1;36mnot-codex\x1b[0m \x1b[1;34mgit:(\x1b[1;31mmain\x1b[1;34m)\x1b[0m \x1b[1;33m✗\x1b[0m ";

const TERMINAL_PREVIEW_TRANSCRIPT =
  `${TERMINAL_PROMPT}vp dev\r\n` +
  "\r\n" +
  "  \x1b[1;32mVITE\x1b[0m \x1b[32mv7.1.1\x1b[0m  \x1b[2mready in\x1b[0m \x1b[1m1.24s\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[32m→\x1b[0m  \x1b[2mLocal:\x1b[0m    \x1b[4;36mhttp://127.0.0.1:5173/\x1b[0m\r\n" +
  "  \x1b[32m→\x1b[0m  \x1b[2mNetwork:\x1b[0m  \x1b[4;36mhttp://192.168.1.24:5173/\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[32m✓ 85 passed\x1b[0m   \x1b[33m△ 2 warnings\x1b[0m   \x1b[31m✗ 0 failed\x1b[0m\r\n" +
  "\r\n" +
  "  \x1b[42;30m READY \x1b[0m \x1b[2mwatching for changes — press\x1b[0m \x1b[1mq\x1b[0m \x1b[2mto quit\x1b[0m\r\n" +
  "\r\n" +
  TERMINAL_PROMPT;

export function TerminalFontPreview({ family, size }: { family: string; size: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    terminal.options.fontFamily = appearanceFontStack(family, DEFAULT_CODE_FONT_STACK);
    terminal.options.fontSize = clampTerminalFontSize(size);
    const frame = window.requestAnimationFrame(() => fitAddon.fit());
    return () => window.cancelAnimationFrame(frame);
  }, [family, size]);

  useEffect(() => {
    const mount = mountRef.current;
    const terminal = terminalRef.current;
    if (!mount || !terminal) return;
    terminal.options.theme = terminalThemeFromApp(mount);
    terminal.refresh(0, terminal.rows - 1);
  }, [resolvedTheme]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const fitAddon = new FitAddon();
    const theme = terminalThemeFromApp(mount);
    mount.style.backgroundColor = theme.background ?? "";
    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: appearanceFontStack(family, DEFAULT_CODE_FONT_STACK),
      fontSize: clampTerminalFontSize(size),
      lineHeight: 1.1,
      scrollback: 0,
      theme,
    });
    terminal.loadAddon(fitAddon);
    terminal.open(mount);
    fitAddon.fit();
    terminal.write(TERMINAL_PREVIEW_TRANSCRIPT);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            try {
              fitAddon.fit();
            } catch {
              // The settings panel may be between layouts while switching routes.
            }
          });
    resizeObserver?.observe(mount);

    return () => {
      resizeObserver?.disconnect();
      terminalRef.current = null;
      fitAddonRef.current = null;
      mount.style.backgroundColor = "";
      terminal.dispose();
    };
    // Font changes are applied in place above so the preview does not flash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={mountRef}
      aria-label="Terminal font preview"
      className="pointer-events-none mt-3 mb-4 h-52 overflow-hidden rounded-xl border border-border bg-background p-1"
      role="img"
    />
  );
}
