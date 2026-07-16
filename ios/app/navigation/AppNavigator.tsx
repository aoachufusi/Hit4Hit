import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { colors } from "../constants/theme";
import type { RootStackParamList } from "./types";
import HomeScreen from "../screens/HomeScreen";
import CreateGameScreen from "../screens/CreateGameScreen";
import JoinGameScreen from "../screens/JoinGameScreen";
import LobbyScreen from "../screens/LobbyScreen";
import GameScreen from "../screens/GameScreen";

const Stack = createStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

export default function AppNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700", letterSpacing: 1 },
          cardStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CreateGame"
          component={CreateGameScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="JoinGame"
          component={JoinGameScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Lobby"
          component={LobbyScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Game"
          component={GameScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
