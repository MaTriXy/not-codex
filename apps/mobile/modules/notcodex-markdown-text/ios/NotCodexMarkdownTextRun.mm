#import "NotCodexMarkdownTextRun.h"
#import "NotCodexMarkdownText.h"
#import "NotCodexMarkdownTextRunComponentDescriptor.h"
#import <react/renderer/components/NotCodexMarkdownTextSpec/EventEmitters.h>
#import <react/renderer/components/NotCodexMarkdownTextSpec/Props.h>
#import <react/renderer/components/NotCodexMarkdownTextSpec/RCTComponentViewHelpers.h>
#import "RCTFabricComponentsPlugins.h"
#import "Utils.h"

using namespace facebook::react;

@interface NotCodexMarkdownTextRun () <RCTNotCodexMarkdownTextRunViewProtocol>

@end

@implementation NotCodexMarkdownTextRun {
  NSString * _text;
  RCTBubblingEventBlock _onPress;
  RCTBubblingEventBlock _onLongPress;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
    return concreteComponentDescriptorProvider<NotCodexMarkdownTextRunComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NotCodexMarkdownTextRunProps>();
    _props = defaultProps;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldViewProps = *std::static_pointer_cast<NotCodexMarkdownTextRunProps const>(_props);
  const auto &newViewProps = *std::static_pointer_cast<NotCodexMarkdownTextRunProps const>(props);

  if (newViewProps.text != oldViewProps.text) {
    NSString *text = [NSString stringWithUTF8String:newViewProps.text.c_str()];
    _text = text;
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)onPress {
  if (_eventEmitter != nullptr) {
    std::dynamic_pointer_cast<const facebook::react::NotCodexMarkdownTextRunEventEmitter>(_eventEmitter)
    ->onPress(facebook::react::NotCodexMarkdownTextRunEventEmitter::OnPress{});
  }
}

- (void)onLongPress {
  if (_eventEmitter != nullptr) {
    std::dynamic_pointer_cast<const facebook::react::NotCodexMarkdownTextRunEventEmitter>(_eventEmitter)
    ->onLongPress(facebook::react::NotCodexMarkdownTextRunEventEmitter::OnLongPress{});
  }
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

Class<RCTComponentViewProtocol> NotCodexMarkdownTextRunCls(void)
{
    return NotCodexMarkdownTextRun.class;
}

@end
