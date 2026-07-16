#pragma once

#include <react/renderer/components/NotCodexMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/NotCodexMarkdownTextSpec/Props.h>
#include <react/renderer/components/NotCodexMarkdownTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char NotCodexMarkdownTextRunComponentName[];

using NotCodexMarkdownTextRunShadowNode = ConcreteViewShadowNode<
    NotCodexMarkdownTextRunComponentName,
    NotCodexMarkdownTextRunProps,
    NotCodexMarkdownTextRunEventEmitter,
    NotCodexMarkdownTextRunState>;
}
