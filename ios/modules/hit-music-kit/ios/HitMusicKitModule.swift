import ExpoModulesCore
import MusicKit

/**
 * Native bridge for Apple MusicKit `ApplicationMusicPlayer`.
 * Full catalog playback on the host device (Bluetooth / AirPlay / built-in).
 */
public class HitMusicKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HitMusicKit")

    AsyncFunction("authorize") { () -> String in
      let status = await MusicAuthorization.request()
      switch status {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "notDetermined"
      @unknown default: return "unknown"
      }
    }

    AsyncFunction("getAuthorizationStatus") { () -> String in
      switch MusicAuthorization.currentStatus {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "notDetermined"
      @unknown default: return "unknown"
      }
    }

    AsyncFunction("checkSubscription") { () -> [String: Any] in
      do {
        let sub = try await MusicSubscription.current
        return [
          "canPlayCatalogContent": sub.canPlayCatalogContent,
        ]
      } catch {
        return [
          "canPlayCatalogContent": false,
          "error": error.localizedDescription,
        ]
      }
    }

    AsyncFunction("playSong") { (songId: String) in
      let id = MusicItemID(songId)
      let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: id)
      let response = try await request.response()
      guard let song = response.items.first else {
        throw Exception(name: "SongNotFound", description: "No Apple Music song for id \(songId)")
      }
      let player = ApplicationMusicPlayer.shared
      player.queue = [song]
      try await player.play()
    }

    AsyncFunction("pause") { () in
      ApplicationMusicPlayer.shared.pause()
    }

    AsyncFunction("resume") { () in
      try await ApplicationMusicPlayer.shared.play()
    }

    AsyncFunction("stop") { () in
      ApplicationMusicPlayer.shared.stop()
      ApplicationMusicPlayer.shared.queue = []
    }

    AsyncFunction("skip") { () in
      ApplicationMusicPlayer.shared.stop()
      ApplicationMusicPlayer.shared.queue = []
    }

    AsyncFunction("getPlayerState") { () -> [String: Any] in
      let player = ApplicationMusicPlayer.shared
      let state: String
      switch player.state.playbackStatus {
      case .playing: state = "playing"
      case .paused: state = "paused"
      case .stopped: state = "stopped"
      case .interrupted: state = "interrupted"
      @unknown default: state = "unknown"
      }
      var payload: [String: Any] = [
        "status": state,
        "playbackTime": player.playbackTime,
      ]
      if let entry = player.queue.currentEntry,
         let song = entry.item as? Song {
        payload["title"] = song.title
        payload["artist"] = song.artistName
        if let url = song.artwork?.url(width: 300, height: 300) {
          payload["albumArt"] = url.absoluteString
        }
      }
      return payload
    }
  }
}
