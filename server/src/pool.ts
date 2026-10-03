import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

export interface LiveKitProjectConfig {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  apiSecret: string;
  maxParticipants: number;
  priority: number;
  isActive: boolean;
}

export interface RoomMetadata {
  name: string;
  passcode?: string;
  hostIdentity?: string;
  projectId: string;
  createdAt: number;
}

export class LiveKitPoolManager {
  private projects: Map<string, LiveKitProjectConfig> = new Map();
  private roomMetadataStore: Map<string, RoomMetadata> = new Map();

  constructor() {
    this.loadProjectsFromEnv();
  }

  /**
   * Load projects dynamically from environment variables.
   * Supports:
   * 1. Indexed: LIVEKIT_1_URL, LIVEKIT_1_API_KEY, LIVEKIT_1_API_SECRET, LIVEKIT_1_NAME, LIVEKIT_1_MAX_PARTICIPANTS
   *             LIVEKIT_2_URL, LIVEKIT_2_API_KEY, ...
   * 2. Single/Legacy fallback: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
   */
  public loadProjectsFromEnv(): void {
    this.projects.clear();
    let index = 1;

    // Check for indexed projects LIVEKIT_1_..., LIVEKIT_2_...
    while (true) {
      const url = process.env[`LIVEKIT_${index}_URL`];
      const apiKey = process.env[`LIVEKIT_${index}_API_KEY`];
      const apiSecret = process.env[`LIVEKIT_${index}_API_SECRET`];

      if (!url || !apiKey || !apiSecret) {
        break;
      }

      const name = process.env[`LIVEKIT_${index}_NAME`] || `Servidor ${index}`;
      const maxParticipants = parseInt(process.env[`LIVEKIT_${index}_MAX_PARTICIPANTS`] || '100', 10);

      this.projects.set(`proj_${index}`, {
        id: `proj_${index}`,
        name,
        url,
        apiKey,
        apiSecret,
        maxParticipants,
        priority: index,
        isActive: true,
      });

      index++;
    }

    // Fallback: If no indexed projects found, check standard single LIVEKIT_URL
    if (this.projects.size === 0) {
      const singleUrl = process.env.LIVEKIT_URL;
      const singleKey = process.env.LIVEKIT_API_KEY;
      const singleSecret = process.env.LIVEKIT_API_SECRET;

      if (singleUrl && singleKey && singleSecret) {
        this.projects.set('proj_1', {
          id: 'proj_1',
          name: process.env.LIVEKIT_NAME || 'Servidor Principal',
          url: singleUrl,
          apiKey: singleKey,
          apiSecret: singleSecret,
          maxParticipants: parseInt(process.env.LIVEKIT_MAX_PARTICIPANTS || '100', 10),
          priority: 1,
          isActive: true,
        });
      }
    }

    console.log(`📡 [LiveKit Pool] ${this.projects.size} projeto(s) LiveKit carregado(s):`);
    for (const project of this.projects.values()) {
      console.log(`   - [${project.id}] ${project.name} -> ${project.url} (Prioridade: ${project.priority}, Limite: ${project.maxParticipants})`);
    }
  }

  public getProjects(): LiveKitProjectConfig[] {
    return Array.from(this.projects.values());
  }

  public getProject(projectId: string): LiveKitProjectConfig | undefined {
    return this.projects.get(projectId);
  }

  public getSortedActiveProjects(): LiveKitProjectConfig[] {
    return Array.from(this.projects.values())
      .filter(p => p.isActive)
      .sort((a, b) => a.priority - b.priority);
  }

  public getRoomServiceClient(project: LiveKitProjectConfig): RoomServiceClient {
    const httpUrl = project.url.replace('ws://', 'http://').replace('wss://', 'https://');
    return new RoomServiceClient(httpUrl, project.apiKey, project.apiSecret);
  }

  /**
   * Get project for a room:
   * 1. If room already exists in metadata store or active on a server, reuse that project.
   * 2. If new room, route to first project with available capacity.
   */
  public async getProjectForRoom(roomName: string): Promise<LiveKitProjectConfig> {
    // Check if room metadata already has an assigned project
    const existingMeta = this.roomMetadataStore.get(roomName);
    if (existingMeta) {
      const assigned = this.projects.get(existingMeta.projectId);
      if (assigned && assigned.isActive) {
        return assigned;
      }
    }

    // Check if room is active on any of our LiveKit projects
    for (const project of this.getSortedActiveProjects()) {
      try {
        const client = this.getRoomServiceClient(project);
        const liveRooms = await client.listRooms([roomName]);
        if (liveRooms && liveRooms.length > 0 && liveRooms[0].numParticipants > 0) {
          if (existingMeta) {
            existingMeta.projectId = project.id;
          }
          return project;
        }
      } catch {
        // Continue checking other projects
      }
    }

    // New Room: Find the first project with capacity
    const selected = await this.findFirstProjectWithCapacity();
    return selected;
  }

