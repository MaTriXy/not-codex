const MINIMUM_COMPOSER_BOTTOM_INSET = 12;

export function resolveComposerBottomInset(input: {
  readonly isKeyboardVisible: boolean;
  readonly safeAreaBottom: number;
}): number {
  return input.isKeyboardVisible
    ? 0
    : Math.max(input.safeAreaBottom, MINIMUM_COMPOSER_BOTTOM_INSET);
}
