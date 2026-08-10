import { View } from "react-native";

import { BrandMark } from "./BrandMark";

/**
 * Compact brand lockup sized for native navigation bars.
 */
export function brandTitleOffset(_nativeLeadingItem: boolean): number {
  return 0;
}

export function CompactBrandTitle(props: {
  readonly narrow?: boolean;
  readonly nativeLeadingItem?: boolean;
}) {
  return (
    <View aria-level={1} accessibilityLabel="Not Codex" accessible role="heading">
      <BrandMark compact navigation={props.narrow ?? props.nativeLeadingItem} />
    </View>
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle />;
}

export function renderCompactSidebarBrandTitle() {
  return <CompactBrandTitle narrow />;
}
