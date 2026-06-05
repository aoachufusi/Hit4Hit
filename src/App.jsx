import HitForHit from "./hit-for-hit-v2.jsx";
import { SpotifyProvider } from "./SpotifyProvider.jsx";

export default function App() {
  return (
    <SpotifyProvider>
      <HitForHit />
    </SpotifyProvider>
  );
}
