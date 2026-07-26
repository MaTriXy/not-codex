package expo.modules.notcodexnativecontrols

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotCodexNativeControlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotCodexNativeControls")

    Function("getShowcasePairingUrl") {
      appContext.currentActivity?.intent?.getStringExtra("showcasePairingUrl")
    }

    Function("getShowcaseScene") {
      val storedScene = appContext.reactContext
        ?.filesDir
        ?.resolve("notcodex-showcase-scene")
        ?.takeIf { it.isFile }
        ?.readText()
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
      storedScene ?: appContext.currentActivity?.intent?.getStringExtra("showcaseScene")
    }

    Function("prepareShowcaseCapture") {
      // Android app data is cleared by the host runner before launch.
    }

    Function("markShowcaseReady") { scene: String ->
      appContext.reactContext
        ?.filesDir
        ?.resolve("notcodex-showcase-ready")
        ?.writeText(scene)
    }

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
