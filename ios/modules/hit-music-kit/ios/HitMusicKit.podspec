Require-Frameworks = 'true'

Pod::Spec.new do |s|
  s.name           = 'HitMusicKit'
  s.version        = '1.0.0'
  s.summary        = 'MusicKit ApplicationMusicPlayer for Hit 4 Hit'
  s.description    = 'Expo module wrapping Apple MusicKit ApplicationMusicPlayer'
  s.license        = 'MIT'
  s.author         = 'Hit 4 Hit'
  s.homepage       = 'https://hit4hit.app'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MusicKit', 'MediaPlayer'

  s.source_files = '**/*.{h,m,mm,swift}'
  s.exclude_files = '**/HitMusicKit.podspec'
end
