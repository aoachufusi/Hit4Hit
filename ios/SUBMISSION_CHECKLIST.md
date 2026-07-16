# Hit 4 Hit — App Store Submission Checklist

Use this before you ship **Hit 4 Hit** (`app.hit4hit`, version **1.0.0**) to the App Store.

> Bundle ID is set to `app.hit4hit` (matches hit4hit.app). Change it in `app.json` **and** Apple Developer / App Store Connect if you prefer something like `com.yourcompany.hit4hit` — they must match everywhere.

---

## 0. One-time accounts & tooling

- [ ] Apple Developer Program membership (paid, active)
- [ ] Expo account + [EAS CLI](https://docs.expo.dev/build/setup/): `npm i -g eas-cli` then `eas login`
- [ ] From `/ios`: run `eas init` (fills `extra.eas.projectId` in `app.json`)
- [ ] Apple Developer → Identifiers → create App ID `app.hit4hit` with:
  - [ ] Push Notifications
  - [ ] MusicKit
  - [ ] Associated Domains (only if you add universal links later)
- [ ] Apple Developer → Keys → MusicKit key (if not already used for web)
- [ ] Spotify Developer Dashboard → iOS redirect URI `hit4hit://spotify-callback`
- [ ] Secrets for EAS (do **not** put Spotify client secret in the app):
  - [ ] `eas secret:create` / EAS Environment variables for any `EXPO_PUBLIC_*` needed at build time
  - [ ] Confirm search still uses **web** `SPOTIFY_CLIENT_SECRET` / `APPLE_*` on the server

---

## 1. App Store Connect setup

- [ ] [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → **+** → New App
  - Platform: iOS  
  - Name: **Hit 4 Hit**  
  - Primary language: English (U.S.)  
  - Bundle ID: **app.hit4hit**  
  - SKU: e.g. `hit4hit-ios-001`  
  - User access: Full Access (or as needed)
- [ ] Note the numeric **Apple ID** (App Store Connect App ID) → put in `eas.json` → `submit.production.ios.ascAppId`
- [ ] Fill `eas.json` submit placeholders:
  - `appleId` — your Apple ID email  
  - `appleTeamId` — Team ID from [developer.apple.com/account](https://developer.apple.com/account)  
  - `ascAppId` — numeric App Store Connect app id
- [ ] Pricing: Free (or paid) + availability countries
- [ ] App Privacy questionnaire completed (see §5)
- [ ] Age Rating questionnaire completed (see §4)
- [ ] App Encryption / Export Compliance: **No** non-exempt encryption (matches `ITSAppUsesNonExemptEncryption: false`)

---

## 2. Build with EAS

Profiles in `eas.json`:

| Profile | Purpose | Typical command |
|---------|---------|-----------------|
| `development` | Dev client on device | `eas build --profile development --platform ios` |
| `development-simulator` | Simulator builds | `eas build --profile development-simulator --platform ios` |
| `preview` | TestFlight / internal store | `eas build --profile preview --platform ios` |
| `production` | App Store release | `eas build --profile production --platform ios` |

- [ ] `cd ios && eas build --profile preview --platform ios`
- [ ] After a good TestFlight cycle: `eas build --profile production --platform ios`
- [ ] Submit: `eas submit --profile production --platform ios` (or attach the build in App Store Connect)

---

## 3. Required screenshots & metadata

### Screenshot sizes (upload at least one set)

Apple requires screenshots for the device sizes you support. Minimum practical set:

| Device class | Size (portrait) | Notes |
|--------------|-----------------|--------|
| **6.7" iPhone** (e.g. 15 Pro Max / 16 Plus) | **1290 × 2796** | Required for modern phones |
| **6.5" iPhone** (e.g. 11 Pro Max / XS Max) | **1242 × 2688** | Often still requested |
| **5.5" iPhone** (optional legacy) | **1242 × 2208** | If ASC still asks |
| **12.9" iPad Pro** (if tablet supported) | **2048 × 2732** | App supports tablet (`supportsTablet: true`) |

Tips:

- [ ] Capture: Home, Create/Join, Lobby (code + players), Listening / Now Playing, Judging, Round result
- [ ] No status-bar debug text, Expo Go banner, or placeholder “lorem”
- [ ] Dark UI matches brand (`#0D0A14` / purple accents)

### Listing copy

- [ ] **Subtitle** (≤30 chars), e.g. `Music battles with friends`
- [ ] **Description** — multiplayer hit battles, host plays audio, judges vote, round punishments
- [ ] **Keywords** (≤100 chars, comma-separated)
- [ ] **Support URL** — e.g. `https://hit4hit.app` or a `/support` page
- [ ] **Marketing URL** (optional) — `https://hit4hit.app`
- [ ] **Promotional text** (optional, editable without new binary)
- [ ] **What's New** for 1.0.0 — “Initial release”

### App icon & splash (in repo)

- [x] `ios/assets/icon.png` — **1024×1024**
- [x] `ios/assets/splash.png` — **2048×2048**
- [x] `ios/assets/adaptive-icon.png` — **1024×1024** (Android)
- [ ] Confirm icon has **no alpha transparency** issues for App Store (RGB 1024 icon preferred)

---

## 4. Age rating questionnaire (17+ — alcohol)

Hit 4 Hit includes **drinking / alcohol-related round & final punishments**. Rate accordingly so Apple doesn’t reject for under-labeling.

Suggested answers (adjust if your live copy changes):

| Category | Suggested |
|----------|-----------|
| Alcohol, Tobacco, or Drug Use or References | **Frequent/Intense** (or at least present) → drives **17+** |
| Profanity or Crude Humor | None / Infrequent (unless copy is spicy) |
| Horror/Fear Themes | None |
| Mature/Suggestive Themes | None / Infrequent |
| Sexual Content or Nudity | None |
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Gambling | None (unless you add real-money gambling — **don’t**) |
| Contests | None / check if “party game” contests apply |
| Unrestricted Web Access | No |
| Age Assurance | As required by ASC at submit time |

- [ ] Final rating shows **17+**
- [ ] Description / screenshots don’t market the app to kids
- [ ] Consider an in-app note: “For adults of legal drinking age where alcohol is involved”

---

## 5. Privacy policy & App Privacy labels

### Privacy policy (required)

- [ ] Host a public privacy policy URL (e.g. `https://hit4hit.app/privacy`)
- [ ] Cover at minimum:
  - [ ] Account / game data (Firebase anonymous auth, display names, game codes, votes, scores)
  - [ ] Music: Apple Music / Spotify — playback on host device; you don’t sell listening history
  - [ ] Push notification tokens (if used)
  - [ ] Analytics / crash tools (list any you add)
  - [ ] Third parties: Firebase, Spotify, Apple, Expo/EAS
  - [ ] Contact email for privacy requests
  - [ ] Data retention & deletion (how to leave a game / request wipe)
- [ ] Paste that URL into App Store Connect → App Privacy → Privacy Policy URL

### App Privacy “nutrition labels”

Declare data you **collect** (even if only on-device / for app functionality):

| Data type | Likely linked to user? | Purpose examples |
|-----------|------------------------|------------------|
| Name (player display name) | Yes / account | App functionality |
| User ID (Firebase UID) | Yes | App functionality |
| Product interaction / gameplay | Optional | Analytics (only if you track) |
| Device ID / push token | Yes if push enabled | App functionality |
| Other — music service connection | Functional | App functionality |

- [ ] Do **not** claim “Data Not Collected” if Firebase + names + push are used
- [ ] Mark “Used to Track You” **only** if you use tracking (ATT / ads) — this app currently should be **No Tracking** unless you add ads/SDKs

---

## 6. Permissions & Info.plist (already in `app.json`)

| Permission | Usage string | Needed? |
|------------|--------------|---------|
| **Apple Music / Media library** | `NSAppleMusicUsageDescription`, `NSMediaLibraryUsageDescription` | Yes — host MusicKit playback |
| **Push notifications** | `NSUserNotificationsUsageDescription` + `remote-notification` background mode | Yes — turn / vote / result alerts |
| **Microphone** | — | **Not used** — do not add; don’t claim mic in review notes |
| **Bluetooth / AirPlay** | System audio routing (no special string) | Host playback via system route |
| **Query Spotify / Music apps** | `LSApplicationQueriesSchemes`: `spotify`, `music` | Yes — open / connect music apps |

Review notes tip: explain that **only the host device plays audio**; guests see Now Playing UI only.

---

## 7. TestFlight beta (do this before full release)

- [ ] Upload a **preview** or **production** build to App Store Connect
- [ ] Wait for **Processing** → available in TestFlight
- [ ] Add **Internal testers** (App Store Connect users) — no Beta App Review
- [ ] Add **External testers** → fill Beta App Review information → submit for Beta Review
- [ ] Test matrix (real devices):
  - [ ] Create game / join with code
  - [ ] Lobby: assign players, pick artists (Spotify + Apple Music search)
  - [ ] Host connect Spotify Premium **and** Apple Music subscription paths
  - [ ] Listening: play / pause / skip / stop + clip length limits (15–120s)
  - [ ] Guests: Now Playing banner + countdown (no local audio)
  - [ ] Voting, round result, punishments, final screen
  - [ ] Push (if enabled): background / locked phone
  - [ ] Airplane / flaky network: graceful errors
  - [ ] Upgrade / no-subscription host → Upgrade modal, no crash
- [ ] Fix crashes / 1-star blockers before production submit
- [ ] Collect feedback for 3–7 days on external TestFlight if possible

---

## 8. Final App Review submission

- [ ] Select the production build on the iOS version page
- [ ] All screenshots + description + ratings + privacy complete
- [ ] **App Review Information**: demo account / party code if needed (or “create a room with 3 devices”)
- [ ] **Notes for Review**:
  - Multiplayer party game; alcohol-themed punishments → 17+
  - Host must have Spotify Premium or Apple Music to play full tracks
  - Search uses your backend (`hit4hit.app` API); playback is on-device via Spotify App Remote / MusicKit
- [ ] Contact phone + email that Apple can reach
- [ ] Submit for Review
- [ ] Watch Resolution Center for MusicKit / Spotify guideline questions

---

## 9. Post-release

- [ ] Monitor Crashlytics / Expo insights / App Store reviews
- [ ] Bump `version` (user-facing) and let EAS `autoIncrement` build numbers
- [ ] Keep web API secrets (`SPOTIFY_CLIENT_SECRET`, `APPLE_*`) valid in production
- [ ] Privacy policy stays in sync if you add analytics or ads

---

## Quick command cheat sheet

```bash
cd ios
eas login
eas init
eas build --profile preview --platform ios
eas submit --profile preview --platform ios   # → TestFlight
eas build --profile production --platform ios
eas submit --profile production --platform ios
```

---

## Related files

| File | Role |
|------|------|
| `ios/app.json` | Name, version `1.0.0`, bundle `app.hit4hit`, permissions, icons |
| `ios/eas.json` | `development` / `preview` / `production` (+ simulator) profiles |
| `ios/assets/icon.png` | 1024×1024 App Store icon |
| `ios/assets/splash.png` | 2048×2048 splash |
| `ios/assets/adaptive-icon.png` | 1024×1024 Android adaptive foreground |
| `ios/.env` | `EXPO_PUBLIC_*` client config (no Spotify/Apple secrets) |
| `web/.env` / Vercel | Server search secrets |
