#pragma once

#include "NotCodexMarkdownTextShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using NotCodexMarkdownTextComponentDescriptor = ConcreteComponentDescriptor<NotCodexMarkdownTextShadowNode>;

void NotCodexMarkdownTextSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
