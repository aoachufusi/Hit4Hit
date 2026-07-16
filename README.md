# Hit 4 Hit — Monorepo

Multiplayer music battle game with a **web app** (Vite + React) and an **iOS app** (React Native / Expo). Shared game constants and utilities live in `/shared` so both clients stay in sync.

## Structure

```
hit-for-hit/
├── shared/                 # Code used by web and mobile
│   ├── constants/
│   │   ├── gameConfig.js   # Game phases (lobby, listening, judging, …)
│   │   ├── musicConstants.js
│   │   └── punishments.js  # Round & final punishment lists
│   └── utils/
│       └── sanitize.js     # Name, song, and code validation
├── web/                    # Vite + React web app (production: hit4hit.app)
│   ├── api/                # Vercel serverless routes
│   ├── public/
│   ├── server/             # Local dev API (Spotify / Apple Music proxy)
│   ├── src/                # Web-only UI, Firebase, music SDKs
│   ├── index.html
│   ├── package.json
│   └── vercel.json
├── ios/                    # React Native / Expo app
│   ├── App.js
│   ├── metro.config.js     # Monorepo + shared folder watching
│   ├── babel.config.js     # @shared import alias
│   └── package.json
├── package.json            # Workspace root — run scripts from here
└── README.md
```

## Shared vs platform-specific

| Location | What goes here |
|----------|----------------|
| `/shared` | Constants, pure utilities, game rules with no DOM or React Native APIs |
| `/web` | React components, Firebase web SDK, Spotify Web Playback, MusicKit JS, Vercel API routes |
| `/ios` | Expo app, native navigation, platform-specific playback |

Both apps import shared code via the `@shared` alias:

```js
import { PHASES } from "@shared/constants/gameConfig.js";
import { sanitizeName } from "@shared/utils/sanitize.js";
```

- **Web:** alias in `web/vite.config.js`
- **iOS:** alias in `ios/babel.config.js` + monorepo Metro config in `ios/metro.config.js`

## Development

From the **repository root**:

```bash
npm install
```

### Web

```bash
npm run dev          # Vite dev server (http://localhost:5173)
npm run dev:all      # API server + Vite
npm run build        # Production build → web/dist
```

Copy `web/.env.example` to `web/.env` and fill in Firebase, Spotify, and Apple Music credentials.

### iOS (Expo)

```bash
npm run ios:start    # Expo dev server (scan QR with Expo Go, or press i for simulator)
npm run ios          # Open iOS simulator directly
```

Copy `ios/.env.example` → `ios/.env` and fill the same Firebase project values as web (`EXPO_PUBLIC_FIREBASE_*`).

**Note:** `react-native-track-player` needs a custom native build (EAS / `expo prebuild`) — it will not fully work in Expo Go. Preview playback currently uses `expo-av`.

Or from `/ios`:

```bash
cd ios
npm run start
npm run ios          # Requires Xcode + iOS Simulator
```

## Deployment

**Vercel (web):** Set the project **Root Directory** to `web`.

**iOS:** Use EAS Build (`eas build --platform ios`) when you're ready for TestFlight / App Store — not configured yet.

## Adding more shared code

Put anything both platforms need under `/shared`. Keep browser-only APIs (localStorage, MusicKit, Spotify Web Playback SDK) in `/web` and native APIs in `/ios`.
