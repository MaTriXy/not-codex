import ExpoModulesCore

public final class NotCodexNativeControlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotCodexNativeControls")

    View(NotCodexHeaderButtonView.self) {
      Prop("label") { (view: NotCodexHeaderButtonView, label: String) in
        view.setLabel(label)
      }
      Prop("systemImage") { (view: NotCodexHeaderButtonView, systemImage: String) in
        view.setSystemImage(systemImage)
      }

      Events("onTriggered")
    }
  }
}
