import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { isArtistBlocked } from "../utils/gameState";
import {
  isSearchReady,
  providerLabel,
  searchArtists,
  usesApple,
} from "../services/musicSearch";
import type { SearchArtist } from "../utils/trackMeta";
import type { MusicProvider } from "../types/game";

type Props = {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  musicProvider?: MusicProvider | string | null;
  blockedArtists?: string[];
  onSelect: (artistName: string) => void;
  onToast?: (msg: string) => void;
};

/**
 * Debounced artist search — mirrors web ArtistSearch.jsx.
 */
export default function ArtistSearch({
  value = "",
  placeholder = "Search artists…",
  disabled = false,
  musicProvider,
  blockedArtists = [],
  onSelect,
  onToast,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchArtist[]>([]);
  const epochRef = useRef(0);

  const label = providerLabel(musicProvider);
  const canSearch = isSearchReady(musicProvider);
  const trimmed = query.trim();

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

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
        const items = await searchArtists(trimmed, musicProvider);
        if (epochRef.current !== epoch) return;
        setResults(items.filter((a) => a?.name));
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
  }, [trimmed, canSearch, musicProvider, onToast]);

  const showList =
    open &&
    (loading ||
      results.length > 0 ||
      (canSearch && trimmed.length >= 2) ||
      (!canSearch && trimmed.length > 0));

  const selectArtist = (artist: SearchArtist) => {
    if (isArtistBlocked(artist.name, blockedArtists)) {
      onToast?.("That artist is already taken — pick someone else");
      return;
    }
    setQuery(artist.name);
    onSelect(artist.name);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        style={[styles.input, disabled && styles.disabled]}
        placeholder={
          canSearch
            ? value
              ? `${label} — search to change artist…`
              : `${label} search…`
            : placeholder
        }
        placeholderTextColor="#4a3370"
        value={query}
        editable={!disabled}
        autoCapitalize="words"
        autoCorrect={false}
        onChangeText={(t) => {
          setQuery(t);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />

      {showList ? (
        <View style={styles.dropdown}>
          {!canSearch ? (
            <Text style={styles.hint}>
              {usesApple(musicProvider)
                ? "Waiting for Apple Music search…"
                : `Waiting for ${label}…`}
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
            <Text style={styles.hint}>No artists found</Text>
          ) : null}

          {canSearch &&
            !loading &&
            results.map((artist) => {
              const taken = isArtistBlocked(artist.name, blockedArtists);
              return (
                <TouchableOpacity
                  key={artist.id || artist.name}
                  style={[styles.result, taken && styles.resultTaken]}
                  disabled={taken}
                  onPress={() => selectArtist(artist)}
                  activeOpacity={0.85}
                >
                  {artist.image ? (
                    <Image source={{ uri: artist.image }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarEmpty]}>
                      <Text style={styles.avatarLetter}>
                        {(artist.name || "?")[0]}
                      </Text>
                    </View>
                  )}
                  <Text
                    style={[styles.resultName, taken && styles.resultNameTaken]}
                    numberOfLines={1}
                  >
                    {artist.name}
                  </Text>
                  {taken ? <Text style={styles.taken}>taken</Text> : null}
                </TouchableOpacity>
              );
            })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, zIndex: 10 },
  input: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 8,
    color: "#F0EBFF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  disabled: { opacity: 0.45 },
  dropdown: {
    marginTop: 4,
    backgroundColor: "#160f25",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 6,
    overflow: "hidden",
    maxHeight: 200,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2e1f4a",
  },
  resultTaken: { opacity: 0.45 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarEmpty: {
    backgroundColor: "#130d22",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { color: "#A855F7", fontWeight: "700", fontSize: 12 },
  resultName: { flex: 1, color: "#e9d5ff", fontWeight: "600", fontSize: 13 },
  resultNameTaken: { color: "#4a3370" },
  taken: { color: "#4a3370", fontSize: 10 },
});
