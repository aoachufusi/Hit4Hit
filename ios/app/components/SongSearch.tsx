import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  isSearchReady,
  providerLabel,
  searchTracks,
  usesApple,
} from "../services/musicSearch";
import {
  formatTrackLabel,
  type SearchTrack,
} from "../utils/trackMeta";
import type { MusicProvider } from "../types/game";

type Props = {
  value?: string;
  onChange: (value: string) => void;
  onSelectTrack: (track: SearchTrack) => void;
  placeholder?: string;
  disabled?: boolean;
  musicProvider?: MusicProvider | string | null;
  roundArtist?: string;
  onToast?: (msg: string) => void;
  onEnter?: () => void;
  usedSongKeys?: Set<string>;
  songKeyForTrack?: (track: SearchTrack) => string;
};

/**
 * Debounced song search scoped to the player's artist — mirrors web SongSearch.jsx.
 */
export default function SongSearch({
  value = "",
  onChange,
  onSelectTrack,
  placeholder = "Search songs…",
  disabled = false,
  musicProvider,
  roundArtist,
  onToast,
  onEnter,
  usedSongKeys,
  songKeyForTrack,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchTrack[]>([]);
  const epochRef = useRef(0);

  const label = providerLabel(musicProvider);
  const canSearch = isSearchReady(musicProvider) && Boolean(roundArtist?.trim());
  const trimmed = value.trim();

  useEffect(() => {
    if (!canSearch || trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const tid = setTimeout(async () => {
      const epoch = ++epochRef.current;
      setLoading(true);
      try {
        const items = await searchTracks(trimmed, roundArtist!, musicProvider);
        if (epochRef.current !== epoch) return;
        setResults(items.filter((t) => t?.name));
      } catch {
        if (epochRef.current === epoch) {
          setResults([]);
          onToast?.("Search failed — try again");
        }
      } finally {
        if (epochRef.current === epoch) setLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(tid);
      epochRef.current += 1;
    };
  }, [trimmed, canSearch, musicProvider, roundArtist, onToast]);

  const showList =
    open &&
    (loading ||
      results.length > 0 ||
      (canSearch && trimmed.length >= 2) ||
      (!canSearch && trimmed.length > 0));

  const isTrackUsed = (track: SearchTrack) => {
    if (!usedSongKeys?.size || !songKeyForTrack) return false;
    const key = songKeyForTrack(track);
    return key ? usedSongKeys.has(key) : false;
  };

  const pickTrack = (track: SearchTrack) => {
    if (isTrackUsed(track)) {
      onToast?.(
        "You already played that song in an earlier round — pick something else"
      );
      return;
    }
    onChange(formatTrackLabel(track));
    onSelectTrack(track);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        style={[styles.input, disabled && styles.disabled]}
        placeholder={
          canSearch
            ? roundArtist
              ? `${label} — search ${roundArtist} songs…`
              : `${label} search…`
            : placeholder
        }
        placeholderTextColor="#4a3370"
        value={value}
        editable={!disabled}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onChangeText={(t) => {
          onChange(t);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onSubmitEditing={() => {
          if (trimmed) onEnter?.();
        }}
      />

      {showList ? (
        <View style={styles.dropdown}>
          {!canSearch ? (
            <Text style={styles.hint}>
              {usesApple(musicProvider)
                ? "Waiting for Apple Music search…"
                : roundArtist
                  ? `Waiting for ${label}…`
                  : "Pick your artist in the lobby first"}
            </Text>
          ) : null}

          {canSearch && trimmed.length < 2 ? (
            <Text style={styles.hint}>Type at least 2 characters to search</Text>
          ) : null}

          {canSearch && trimmed.length >= 2 && loading ? (
            <View style={styles.rowHint}>
              <ActivityIndicator color="#7a5fa8" size="small" />
              <Text style={styles.hint}>Searching {label}…</Text>
            </View>
          ) : null}

          {canSearch &&
          trimmed.length >= 2 &&
          !loading &&
          results.length === 0 ? (
            <Text style={styles.hint}>
              No songs by {roundArtist} found
            </Text>
          ) : null}

          {canSearch &&
            !loading &&
            results.map((track) => {
              const used = isTrackUsed(track);
              const artists =
                track.artists?.map((a) => a.name).filter(Boolean).join(", ") ||
                "Unknown artist";
              return (
                <TouchableOpacity
                  key={track.id || `${track.name}-${artists}`}
                  style={[styles.result, used && styles.resultTaken]}
                  disabled={used}
                  onPress={() => pickTrack(track)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.trackName, used && styles.muted]}
                    numberOfLines={1}
                  >
                    {track.name}
                  </Text>
                  <Text style={styles.trackArtists} numberOfLines={1}>
                    {artists}
                    {used ? " · already played" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 10 },
  input: {
    backgroundColor: "#160f25",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 8,
    color: "#F0EBFF",
    paddingHorizontal: 10,
    paddingVertical: 12,
    fontSize: 15,
  },
  disabled: { opacity: 0.45 },
  dropdown: {
    marginTop: 4,
    backgroundColor: "#160f25",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 6,
    overflow: "hidden",
    maxHeight: 220,
  },
  hint: { color: "#4a3370", fontSize: 11, paddingHorizontal: 12, paddingVertical: 8 },
  rowHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  result: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2e1f4a",
    gap: 2,
  },
  resultTaken: { opacity: 0.45 },
  trackName: { color: "#e9d5ff", fontWeight: "600", fontSize: 13 },
  trackArtists: { color: "#7a5fa8", fontSize: 11 },
  muted: { color: "#4a3370" },
});
