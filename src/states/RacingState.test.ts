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
    } as any;

    mockRenderService = {
      getScene: vi.fn(() => new THREE.Scene()),
      getCamera: vi.fn(() => new THREE.PerspectiveCamera()),
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
});
