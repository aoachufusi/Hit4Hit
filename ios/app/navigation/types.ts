export type RootStackParamList = {
  Home: undefined;
  CreateGame: undefined;
  JoinGame: undefined;
  Lobby: { code: string; myName: string; isHost: boolean };
  Game: { code: string; myName: string; isHost: boolean };
};
