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

interface ProjectHealthStatus {
  healthy: boolean;
  checkedAt: number;
  statusCode?: number;
  reason?: string;
}

export class LiveKitPoolManager {
  private projects: Map<string, LiveKitProjectConfig> = new Map();
  private roomMetadataStore: Map<string, RoomMetadata> = new Map();
  private healthCache: Map<string, ProjectHealthStatus> = new Map();
  private static HEALTH_CACHE_TTL_MS = 30_000; // 30 seconds cache

  constructor() {
    this.loadProjectsFromEnv();
  }

  /**
   * Load projects dynamically from environment variables.
   */
  public loadProjectsFromEnv(): void {
    this.projects.clear();
    let index = 1;

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
   * Fast proactive health & quota validation via LiveKit Cloud /rtc/v1/validate.
   * Catches HTTP 429 (Bandwidth/usage exceeded), rate limits, or connection errors in milliseconds.
   */
  public async validateProjectHealth(
    project: LiveKitProjectConfig,
    force = false
  ): Promise<{ healthy: boolean; reason?: string }> {
    const cached = this.healthCache.get(project.id);
    const now = Date.now();
    if (!force && cached && now - cached.checkedAt < LiveKitPoolManager.HEALTH_CACHE_TTL_MS) {
      return { healthy: cached.healthy, reason: cached.reason };
    }

    try {
      // 1. Generate quick validation token
      const probeToken = await this.createAccessToken(project, '__health_probe__', '__probe_user__', false);

      // 2. Call LiveKit /rtc/v1/validate endpoint
      const httpBase = project.url.replace('ws://', 'http://').replace('wss://', 'https://').replace(/\/$/, '');
      const validateUrl = `${httpBase}/rtc/v1/validate?access_token=${encodeURIComponent(probeToken)}`;

      const response = await fetch(validateUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(2500),
      });

      const responseText = await response.text().catch(() => '');

      if (response.status === 200) {
        this.healthCache.set(project.id, {
          healthy: true,
          checkedAt: now,
          statusCode: 200,
        });
        return { healthy: true };
      }

      // Check if 429 or quota limit
      const isQuotaExceeded =
        response.status === 429 ||
        response.status === 402 ||
        responseText.toLowerCase().includes('bandwidth') ||
        responseText.toLowerCase().includes('exceeded') ||
        responseText.toLowerCase().includes('quota') ||
        responseText.toLowerCase().includes('limit');

      const reason = responseText || `HTTP ${response.status} ${response.statusText}`;

      this.healthCache.set(project.id, {
        healthy: !isQuotaExceeded && response.status < 500,
        checkedAt: now,
        statusCode: response.status,
        reason,
      });

      if (isQuotaExceeded) {
        console.warn(`⚠️ [LiveKit Pool] Projeto [${project.id}] "${project.name}" atingiu limite/cota (429): ${reason}`);
        return { healthy: false, reason };
      }

      return { healthy: true };
    } catch (err: any) {
      console.warn(`⚠️ [LiveKit Pool] Falha na sonda de validação do projeto [${project.id}] "${project.name}":`, err.message);
      return { healthy: true, reason: err.message };
    }
  }

