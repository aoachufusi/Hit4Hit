import HitForHit from "./hit-for-hit-v2.jsx";
import { SpotifyProvider } from "./SpotifyProvider.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

export default function App() {
  return (
    <ErrorBoundary>
      <SpotifyProvider>
        <HitForHit />
      </SpotifyProvider>
    </ErrorBoundary>
  );
}
