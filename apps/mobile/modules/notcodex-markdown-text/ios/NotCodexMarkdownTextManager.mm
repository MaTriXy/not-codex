#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "RCTBridge.h"
#import "Utils.h"

@interface NotCodexMarkdownTextManager : RCTViewManager
@end

@implementation NotCodexMarkdownTextManager

RCT_EXPORT_MODULE(NotCodexMarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface NotCodexMarkdownTextRunManager : RCTViewManager
@end

@implementation NotCodexMarkdownTextRunManager

RCT_EXPORT_MODULE(NotCodexMarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
