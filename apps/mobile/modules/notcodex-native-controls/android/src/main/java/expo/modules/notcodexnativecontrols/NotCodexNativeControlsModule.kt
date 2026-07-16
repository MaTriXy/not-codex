package expo.modules.notcodexnativecontrols

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotCodexNativeControlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotCodexNativeControls")

    View(NotCodexHeaderButtonView::class) {
      Prop("label") { view: NotCodexHeaderButtonView, label: String ->
        view.setLabel(label)
      }
      Prop("systemImage") { view: NotCodexHeaderButtonView, systemImage: String ->
        view.setSystemImage(systemImage)
      }

      Events("onTriggered")
    }
  }
}
