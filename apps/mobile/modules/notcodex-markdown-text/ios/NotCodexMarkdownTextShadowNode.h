#pragma once

#include <react/renderer/components/NotCodexMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/NotCodexMarkdownTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char NotCodexMarkdownTextComponentName[];

struct NotCodexMarkdownTextParagraphStyleRange {
  size_t location;
  size_t length;
  Float firstLineHeadIndent;
  Float headIndent;
  Float paragraphSpacing;
};

struct NotCodexMarkdownTextAttachmentRange {
  size_t location;
  size_t length;
  std::string imageUri;
};

inline Float NotCodexMarkdownTextAttachmentSize(const NotCodexMarkdownTextAttachmentRange &) {
  return 14;
}

inline Float NotCodexMarkdownTextAttachmentBaselineOffset(
    const NotCodexMarkdownTextAttachmentRange &) {
  return -2;
}

class NotCodexMarkdownTextStateReal final {
 public:
  AttributedString attributedString;
  std::vector<NotCodexMarkdownTextParagraphStyleRange> paragraphStyleRanges;
  std::vector<NotCodexMarkdownTextAttachmentRange> attachmentRanges;
};

class NotCodexMarkdownTextShadowNode final : public ConcreteViewShadowNode<
NotCodexMarkdownTextComponentName,
NotCodexMarkdownTextProps,
NotCodexMarkdownTextEventEmitter,
NotCodexMarkdownTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  NotCodexMarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
  );

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
  mutable std::vector<NotCodexMarkdownTextParagraphStyleRange> _paragraphStyleRanges;
  mutable std::vector<NotCodexMarkdownTextAttachmentRange> _attachmentRanges;
};
} // namespace facebook::React
