import { useEffect, useState } from "react";

export interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const EMPTY_SHORTCUT_MODIFIER_STATE: ShortcutModifierState = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

export function areShortcutModifierStatesEqual(
  left: ShortcutModifierState,
  right: ShortcutModifierState,
): boolean {
  return (
    left.metaKey === right.metaKey &&
    left.ctrlKey === right.ctrlKey &&
    left.altKey === right.altKey &&
    left.shiftKey === right.shiftKey
  );
}

export function useShortcutModifierState(): ShortcutModifierState {
  const [state, setState] = useState(EMPTY_SHORTCUT_MODIFIER_STATE);

  useEffect(() => {
    const onKeyboardEvent = (event: KeyboardEvent) => {
      setState((current) => shortcutModifierStateAfterKeyboardEvent(current, event));
    };
    // Dictation tools can paste with a synthetic modifier key whose keyup never
    // reaches the page. A paste is never thread-jump intent, so reset here.
    const onResetEvent = () => {
      setState((current) =>
        areShortcutModifierStatesEqual(current, EMPTY_SHORTCUT_MODIFIER_STATE)
          ? current
          : EMPTY_SHORTCUT_MODIFIER_STATE,
      );
    };

    window.addEventListener("keydown", onKeyboardEvent, true);
    window.addEventListener("keyup", onKeyboardEvent, true);
    window.addEventListener("paste", onResetEvent, true);
    window.addEventListener("blur", onResetEvent);
    return () => {
      window.removeEventListener("keydown", onKeyboardEvent, true);
      window.removeEventListener("keyup", onKeyboardEvent, true);
      window.removeEventListener("paste", onResetEvent, true);
      window.removeEventListener("blur", onResetEvent);
    };
  }, []);

  return state;
}

function normalizeModifierKey(key: string): keyof ShortcutModifierState | null {
  switch (key) {
    case "Meta":
    case "OS":
    case "Command":
      return "metaKey";
    case "Control":
      return "ctrlKey";
    case "Alt":
    case "Option":
      return "altKey";
    case "Shift":
      return "shiftKey";
    default:
      return null;
  }
}

export function shortcutModifierStateAfterKeyboardEvent(
  currentState: ShortcutModifierState,
  event: KeyboardEvent,
): ShortcutModifierState {
  const normalizedModifierKey = normalizeModifierKey(event.key);
  let nextState: ShortcutModifierState;
  if (normalizedModifierKey) {
    nextState = {
      ...currentState,
      [normalizedModifierKey]: event.type === "keydown",
    };
  } else {
    // Non-modifier events may clear tracked bits, but only a real modifier
    // keydown may set them. This prevents synthetic paste state from sticking.
    nextState = {
      metaKey: currentState.metaKey && event.metaKey,
      ctrlKey: currentState.ctrlKey && event.ctrlKey,
      altKey: currentState.altKey && event.altKey,
      shiftKey: currentState.shiftKey && event.shiftKey,
    };
  }

  return areShortcutModifierStatesEqual(currentState, nextState) ? currentState : nextState;
}