  /**
   * Finds the first project with available participant slots.
   */
  public async findFirstProjectWithCapacity(excludeProjectId?: string): Promise<LiveKitProjectConfig> {
    const sorted = this.getSortedActiveProjects().filter(p => p.id !== excludeProjectId);

    if (sorted.length === 0) {
      // If no other projects, return default
      return this.getSortedActiveProjects()[0] || Array.from(this.projects.values())[0];
    }

    for (const project of sorted) {
      try {
        const client = this.getRoomServiceClient(project);
        const rooms = await client.listRooms();
        const currentParticipants = rooms.reduce((acc, r) => acc + r.numParticipants, 0);

        if (currentParticipants < project.maxParticipants) {
          return project;
        }
      } catch (err) {
        console.warn(`[LiveKit Pool] Erro ao checar cota do projeto ${project.id}:`, err);
      }
    }

    // Fallback if all are at/over limit: return the next available project in priority
    return sorted[0];
  }

  /**
   * Migrate a room to the next available project in the pool.
   * Cycles through active projects in round-robin order.
   */
  public async migrateRoom(
    roomName: string,
    targetProjectId?: string,
    currentProjectId?: string
  ): Promise<LiveKitProjectConfig> {
    const activeProjects = this.getSortedActiveProjects();
    if (activeProjects.length <= 1) {
      return activeProjects[0] || Array.from(this.projects.values())[0];
    }

    // 1. Explicit target requested
    if (targetProjectId) {
      const explicit = this.projects.get(targetProjectId);
      if (explicit && explicit.isActive) {
        this.setRoomMetadata(roomName, {
          name: roomName,
          projectId: explicit.id,
          createdAt: Date.now(),
        });
        return explicit;
      }
    }

    // 2. Identify the current project
    let detectedCurrentId = currentProjectId || this.roomMetadataStore.get(roomName)?.projectId;
    if (!detectedCurrentId) {
      for (const p of activeProjects) {
        try {
          const client = this.getRoomServiceClient(p);
          const liveRooms = await client.listRooms([roomName]);
          if (liveRooms && liveRooms.length > 0) {
            detectedCurrentId = p.id;
            break;
          }
        } catch {}
      }
    }

    // 3. Guaranteed rotation to the next project in cyclic order
    let nextProject: LiveKitProjectConfig;
    if (detectedCurrentId) {
      const currentIndex = activeProjects.findIndex(p => p.id === detectedCurrentId);
      if (currentIndex >= 0) {
        const nextIndex = (currentIndex + 1) % activeProjects.length;
        nextProject = activeProjects[nextIndex];
      } else {
        nextProject = activeProjects.find(p => p.id !== detectedCurrentId) || activeProjects[0];
      }
    } else {
      nextProject = activeProjects[1] || activeProjects[0];
    }

    // Update metadata store
    const currentMeta = this.roomMetadataStore.get(roomName);
    if (currentMeta) {
      currentMeta.projectId = nextProject.id;
    } else {
      this.roomMetadataStore.set(roomName, {
        name: roomName,
        projectId: nextProject.id,
        createdAt: Date.now(),
      });
    }

    console.log(`🔄 [LiveKit Pool] Sala "${roomName}" migrada de [${detectedCurrentId || 'desconhecido'}] para [${nextProject.id}] ${nextProject.name}`);
    return nextProject;
  }

  /**
   * Access Token generator for a participant.
   */
  public async createAccessToken(
    project: LiveKitProjectConfig,
    roomName: string,
    participantIdentity: string,
    isPublisher: boolean
  ): Promise<string> {
    const at = new AccessToken(project.apiKey, project.apiSecret, {
      identity: participantIdentity,
      name: participantIdentity,
      ttl: '6h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      roomAdmin: Boolean(isPublisher),
    });

    return await at.toJwt();
  }

  // Room Metadata Management
  public getRoomMetadata(roomName: string): RoomMetadata | undefined {
    return this.roomMetadataStore.get(roomName);
  }

  public setRoomMetadata(roomName: string, meta: RoomMetadata): void {
    this.roomMetadataStore.set(roomName, meta);
  }

  public deleteRoomMetadata(roomName: string): void {
    this.roomMetadataStore.delete(roomName);
  }

  /**
   * List active rooms across all LiveKit projects in the pool.
   */
  public async listAllActiveRooms(): Promise<Array<{
    name: string;
    numParticipants: number;
    creationTime: number;
    hasPasscode: boolean;
    projectId: string;
    projectName: string;
  }>> {
    const activeRoomsMap = new Map<string, {
      name: string;
      numParticipants: number;
      creationTime: number;
      hasPasscode: boolean;
      projectId: string;
      projectName: string;
    }>();

    const activeNames = new Set<string>();

    for (const project of this.getSortedActiveProjects()) {
      try {
        const client = this.getRoomServiceClient(project);
        const rooms = await client.listRooms();
        for (const r of rooms) {
          if (r.numParticipants > 0) {
            activeNames.add(r.name);
            const meta = this.roomMetadataStore.get(r.name);
            activeRoomsMap.set(r.name, {
              name: r.name,
              numParticipants: r.numParticipants,
              creationTime: Number(r.creationTime),
              hasPasscode: Boolean(meta?.passcode),
              projectId: project.id,
              projectName: project.name,
            });
          }
        }
      } catch (err) {
        console.warn(`[LiveKit Pool] Não foi possível listar salas do projeto ${project.id}:`, err);
      }
    }

    // Clean up stale metadata
    for (const [name] of this.roomMetadataStore.entries()) {
      if (!activeNames.has(name)) {
        this.roomMetadataStore.delete(name);
      }
    }

    return Array.from(activeRoomsMap.values());
  }
}