  /**
   * Get project for a room with bandwidth constraint status.
   * - If room already exists, lets users connect even if bandwidth is constrained, returning isBandwidthConstrained: true.
   * - If new room, routes to first healthy project.
   */
  public async getProjectAssignmentWithHealth(roomName: string): Promise<{
    project: LiveKitProjectConfig;
    isBandwidthConstrained: boolean;
    quotaReason?: string;
  }> {
    const existingMeta = this.roomMetadataStore.get(roomName);
    if (existingMeta) {
      const assigned = this.projects.get(existingMeta.projectId);
      if (assigned && assigned.isActive) {
        const health = await this.validateProjectHealth(assigned);
        return {
          project: assigned,
          isBandwidthConstrained: !health.healthy,
          quotaReason: health.reason,
        };
      }
    }

    // Check if room is active on any LiveKit project
    for (const project of this.getSortedActiveProjects()) {
      try {
        const client = this.getRoomServiceClient(project);
        const liveRooms = await client.listRooms([roomName]);
        if (liveRooms && liveRooms.length > 0 && liveRooms[0].numParticipants > 0) {
          const health = await this.validateProjectHealth(project);
          if (existingMeta) {
            existingMeta.projectId = project.id;
          }
          return {
            project,
            isBandwidthConstrained: !health.healthy,
            quotaReason: health.reason,
          };
        }
      } catch {}
    }

    // New Room: Find the first healthy project with capacity
    const selected = await this.findFirstProjectWithCapacity();
    const health = await this.validateProjectHealth(selected);
    return {
      project: selected,
      isBandwidthConstrained: !health.healthy,
      quotaReason: health.reason,
    };
  }

  public async getProjectForRoom(roomName: string): Promise<LiveKitProjectConfig> {
    const { project } = await this.getProjectAssignmentWithHealth(roomName);
    return project;
  }

  /**
   * Finds the first healthy project with available participant slots.
   */
  public async findFirstProjectWithCapacity(excludeProjectId?: string): Promise<LiveKitProjectConfig> {
    const sorted = this.getSortedActiveProjects().filter(p => p.id !== excludeProjectId);

    if (sorted.length === 0) {
      return this.getSortedActiveProjects()[0] || Array.from(this.projects.values())[0];
    }

    // 1. First pass: find project that is BOTH healthy (not 429) and has capacity
    for (const project of sorted) {
      const health = await this.validateProjectHealth(project);
      if (!health.healthy) {
        continue; // Skip exhausted project
      }

      try {
        const client = this.getRoomServiceClient(project);
        const rooms = await client.listRooms();
        const currentParticipants = rooms.reduce((acc, r) => acc + r.numParticipants, 0);

        if (currentParticipants < project.maxParticipants) {
          return project;
        }
      } catch (err) {
        console.warn(`[LiveKit Pool] Erro ao consultar salas no projeto ${project.id}:`, err);
        return project;
      }
    }

    // 2. Second pass: find any project that is healthy
    for (const project of sorted) {
      const health = await this.validateProjectHealth(project);
      if (health.healthy) {
        return project;
      }
    }

    // Fallback: return the first candidate
    return sorted[0];
  }

  /**
   * Migrate a room to the next available healthy project in the pool.
   * Cycles through active projects in round-robin order, skipping any with 429 / quota exceeded.
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

    // 3. Find next HEALTHY project in cyclic sequence
    const startIndex = detectedCurrentId
      ? activeProjects.findIndex(p => p.id === detectedCurrentId)
      : -1;

    let selectedProject: LiveKitProjectConfig | undefined;

    for (let i = 1; i <= activeProjects.length; i++) {
      const candidateIndex = (Math.max(0, startIndex) + i) % activeProjects.length;
      const candidate = activeProjects[candidateIndex];

      if (candidate.id === detectedCurrentId && activeProjects.length > 1) {
        continue;
      }

      const health = await this.validateProjectHealth(candidate);
      if (health.healthy) {
        selectedProject = candidate;
        break;
      }
    }

    if (!selectedProject) {
      const nextIndex = (Math.max(0, startIndex) + 1) % activeProjects.length;
      selectedProject = activeProjects[nextIndex];
    }

    // Update metadata store
    const currentMeta = this.roomMetadataStore.get(roomName);
    if (currentMeta) {
      currentMeta.projectId = selectedProject.id;
    } else {
      this.roomMetadataStore.set(roomName, {
        name: roomName,
        projectId: selectedProject.id,
        createdAt: Date.now(),
      });
    }

    console.log(`🔄 [LiveKit Pool] Sala "${roomName}" migrada de [${detectedCurrentId || 'desconhecido'}] para [${selectedProject.id}] ${selectedProject.name}`);
    return selectedProject;
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
