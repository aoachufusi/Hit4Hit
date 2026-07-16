import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

type Props = {
  option0Label: string;
  option1Label: string;
  disabled?: boolean;
  onVote: (choice: 0 | 1) => void;
};

const COLORS = ["#A855F7", "#C4B5FD"] as const;
const COLORS_DIM = ["#a855f725", "#c4b5fd18"] as const;

export default function JudgeVoting({
  option0Label,
  option1Label,
  disabled,
  onVote,
}: Props) {
  const pick = async (choice: 0 | 1) => {
    if (disabled) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onVote(choice);
  };

  const labels = [option0Label, option1Label];

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Your anonymous pick:</Text>
      <View style={styles.row}>
        {([0, 1] as const).map((i) => (
          <Pressable
            key={i}
            style={[
              styles.btn,
              {
                backgroundColor: COLORS_DIM[i],
                borderColor: COLORS[i],
              },
              disabled && styles.disabled,
            ]}
            onPress={() => pick(i)}
            disabled={disabled}
          >
            <Text style={[styles.btnText, { color: COLORS[i] }]}>
              🏆 {labels[i].toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  heading: {
    color: "#aa88d0",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 4,
  },
  row: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 64,
  },
  btnText: {
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  disabled: { opacity: 0.45 },
});
