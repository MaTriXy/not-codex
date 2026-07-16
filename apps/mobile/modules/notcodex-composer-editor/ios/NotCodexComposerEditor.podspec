Pod::Spec.new do |s|
  s.name           = 'NotCodexComposerEditor'
  s.version        = '1.0.0'
  s.summary        = 'Native attributed composer editor for Not Codex mobile.'
  s.description    = 'UIKit-backed rich text composer with atomic skill and file tokens.'
  s.author         = 'Not Codex'
  s.homepage       = 'https://notcodex.com'
  s.platforms      = {
    :ios => '16.4',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
