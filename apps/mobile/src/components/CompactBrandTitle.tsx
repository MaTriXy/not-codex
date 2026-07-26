import { View } from "react-native";

import { BrandMark } from "./BrandMark";

/**
 * Compact brand lockup sized for native navigation bars.
 */
export function CompactBrandTitle(props: { readonly narrow?: boolean }) {
  return (
    <View aria-level={1} accessibilityLabel="Not Codex" accessible role="heading">
      <BrandMark compact navigation={props.narrow} />
    </View>
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle />;
}

export function renderCompactSidebarBrandTitle() {
  return <CompactBrandTitle narrow />;
}
