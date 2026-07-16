import { View } from "react-native";

import { NotCodexHeaderButton } from "../../native/NotCodexHeaderButton.android";
import type { SidebarHeaderActionsProps } from "./sidebar-header-actions";

export function SidebarHeaderActions(props: SidebarHeaderActionsProps) {
  return (
    <View className="h-11 flex-row gap-1">
      <NotCodexHeaderButton
        accessibilityLabel="Open settings"
        icon="gearshape"
        onPress={props.onOpenSettings}
      />
    </View>
  );
}
