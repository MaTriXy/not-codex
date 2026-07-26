import { Image, View } from "react-native";

import { AppText as Text } from "./AppText";

// Keep the in-app wordmark tied to the release mobile asset. Development builds may
// use a channel-specific launcher icon, but product UI should always show the canonical mark.
const BRAND_MARK_SOURCE = require("../../assets/icon-composer-prod.icon/Assets/NotCodex.png");

export function BrandMark(props: {
  readonly compact?: boolean;
  readonly navigation?: boolean;
  readonly stageLabel?: string;
}) {
  const navigation = props.navigation ?? false;
  const compact = (props.compact ?? false) || navigation;
  const iconSize = navigation ? 22 : compact ? 32 : 44;
  const stageLabel = props.stageLabel ?? "Alpha";

  return (
    <View className={navigation ? "flex-row items-center gap-2" : "flex-row items-center gap-3"}>
      <Image
        source={BRAND_MARK_SOURCE}
        accessibilityIgnoresInvertColors
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: navigation ? 7 : compact ? 10 : 14,
        }}
      />
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text
            className={
              navigation
                ? "text-sm font-notcodex-bold tracking-[-0.3px] text-foreground"
                : "text-lg font-notcodex-bold tracking-[-0.4px] text-foreground"
            }
          >
            Not Codex
          </Text>
          {!navigation ? (
            <View className="rounded-full bg-subtle px-2 py-1">
              <Text className="text-3xs font-notcodex-bold tracking-[1.1px] uppercase text-foreground-muted">
                {stageLabel}
              </Text>
            </View>
          ) : null}
        </View>
        {!compact ? (
          <Text className="text-xs font-medium text-foreground-muted">
            Mobile control surface for your live coding environments
          </Text>
        ) : null}
      </View>
    </View>
  );
}
