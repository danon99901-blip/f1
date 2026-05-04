import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RacingState } from './RacingState';
import type { GameContext } from '../core/GameStateMachine';
import type { EventBus } from '../core/EventBus';
import type { PhysicsService } from '../services/PhysicsService';
import type { RenderService } from '../services/RenderService';
import type { NetworkService } from '../services/NetworkService';
import type { InputService } from '../services/InputService';
import type { Vehicle } from '../car/vehicle';
import type { PlayerController } from '../game/PlayerController';
import * as THREE from 'three';

// Mock track creation to avoid RAPIER initialization
vi.mock('../track/track', () => ({
  createTrack: vi.fn(() => ({
    trackMesh: new THREE.Group(),
    trackLength: 1000,
    startPosition: new THREE.Vector3(0, 1, 0),
    startRotation: new THREE.Quaternion(),
  })),
}));

describe('RacingState - Multiplayer Synchronization', () => {
  let racingState: RacingState;
  let mockContext: GameContext;
  let mockEventBus: EventBus;
  let mockPhysicsService: PhysicsService;
  let mockRenderService: RenderService;
  let mockNetworkService: NetworkService;
  let mockInputService: InputService;

  beforeEach(() => {
    // Create mock event bus
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as any;

    // Create mock services
    mockPhysicsService = {
      getVehicle: vi.fn(),
      createVehicle: vi.fn(),
      destroyVehicle: vi.fn(),
      getWorld: vi.fn(() => ({} as any)),
      step: vi.fn(),
    } as any;

    mockRenderService = {
      getScene: vi.fn(() => new THREE.Scene()),
      getCamera: vi.fn(() => new THREE.PerspectiveCamera()),
      setSpeed: vi.fn(),
      render: vi.fn(),
    } as any;

    mockNetworkService = {
      sendToHost: vi.fn(),
      sendToAllGuests: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as any;

    mockInputService = {
      getInput: vi.fn(() => ({ throttle: 0, brake: 0, steer: 0 })),
      on: vi.fn(),
      off: vi.fn(),
    } as any;

    // Create mock service container
    const mockServiceContainer = {
      resolve: vi.fn(async (name: string) => {
        switch (name) {
          case 'physics': return mockPhysicsService;
          case 'render': return mockRenderService;
          case 'network': return mockNetworkService;
          case 'input': return mockInputService;
          default: return null;
        }
      }),
    } as any;

    // Create mock context
    mockContext = {
      eventBus: mockEventBus,
      services: {
        get: vi.fn((name: string) => {
          switch (name) {
            case 'physics': return mockPhysicsService;
            case 'render': return mockRenderService;
            case 'network': return mockNetworkService;
            case 'input': return mockInputService;
            default: return null;
          }
        }),
      },
      data: {
        serviceContainer: mockServiceContainer,
        gameMode: 'multi_host',
        roomInfo: {
          roomId: 'test-room',
          hostId: 'host-id',
          players: [
            { id: 'host-id', name: 'Host', carColor: 0xe10600 },
            { id: 'guest-id', name: 'Guest', carColor: 0x0000ff },
          ],
        },
        playerId: 'host-id',
      },
    } as any;

    racingState = new RacingState();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Host: Guest Vehicle Synchronization', () => {
    it('should sync visual mesh after updating guest vehicle physics', () => {
      // Setup: Create mock guest vehicle with syncVisuals method
      const mockVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 10, y: 1, z: 5 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 20 })),
        },
        getSpeedKmh: vi.fn(() => 72),
        getForwardSpeedKmh: vi.fn(() => 72),
        syncVisuals: vi.fn(), // CRITICAL: This must be called
      } as any as Vehicle;

      const mockController = {
        update: vi.fn(),
      } as any as PlayerController;

      // Manually set up internal state without calling enter()
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).gameMode = 'multi_host';

      // Add guest vehicle to internal map
      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-id', {
        vehicle: mockVehicle,
        controller: mockController,
        lastInput: { throttle: 0.5, brake: 0, steer: 0.2 },
      });

      // Simulate update cycle
      const updateGuestVehicles = (racingState as any).updateGuestVehicles.bind(racingState);
      updateGuestVehicles(0.016); // 16ms frame

      // Verify: controller.update was called
      expect(mockController.update).toHaveBeenCalledWith(
        { throttle: 0.5, brake: 0, steer: 0.2 },
        0.016
      );

      // CRITICAL TEST: syncVisuals must be called after update
      expect(mockVehicle.syncVisuals).toHaveBeenCalled();
      expect(mockVehicle.syncVisuals).toHaveBeenCalledAfter(mockController.update as any);
    });

    it('should sync visuals for multiple guest vehicles', () => {
      const mockVehicles = [
        {
          rigidBody: {
            translation: vi.fn(() => ({ x: 10, y: 1, z: 5 })),
            rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
            linvel: vi.fn(() => ({ x: 0, y: 0, z: 20 })),
          },
          getSpeedKmh: vi.fn(() => 72),
          getForwardSpeedKmh: vi.fn(() => 72),
          syncVisuals: vi.fn(),
        },
        {
          rigidBody: {
            translation: vi.fn(() => ({ x: 15, y: 1, z: 8 })),
            rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
            linvel: vi.fn(() => ({ x: 0, y: 0, z: 25 })),
          },
          getSpeedKmh: vi.fn(() => 90),
          getForwardSpeedKmh: vi.fn(() => 90),
          syncVisuals: vi.fn(),
        },
      ] as any[];

      const mockControllers = [
        { update: vi.fn() },
        { update: vi.fn() },
      ] as any[];

      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).gameMode = 'multi_host';

      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-1', {
        vehicle: mockVehicles[0],
        controller: mockControllers[0],
        lastInput: { throttle: 0.5, brake: 0, steer: 0 },
      });
      guestVehicles.set('guest-2', {
        vehicle: mockVehicles[1],
        controller: mockControllers[1],
        lastInput: { throttle: 0.8, brake: 0, steer: -0.3 },
      });

      const updateGuestVehicles = (racingState as any).updateGuestVehicles.bind(racingState);
      updateGuestVehicles(0.016);

      // All vehicles should have syncVisuals called
      expect(mockVehicles[0].syncVisuals).toHaveBeenCalled();
      expect(mockVehicles[1].syncVisuals).toHaveBeenCalled();
    });

    it('should handle empty guest vehicles map', () => {
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).gameMode = 'multi_host';

      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      expect(guestVehicles.size).toBe(0);

      const updateGuestVehicles = (racingState as any).updateGuestVehicles.bind(racingState);

      // Should not throw with empty map
      expect(() => updateGuestVehicles(0.016)).not.toThrow();
    });
  });

  describe('Guest: Snapshot Buffer Handling', () => {
    it('should buffer snapshots received before opponent initialization', () => {
      // Setup guest mode
      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).opponentController = null; // Not initialized yet

      // Simulate receiving snapshot before opponents are initialized
      const snapshot = {
        type: 'snapshot' as const,
        tick: 1,
        timestamp: Date.now(),
        players: [
          {
            id: 'host-id',
            name: 'Host',
            carColor: 0xe10600,
            position: [0, 1, 0] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            velocity: [0, 0, 0] as [number, number, number],
            speedKmh: 0,
            gear: 1,
            currentLap: 1,
            lapTimeMs: 0,
            lastLapMs: null,
            bestLapMs: null,
          },
        ],
      };

      // Access private method to handle snapshot (correct method name is handleHostSnapshot)
      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      handleHostSnapshot(snapshot);

      // Verify snapshot was buffered
      const pendingSnapshots = (racingState as any).pendingSnapshots as any[];
      expect(pendingSnapshots.length).toBeGreaterThan(0);
      // Snapshot is wrapped with timestamp when buffered
      expect(pendingSnapshots[0]).toHaveProperty('snapshot');
      expect(pendingSnapshots[0].snapshot).toEqual(snapshot);
    });

    it('should flush buffered snapshots after opponent initialization', () => {
      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).opponentController = null; // Not initialized yet

      // Buffer some snapshots
      const snapshots = [
        {
          type: 'snapshot' as const,
          tick: 1,
          timestamp: 1000,
          players: [
            {
              id: 'host-id',
              name: 'Host',
              carColor: 0xe10600,
              position: [0, 1, 0] as [number, number, number],
              rotation: [0, 0, 0, 1] as [number, number, number, number],
              velocity: [0, 0, 0] as [number, number, number],
              speedKmh: 0,
              gear: 1,
              currentLap: 1,
              lapTimeMs: 0,
              lastLapMs: null,
              bestLapMs: null,
            },
          ],
        },
        {
          type: 'snapshot' as const,
          tick: 2,
          timestamp: 1016,
          players: [
            {
              id: 'host-id',
              name: 'Host',
              carColor: 0xe10600,
              position: [0, 1, 1] as [number, number, number],
              rotation: [0, 0, 0, 1] as [number, number, number, number],
              velocity: [0, 0, 10] as [number, number, number],
              speedKmh: 36,
              gear: 2,
              currentLap: 1,
              lapTimeMs: 16,
              lastLapMs: null,
              bestLapMs: null,
            },
          ],
        },
      ];

      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      snapshots.forEach(s => handleHostSnapshot(s));

      const pendingSnapshots = (racingState as any).pendingSnapshots as any[];
      expect(pendingSnapshots.length).toBe(2);

      // Initialize opponent controller
      const mockOpponentController = {
        updateRemotePlayer: vi.fn(),
        getRemotePlayerMesh: vi.fn(() => null),
        addRemotePlayer: vi.fn(),
        setInitialPosition: vi.fn(),
      } as any;
      (racingState as any).opponentController = mockOpponentController;

      // Flush pending snapshots
      const flushPendingSnapshots = (racingState as any).flushPendingSnapshots.bind(racingState);
      flushPendingSnapshots();

      // Verify buffer was flushed (check after flush completes)
      const pendingSnapshotsAfterFlush = (racingState as any).pendingSnapshots as any[];
      expect(pendingSnapshotsAfterFlush.length).toBe(0);

      // Verify snapshots were processed
      expect(mockOpponentController.updateRemotePlayer).toHaveBeenCalledTimes(2);
    });

    it('should not buffer snapshots after opponent initialization', () => {
      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';

      const mockOpponentController = {
        updateRemotePlayer: vi.fn(),
        getRemotePlayerMesh: vi.fn(() => null),
        addRemotePlayer: vi.fn(),
        setInitialPosition: vi.fn(),
      } as any;
      (racingState as any).opponentController = mockOpponentController; // Already initialized

      const snapshot = {
        type: 'snapshot' as const,
        tick: 1,
        timestamp: Date.now(),
        players: [
          {
            id: 'host-id',
            name: 'Host',
            carColor: 0xe10600,
            position: [0, 1, 0] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            velocity: [0, 0, 0] as [number, number, number],
            speedKmh: 0,
            gear: 1,
            currentLap: 1,
            lapTimeMs: 0,
            lastLapMs: null,
            bestLapMs: null,
          },
        ],
      };

      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      handleHostSnapshot(snapshot);

      // Should not buffer, should process immediately
      const pendingSnapshots = (racingState as any).pendingSnapshots as any[];
      expect(pendingSnapshots.length).toBe(0);
      expect(mockOpponentController.updateRemotePlayer).toHaveBeenCalled();
    });
  });

  describe('Guest: Input Message Type', () => {
    it('should send input messages with correct type', () => {
      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).lastInputSendTime = 100; // Trigger send condition
      (racingState as any).inputSendInterval = 50;
      (racingState as any).inputSeq = 0;

      const input = { throttle: 0.5, brake: 0, steer: 0 };
      const dt = 0.016; // 16ms

      // Simulate sending input with dt that triggers send
      const sendGuestInput = (racingState as any).sendGuestInput.bind(racingState);
      sendGuestInput(input, dt);

      // Verify sendToHost was called with correct message type
      expect(mockNetworkService.sendToHost).toHaveBeenCalled();
      const sentMessage = (mockNetworkService.sendToHost as any).mock.calls[0][0];

      // CRITICAL: Message type must be 'input', not 'guest_input'
      expect(sentMessage.type).toBe('input');
      expect(sentMessage.type).not.toBe('guest_input');
    });

    it('should include all required input fields', () => {
      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).lastInputSendTime = 100;
      (racingState as any).inputSendInterval = 50;
      (racingState as any).inputSeq = 0;

      const input = { throttle: 0.7, brake: 0.2, steer: -0.5 };
      const dt = 0.016;

      const sendGuestInput = (racingState as any).sendGuestInput.bind(racingState);
      sendGuestInput(input, dt);

      const sentMessage = (mockNetworkService.sendToHost as any).mock.calls[0][0];

      expect(sentMessage).toHaveProperty('type', 'input');
      expect(sentMessage).toHaveProperty('throttle', 0.7);
      expect(sentMessage).toHaveProperty('brake', 0.2);
      expect(sentMessage).toHaveProperty('steer', -0.5);
      expect(sentMessage).toHaveProperty('seq');
    });

    it('should increment sequence number on each input', () => {
      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).inputSendInterval = 50;
      (racingState as any).inputSeq = 0;

      const input = { throttle: 0.5, brake: 0, steer: 0 };
      const dt = 0.016;

      const sendGuestInput = (racingState as any).sendGuestInput.bind(racingState);

      (racingState as any).lastInputSendTime = 100;
      sendGuestInput(input, dt);
      const firstSeq = (mockNetworkService.sendToHost as any).mock.calls[0][0].seq;

      (racingState as any).lastInputSendTime = 100;
      sendGuestInput(input, dt);
      const secondSeq = (mockNetworkService.sendToHost as any).mock.calls[1][0].seq;

      expect(secondSeq).toBeGreaterThan(firstSeq);
    });
  });

  describe('Host: Guest Input Handling', () => {
    it('should store guest input for physics update', () => {
      const mockVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        getForwardSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
      } as any;

      const mockController = {
        update: vi.fn(),
      } as any;

      mockPhysicsService.createVehicle = vi.fn(() => mockVehicle);
      mockPhysicsService.getVehicle = vi.fn(() => null); // Vehicle doesn't exist yet

      (racingState as any).gameMode = 'multi_host';
      (racingState as any).playerId = 'host-id';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).roomInfo = mockContext.data.roomInfo;

      // Manually create guest vehicle
      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-id', {
        vehicle: mockVehicle,
        controller: mockController,
        lastInput: { throttle: 0, brake: 0, steer: 0 },
      });

      // Simulate receiving guest input
      const handleGuestInput = (racingState as any).handleGuestInput.bind(racingState);
      handleGuestInput('guest-id', {
        seq: 1,
        throttle: 0.8,
        brake: 0,
        steer: 0.3,
      });

      // Verify input was stored
      const guestData = guestVehicles.get('guest-id');
      expect(guestData).toBeDefined();
      expect(guestData.lastInput).toEqual({
        throttle: 0.8,
        brake: 0,
        steer: 0.3,
      });
    });

    it('should handle input with zero values', () => {
      const mockVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
      } as any;

      const mockController = { update: vi.fn() } as any;

      (racingState as any).gameMode = 'multi_host';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;

      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-id', {
        vehicle: mockVehicle,
        controller: mockController,
        lastInput: { throttle: 0, brake: 0, steer: 0 },
      });

      const handleGuestInput = (racingState as any).handleGuestInput.bind(racingState);
      handleGuestInput('guest-id', {
        seq: 1,
        throttle: 0,
        brake: 0,
        steer: 0,
      });

      const guestData = guestVehicles.get('guest-id');
      expect(guestData.lastInput).toEqual({
        throttle: 0,
        brake: 0,
        steer: 0,
      });
    });
  });

  describe('Integration: Full Synchronization Flow', () => {
    it('should maintain synchronization through complete update cycle', () => {
      const mockVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 10, y: 1, z: 5 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 20 })),
        },
        getSpeedKmh: vi.fn(() => 72),
        getForwardSpeedKmh: vi.fn(() => 72),
        syncVisuals: vi.fn(),
      } as any;

      const mockController = {
        update: vi.fn(),
      } as any;

      (racingState as any).gameMode = 'multi_host';
      (racingState as any).playerId = 'host-id';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;

      // 1. Receive guest input
      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-id', {
        vehicle: mockVehicle,
        controller: mockController,
        lastInput: { throttle: 0, brake: 0, steer: 0 },
      });

      const handleGuestInput = (racingState as any).handleGuestInput.bind(racingState);
      handleGuestInput('guest-id', {
        seq: 1,
        throttle: 0.7,
        brake: 0,
        steer: 0.2,
      });

      // 2. Update guest vehicles (physics + visuals)
      const updateGuestVehicles = (racingState as any).updateGuestVehicles.bind(racingState);
      updateGuestVehicles(0.016);

      // 3. Verify complete flow
      expect(mockController.update).toHaveBeenCalledWith(
        { throttle: 0.7, brake: 0, steer: 0.2 },
        0.016
      );
      expect(mockVehicle.syncVisuals).toHaveBeenCalled();

      // Verify order: update before syncVisuals
      const updateCallOrder = (mockController.update as any).mock.invocationCallOrder[0];
      const syncCallOrder = (mockVehicle.syncVisuals as any).mock.invocationCallOrder[0];
      expect(syncCallOrder).toBeGreaterThan(updateCallOrder);
    });
  });

  describe('Host: Main Update Loop Integration', () => {
    it('should update guest vehicle controllers from main update loop', () => {
      // Setup: Create mock player vehicle
      const mockPlayerVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        getForwardSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
        chassisMesh: {
          position: new THREE.Vector3(0, 1, 0),
          quaternion: new THREE.Quaternion(),
        },
      } as any;

      const mockPlayerController = {
        update: vi.fn(),
        getVehicle: vi.fn(() => mockPlayerVehicle),
      } as any;

      // Setup: Create mock guest vehicle
      const mockGuestVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 10, y: 1, z: 5 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 20 })),
        },
        getSpeedKmh: vi.fn(() => 72),
        getForwardSpeedKmh: vi.fn(() => 72),
        syncVisuals: vi.fn(),
      } as any;

      const mockGuestController = {
        update: vi.fn(),
      } as any;

      // Setup: Mock race controller
      const mockRaceController = {
        update: vi.fn(),
        getPlayerPosition: vi.fn(() => 1),
        getTotalCars: vi.fn(() => 2),
        getPlayerLapState: vi.fn(() => ({
          currentLap: 1,
          lapTime: 0,
          lastLapTime: null,
          bestLapTime: null,
        })),
      } as any;

      // Setup: Configure racing state
      (racingState as any).gameMode = 'multi_host';
      (racingState as any).playerId = 'host-id';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).inputService = mockInputService;
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).playerController = mockPlayerController;
      (racingState as any).raceController = mockRaceController;
      (racingState as any).opponentInitialized = true; // Skip opponent initialization
      (racingState as any).cameraTarget = new THREE.Vector3();
      (racingState as any).cameraOffset = new THREE.Vector3(0, 2, -5);

      // Add guest vehicle
      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-id', {
        vehicle: mockGuestVehicle,
        controller: mockGuestController,
        lastInput: { throttle: 0.5, brake: 0, steer: 0.2 },
      });

      // Execute: Call main update loop
      racingState.update(0.016);

      // Verify: Guest controller.update was called from main loop
      expect(mockGuestController.update).toHaveBeenCalledWith(
        { throttle: 0.5, brake: 0, steer: 0.2 },
        0.016
      );

      // Verify: Guest vehicle syncVisuals was called
      expect(mockGuestVehicle.syncVisuals).toHaveBeenCalled();

      // Verify: Player controller was also updated
      expect(mockPlayerController.update).toHaveBeenCalled();
    });

    it('should update multiple guest vehicles in main loop', () => {
      const mockPlayerVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        getForwardSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
        chassisMesh: {
          position: new THREE.Vector3(0, 1, 0),
          quaternion: new THREE.Quaternion(),
        },
      } as any;

      const mockPlayerController = {
        update: vi.fn(),
        getVehicle: vi.fn(() => mockPlayerVehicle),
      } as any;

      const mockGuestVehicles = [
        {
          rigidBody: {
            translation: vi.fn(() => ({ x: 10, y: 1, z: 5 })),
            rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
            linvel: vi.fn(() => ({ x: 0, y: 0, z: 20 })),
          },
          getSpeedKmh: vi.fn(() => 72),
          getForwardSpeedKmh: vi.fn(() => 72),
          syncVisuals: vi.fn(),
        },
        {
          rigidBody: {
            translation: vi.fn(() => ({ x: 15, y: 1, z: 8 })),
            rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
            linvel: vi.fn(() => ({ x: 0, y: 0, z: 25 })),
          },
          getSpeedKmh: vi.fn(() => 90),
          getForwardSpeedKmh: vi.fn(() => 90),
          syncVisuals: vi.fn(),
        },
      ] as any[];

      const mockGuestControllers = [
        { update: vi.fn() },
        { update: vi.fn() },
      ] as any[];

      const mockRaceController = {
        update: vi.fn(),
        getPlayerPosition: vi.fn(() => 1),
        getTotalCars: vi.fn(() => 3),
        getPlayerLapState: vi.fn(() => ({
          currentLap: 1,
          lapTime: 0,
          lastLapTime: null,
          bestLapTime: null,
        })),
      } as any;

      (racingState as any).gameMode = 'multi_host';
      (racingState as any).playerId = 'host-id';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).inputService = mockInputService;
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).playerController = mockPlayerController;
      (racingState as any).raceController = mockRaceController;
      (racingState as any).opponentInitialized = true;
      (racingState as any).cameraTarget = new THREE.Vector3();
      (racingState as any).cameraOffset = new THREE.Vector3(0, 2, -5);

      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-1', {
        vehicle: mockGuestVehicles[0],
        controller: mockGuestControllers[0],
        lastInput: { throttle: 0.5, brake: 0, steer: 0 },
      });
      guestVehicles.set('guest-2', {
        vehicle: mockGuestVehicles[1],
        controller: mockGuestControllers[1],
        lastInput: { throttle: 0.8, brake: 0, steer: -0.3 },
      });

      racingState.update(0.016);

      // All guest controllers should be updated
      expect(mockGuestControllers[0].update).toHaveBeenCalledWith(
        { throttle: 0.5, brake: 0, steer: 0 },
        0.016
      );
      expect(mockGuestControllers[1].update).toHaveBeenCalledWith(
        { throttle: 0.8, brake: 0, steer: -0.3 },
        0.016
      );

      // All guest vehicles should sync visuals
      expect(mockGuestVehicles[0].syncVisuals).toHaveBeenCalled();
      expect(mockGuestVehicles[1].syncVisuals).toHaveBeenCalled();
    });

    it('should not update guest vehicles in single player mode', () => {
      const mockPlayerVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        getForwardSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
        chassisMesh: {
          position: new THREE.Vector3(0, 1, 0),
          quaternion: new THREE.Quaternion(),
        },
      } as any;

      const mockPlayerController = {
        update: vi.fn(),
        getVehicle: vi.fn(() => mockPlayerVehicle),
      } as any;

      const mockOpponentController = {
        updateAI: vi.fn(),
      } as any;

      const mockRaceController = {
        update: vi.fn(),
        getPlayerPosition: vi.fn(() => 1),
        getTotalCars: vi.fn(() => 6),
        getPlayerLapState: vi.fn(() => ({
          currentLap: 1,
          lapTime: 0,
          lastLapTime: null,
          bestLapTime: null,
        })),
      } as any;

      (racingState as any).gameMode = 'single';
      (racingState as any).playerId = 'local';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).inputService = mockInputService;
      (racingState as any).playerController = mockPlayerController;
      (racingState as any).raceController = mockRaceController;
      (racingState as any).opponentController = mockOpponentController;
      (racingState as any).opponentInitialized = true;
      (racingState as any).cameraTarget = new THREE.Vector3();
      (racingState as any).cameraOffset = new THREE.Vector3(0, 2, -5);

      // Add a guest vehicle (should not be updated in single player)
      const mockGuestVehicle = {
        syncVisuals: vi.fn(),
      } as any;
      const mockGuestController = {
        update: vi.fn(),
      } as any;

      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-id', {
        vehicle: mockGuestVehicle,
        controller: mockGuestController,
        lastInput: { throttle: 0.5, brake: 0, steer: 0 },
      });

      racingState.update(0.016);

      // Guest controller should NOT be updated in single player mode
      expect(mockGuestController.update).not.toHaveBeenCalled();
      expect(mockGuestVehicle.syncVisuals).not.toHaveBeenCalled();

      // AI opponents should be updated instead
      expect(mockOpponentController.updateAI).toHaveBeenCalled();
    });

    it('should call controller.update before syncVisuals for each guest', () => {
      const mockPlayerVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        getForwardSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
        chassisMesh: {
          position: new THREE.Vector3(0, 1, 0),
          quaternion: new THREE.Quaternion(),
        },
      } as any;

      const mockPlayerController = {
        update: vi.fn(),
        getVehicle: vi.fn(() => mockPlayerVehicle),
      } as any;

      const mockGuestVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 10, y: 1, z: 5 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 20 })),
        },
        getSpeedKmh: vi.fn(() => 72),
        getForwardSpeedKmh: vi.fn(() => 72),
        syncVisuals: vi.fn(),
      } as any;

      const mockGuestController = {
        update: vi.fn(),
      } as any;

      const mockRaceController = {
        update: vi.fn(),
        getPlayerPosition: vi.fn(() => 1),
        getTotalCars: vi.fn(() => 2),
        getPlayerLapState: vi.fn(() => ({
          currentLap: 1,
          lapTime: 0,
          lastLapTime: null,
          bestLapTime: null,
        })),
      } as any;

      (racingState as any).gameMode = 'multi_host';
      (racingState as any).playerId = 'host-id';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).inputService = mockInputService;
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).playerController = mockPlayerController;
      (racingState as any).raceController = mockRaceController;
      (racingState as any).opponentInitialized = true;
      (racingState as any).cameraTarget = new THREE.Vector3();
      (racingState as any).cameraOffset = new THREE.Vector3(0, 2, -5);

      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('guest-id', {
        vehicle: mockGuestVehicle,
        controller: mockGuestController,
        lastInput: { throttle: 0.7, brake: 0, steer: 0.2 },
      });

      racingState.update(0.016);

      // Verify controller.update was called before syncVisuals
      const updateCallOrder = (mockGuestController.update as any).mock.invocationCallOrder[0];
      const syncCallOrder = (mockGuestVehicle.syncVisuals as any).mock.invocationCallOrder[0];

      expect(updateCallOrder).toBeDefined();
      expect(syncCallOrder).toBeDefined();
      expect(syncCallOrder).toBeGreaterThan(updateCallOrder);
    });

    it('should update guest vehicles every frame with accumulated input', () => {
      const mockPlayerVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        getForwardSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
        chassisMesh: {
          position: new THREE.Vector3(0, 1, 0),
          quaternion: new THREE.Quaternion(),
        },
      } as any;

      const mockPlayerController = {
        update: vi.fn(),
        getVehicle: vi.fn(() => mockPlayerVehicle),
      } as any;

      const mockGuestVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 10, y: 1, z: 5 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 20 })),
        },
        getSpeedKmh: vi.fn(() => 72),
        getForwardSpeedKmh: vi.fn(() => 72),
        syncVisuals: vi.fn(),
      } as any;

      const mockGuestController = {
        update: vi.fn(),
      } as any;

      const mockRaceController = {
        update: vi.fn(),
        getPlayerPosition: vi.fn(() => 1),
        getTotalCars: vi.fn(() => 2),
        getPlayerLapState: vi.fn(() => ({
          currentLap: 1,
          lapTime: 0,
          lastLapTime: null,
          bestLapTime: null,
        })),
      } as any;

      (racingState as any).gameMode = 'multi_host';
      (racingState as any).playerId = 'host-id';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).inputService = mockInputService;
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).playerController = mockPlayerController;
      (racingState as any).raceController = mockRaceController;
      (racingState as any).opponentInitialized = true;
      (racingState as any).cameraTarget = new THREE.Vector3();
      (racingState as any).cameraOffset = new THREE.Vector3(0, 2, -5);

      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      const initialInput = { throttle: 0.5, brake: 0, steer: 0 };
      guestVehicles.set('guest-id', {
        vehicle: mockGuestVehicle,
        controller: mockGuestController,
        lastInput: initialInput,
      });

      // Frame 1
      racingState.update(0.016);
      expect(mockGuestController.update).toHaveBeenCalledWith(initialInput, 0.016);
      expect(mockGuestVehicle.syncVisuals).toHaveBeenCalledTimes(1);

      // Simulate new input arriving
      const newInput = { throttle: 0.8, brake: 0, steer: 0.3 };
      guestVehicles.get('guest-id')!.lastInput = newInput;

      // Frame 2
      racingState.update(0.016);
      expect(mockGuestController.update).toHaveBeenCalledWith(newInput, 0.016);
      expect(mockGuestVehicle.syncVisuals).toHaveBeenCalledTimes(2);
    });

    it('should not update guest vehicles when in guest mode', () => {
      const mockPlayerVehicle = {
        rigidBody: {
          translation: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
          rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
          linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        },
        getSpeedKmh: vi.fn(() => 0),
        getForwardSpeedKmh: vi.fn(() => 0),
        syncVisuals: vi.fn(),
        chassisMesh: {
          position: new THREE.Vector3(0, 1, 0),
          quaternion: new THREE.Quaternion(),
        },
      } as any;

      const mockPlayerController = {
        update: vi.fn(),
        getVehicle: vi.fn(() => mockPlayerVehicle),
      } as any;

      const mockGuestController = {
        update: vi.fn(),
      } as any;

      const mockRaceController = {
        update: vi.fn(),
        getPlayerPosition: vi.fn(() => 1),
        getTotalCars: vi.fn(() => 2),
        getPlayerLapState: vi.fn(() => ({
          currentLap: 1,
          lapTime: 0,
          lastLapTime: null,
          bestLapTime: null,
        })),
      } as any;

      const mockOpponentController = {
        updateRemoteVisuals: vi.fn(),
      } as any;

      (racingState as any).gameMode = 'multi_guest'; // Guest mode
      (racingState as any).playerId = 'guest-id';
      (racingState as any).physicsService = mockPhysicsService;
      (racingState as any).renderService = mockRenderService;
      (racingState as any).inputService = mockInputService;
      (racingState as any).networkService = mockNetworkService;
      (racingState as any).playerController = mockPlayerController;
      (racingState as any).raceController = mockRaceController;
      (racingState as any).opponentController = mockOpponentController;
      (racingState as any).opponentInitialized = true;
      (racingState as any).cameraTarget = new THREE.Vector3();
      (racingState as any).cameraOffset = new THREE.Vector3(0, 2, -5);

      // Add a "guest" vehicle (shouldn't be updated by guest client)
      const guestVehicles = (racingState as any).guestVehicles as Map<string, any>;
      guestVehicles.set('other-guest', {
        vehicle: {} as any,
        controller: mockGuestController,
        lastInput: { throttle: 0.5, brake: 0, steer: 0 },
      });

      racingState.update(0.016);

      // Guest controller should NOT be updated when we are in guest mode
      expect(mockGuestController.update).not.toHaveBeenCalled();

      // Instead, remote visuals should be updated via OpponentController
      expect(mockOpponentController.updateRemoteVisuals).toHaveBeenCalled();
    });
  });

  describe('Guest: Host Vehicle Visibility', () => {
    it('should create remote player mesh for host when receiving first snapshot', () => {
      const mockOpponentController = {
        getRemotePlayerMesh: vi.fn(() => null), // No mesh exists yet
        addRemotePlayer: vi.fn(),
        updateRemotePlayer: vi.fn(),
      } as any;

      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).opponentController = mockOpponentController;

      const hostSnapshot = {
        tick: 1,
        timestamp: 100,
        players: [
          {
            id: 'host-id',
            name: 'Host Player',
            carColor: 0xff0000,
            position: [0, 1, 0],
            rotation: [0, 0, 0, 1],
            velocity: [0, 0, 0],
            speedKmh: 0,
          },
        ],
      };

      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      handleHostSnapshot(hostSnapshot);

      // Verify remote player was created
      expect(mockOpponentController.addRemotePlayer).toHaveBeenCalledWith(
        'host-id',
        'Host Player',
        0xff0000,
        false
      );

      // Verify remote player was updated with snapshot
      expect(mockOpponentController.updateRemotePlayer).toHaveBeenCalledWith(
        hostSnapshot.players[0],
        expect.any(Number)
      );
    });

    it('should update existing host mesh when receiving subsequent snapshots', () => {
      const mockHostMesh = new THREE.Mesh();
      const mockOpponentController = {
        getRemotePlayerMesh: vi.fn(() => mockHostMesh), // Mesh already exists
        addRemotePlayer: vi.fn(),
        updateRemotePlayer: vi.fn(),
      } as any;

      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).opponentController = mockOpponentController;

      const hostSnapshot = {
        tick: 2,
        timestamp: 116,
        players: [
          {
            id: 'host-id',
            name: 'Host Player',
            carColor: 0xff0000,
            position: [10, 1, 5],
            rotation: [0, 0.1, 0, 0.995],
            velocity: [5, 0, 10],
            speedKmh: 72,
          },
        ],
      };

      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      handleHostSnapshot(hostSnapshot);

      // Should NOT create a new player (mesh already exists)
      expect(mockOpponentController.addRemotePlayer).not.toHaveBeenCalled();

      // Should update existing player
      expect(mockOpponentController.updateRemotePlayer).toHaveBeenCalledWith(
        hostSnapshot.players[0],
        expect.any(Number)
      );
    });

    it('should buffer snapshots when OpponentController is not ready', () => {
      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).opponentController = null; // Not ready yet
      (racingState as any).pendingSnapshots = [];

      const hostSnapshot = {
        tick: 1,
        timestamp: 100,
        players: [
          {
            id: 'host-id',
            name: 'Host Player',
            carColor: 0xff0000,
            position: [0, 1, 0],
            rotation: [0, 0, 0, 1],
            velocity: [0, 0, 0],
            speedKmh: 0,
          },
        ],
      };

      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      handleHostSnapshot(hostSnapshot);

      // Verify snapshot was buffered
      const pendingSnapshots = (racingState as any).pendingSnapshots;
      expect(pendingSnapshots).toHaveLength(1);
      expect(pendingSnapshots[0].snapshot).toEqual(hostSnapshot);
    });

    it('should flush buffered snapshots when OpponentController becomes ready', () => {
      const mockOpponentController = {
        getRemotePlayerMesh: vi.fn(() => null),
        addRemotePlayer: vi.fn(),
        updateRemotePlayer: vi.fn(),
      } as any;

      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).opponentController = null;
      (racingState as any).pendingSnapshots = [];

      // Receive snapshot while OpponentController is not ready
      const hostSnapshot = {
        tick: 1,
        timestamp: 100,
        players: [
          {
            id: 'host-id',
            name: 'Host Player',
            carColor: 0xff0000,
            position: [0, 1, 0],
            rotation: [0, 0, 0, 1],
            velocity: [0, 0, 0],
            speedKmh: 0,
          },
        ],
      };

      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      handleHostSnapshot(hostSnapshot);

      // Verify snapshot was buffered
      expect((racingState as any).pendingSnapshots).toHaveLength(1);

      // Now OpponentController becomes ready
      (racingState as any).opponentController = mockOpponentController;

      // Flush buffered snapshots
      const flushPendingSnapshots = (racingState as any).flushPendingSnapshots.bind(racingState);
      flushPendingSnapshots();

      // Verify buffered snapshot was processed
      expect(mockOpponentController.addRemotePlayer).toHaveBeenCalledWith(
        'host-id',
        'Host Player',
        0xff0000,
        false
      );
      expect(mockOpponentController.updateRemotePlayer).toHaveBeenCalled();

      // Verify buffer was cleared
      expect((racingState as any).pendingSnapshots).toHaveLength(0);
    });

    it('should skip local player in snapshot and only process host', () => {
      const mockOpponentController = {
        getRemotePlayerMesh: vi.fn(() => null),
        addRemotePlayer: vi.fn(),
        updateRemotePlayer: vi.fn(),
      } as any;

      const mockClientPrediction = {
        reconcile: vi.fn(),
        clearOldInputs: vi.fn(),
      } as any;

      (racingState as any).gameMode = 'multi_guest';
      (racingState as any).playerId = 'guest-id';
      (racingState as any).opponentController = mockOpponentController;
      (racingState as any).clientPrediction = mockClientPrediction;

      const snapshotWithBothPlayers = {
        tick: 1,
        timestamp: 100,
        players: [
          {
            id: 'host-id',
            name: 'Host Player',
            carColor: 0xff0000,
            position: [0, 1, 0],
            rotation: [0, 0, 0, 1],
            velocity: [0, 0, 0],
            speedKmh: 0,
          },
          {
            id: 'guest-id', // This is us
            name: 'Guest Player',
            carColor: 0x00ff00,
            position: [10, 1, 5],
            rotation: [0, 0.1, 0, 0.995],
            velocity: [5, 0, 10],
            speedKmh: 72,
          },
        ],
      };

      const handleHostSnapshot = (racingState as any).handleHostSnapshot.bind(racingState);
      handleHostSnapshot(snapshotWithBothPlayers);

      // Should create remote player only for host
      expect(mockOpponentController.addRemotePlayer).toHaveBeenCalledTimes(1);
      expect(mockOpponentController.addRemotePlayer).toHaveBeenCalledWith(
        'host-id',
        'Host Player',
        0xff0000,
        false
      );

      // Should reconcile local player
      expect(mockClientPrediction.reconcile).toHaveBeenCalledWith(
        snapshotWithBothPlayers.players[1],
        expect.any(Number)
      );

      // Should update remote player only for host
      expect(mockOpponentController.updateRemotePlayer).toHaveBeenCalledTimes(1);
      expect(mockOpponentController.updateRemotePlayer).toHaveBeenCalledWith(
        snapshotWithBothPlayers.players[0],
        expect.any(Number)
      );
    });
  });
});
