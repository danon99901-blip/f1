// Main entry point with menu system and multiplayer support

import { MenuManager } from './client/menu/MenuManager';
import { NetworkClient } from './client/network/NetworkClient';
import type { RoomInfo } from './shared/types';
import './hud/styles.css';

// Signaling server URL - change this to your deployed server
const SIGNALING_URL =
  (import.meta as any).env?.VITE_SIGNALING_URL || 'ws://localhost:3001';

async function main() {
  const loadingEl = document.getElementById('loading');

  let networkClient: NetworkClient | null = null;
  let currentRoomInfo: RoomInfo | null = null;

  const menuManager = new MenuManager({
    onSinglePlayer: async () => {
      loadingEl?.classList.remove('hidden');

      // Import and start single-player game
      const { startSinglePlayerGame } = await import('./client/game/SinglePlayerGame');
      await startSinglePlayerGame();

      loadingEl?.classList.add('hidden');
    },

    onMultiplayerHost: async (playerName: string, totalLaps: number) => {
      try {
        loadingEl?.classList.remove('hidden');

        networkClient = new NetworkClient(SIGNALING_URL, {
          onRoomCreated: (roomId) => {
            console.log(`[Main] Room created: ${roomId}`);
          },

          onRoomJoined: (roomInfo) => {
            currentRoomInfo = roomInfo;
            loadingEl?.classList.add('hidden');
            menuManager.showLobby(roomInfo, true);
          },

          onPlayerJoined: (playerId, playerName) => {
            if (currentRoomInfo) {
              currentRoomInfo.players.push({
                id: playerId,
                name: playerName,
                isHost: false,
              });
              menuManager.updateLobby(currentRoomInfo);
            }
          },

          onPlayerLeft: (playerId) => {
            if (currentRoomInfo) {
              currentRoomInfo.players = currentRoomInfo.players.filter(
                (p) => p.id !== playerId,
              );
              menuManager.updateLobby(currentRoomInfo);
            }
          },

          onRaceStart: async (countdown) => {
            console.log(`[Main] Race starting in ${countdown}s`);
            menuManager.startGame();

            // Start multiplayer game as host
            const { startHostGame } = await import('./client/game/HostGameClient');
            const playerNames = currentRoomInfo!.players.map((p) => ({
              id: p.id,
              name: p.name,
            }));
            await startHostGame(networkClient!, playerNames, currentRoomInfo!.totalLaps);
          },

          onHostMessage: (message) => {
            // Guest receives host messages
            console.log('[Main] Received from host:', message.type);
          },

          onGuestMessage: (guestId, message) => {
            // Host receives guest messages
            console.log(`[Main] Received from guest ${guestId}:`, message.type);
          },

          onError: (message) => {
            console.error('[Main] Network error:', message);
            menuManager.showError(message);
            loadingEl?.classList.add('hidden');
          },
        });

        await networkClient.connect();
        networkClient.createRoom(playerName, totalLaps);
      } catch (err) {
        console.error('[Main] Failed to create room:', err);
        menuManager.showError('Failed to connect to server');
        loadingEl?.classList.add('hidden');
      }
    },

    onMultiplayerJoin: async (roomId: string, playerName: string) => {
      try {
        loadingEl?.classList.remove('hidden');

        networkClient = new NetworkClient(SIGNALING_URL, {
          onRoomCreated: () => {},

          onRoomJoined: (roomInfo) => {
            currentRoomInfo = roomInfo;
            loadingEl?.classList.add('hidden');
            menuManager.showLobby(roomInfo, false);
          },

          onPlayerJoined: (playerId, playerName) => {
            if (currentRoomInfo) {
              currentRoomInfo.players.push({
                id: playerId,
                name: playerName,
                isHost: false,
              });
              menuManager.updateLobby(currentRoomInfo);
            }
          },

          onPlayerLeft: (playerId) => {
            if (currentRoomInfo) {
              currentRoomInfo.players = currentRoomInfo.players.filter(
                (p) => p.id !== playerId,
              );
              menuManager.updateLobby(currentRoomInfo);
            }
          },

          onRaceStart: async (countdown) => {
            console.log(`[Main] Race starting in ${countdown}s`);
            menuManager.startGame();

            // Start multiplayer game as guest
            const { startGuestGame } = await import('./client/game/GuestGameClient');
            await startGuestGame(
              networkClient!,
              networkClient!.getPlayerId()!,
              currentRoomInfo!.totalLaps,
            );
          },

          onHostMessage: (message) => {
            console.log('[Main] Received from host:', message.type);
          },

          onGuestMessage: () => {},

          onError: (message) => {
            console.error('[Main] Network error:', message);
            menuManager.showError(message);
            loadingEl?.classList.add('hidden');
          },
        });

        await networkClient.connect();
        networkClient.joinRoom(roomId, playerName);
      } catch (err) {
        console.error('[Main] Failed to join room:', err);
        menuManager.showError('Failed to connect to server');
        loadingEl?.classList.add('hidden');
      }
    },

    onStartRace: () => {
      if (networkClient && networkClient.isHost()) {
        networkClient.startRace();
      }
    },

    onLeaveLobby: () => {
      if (networkClient) {
        networkClient.leaveRoom();
        networkClient.disconnect();
        networkClient = null;
      }
      currentRoomInfo = null;
    },
  });

  // Show main menu
  loadingEl?.classList.add('hidden');
  menuManager.showMainMenu();
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'ERROR — see console';
});
