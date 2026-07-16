#pragma once

#include "NotCodexMarkdownTextRunShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using NotCodexMarkdownTextRunComponentDescriptor = ConcreteComponentDescriptor<NotCodexMarkdownTextRunShadowNode>;

void NotCodexMarkdownTextRunSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
