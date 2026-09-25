import { randomBytes, randomUUID } from "node:crypto";
import { Db } from "./db";
import { iso, SystemClock, type Clock } from "./clock";
import {
  SEED_AGENTS,
  SEED_CONNECTOR,
  SEED_ENTITIES,
  SEED_MISSION,
  SEED_POLICIES,
  SEED_PRINCIPALS,
  SEED_RESOURCES,
} from "./domain/seed";
import type {
  AgentIdentity,
  AuthorityLease,
  ConnectorState,
  DecisionRecord,
  DemoRole,
  DemoSession,
  Entity,
  EntityPolicy,
  ExactActionApproval,
  GovernanceEvent,
  GovernanceEventKind,
  LeaseProposal,
  Mission,
  PendingActionRequest,
  Principal,
  ProtectedResource,
} from "./domain/types";

/**
 * Server-owned state. All reads and writes used by the resolver, the lifecycle
 * endpoints, the graph projection and the UI read models go through here.
 */
export class Store {
  constructor(
    readonly db: Db,
    readonly clock: Clock,
  ) {
    if (!this.db.get<{ id: string; seededAt: string }>("meta", "seed")) {
      this.reset();
    }
  }

  now(): Date {
    return this.clock.now();
  }

  nowIso(): string {
    return iso(this.clock.now());
  }

  newId(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  /** Restore the known initial demo state without restarting the process. */
  reset(): void {
    this.db.transaction(() => {
      for (const kind of [
        "entity",
        "principal",
        "agent",
        "mission",
        "policy",
        "resource",
        "lease",
        "approval",
        "pending",
        "decision",
        "connector",
        "proposal",
      ] as const) {
        this.db.deleteAll(kind);
      }
      this.db.clearEvents();
      SEED_ENTITIES.forEach((e) => this.db.put("entity", e));
      SEED_PRINCIPALS.forEach((p) => this.db.put("principal", p));
      SEED_AGENTS.forEach((a) => this.db.put("agent", a));
      SEED_POLICIES.forEach((p) => this.db.put("policy", p));
      SEED_RESOURCES.forEach((r) => this.db.put("resource", r));
      this.db.put("mission", { ...SEED_MISSION });
      this.db.put("connector", { id: SEED_CONNECTOR.resourceId, ...SEED_CONNECTOR });
      this.db.put("meta", { id: "seed", seededAt: this.nowIso() });
      this.appendEvent("RESET", null, "Demo state reset to initial conditions", null, null, null);
    });
  }

  // ---- identities -------------------------------------------------------

  getEntity(id: string): Entity | null {
    return this.db.get<Entity>("entity", id);
  }
  listEntities(): Entity[] {
    return this.db.list<Entity>("entity");
  }
  getPrincipal(id: string): Principal | null {
    return this.db.get<Principal>("principal", id);
  }
  listPrincipals(): Principal[] {
    return this.db.list<Principal>("principal");
  }
  getAgent(id: string): AgentIdentity | null {
    return this.db.get<AgentIdentity>("agent", id);
  }
  getAgentByPrincipal(principalId: string): AgentIdentity | null {
    return this.db.list<AgentIdentity>("agent").find((a) => a.principalId === principalId) ?? null;
  }
  listAgents(): AgentIdentity[] {
    return this.db.list<AgentIdentity>("agent");
  }

  // ---- demo sessions (synthetic identity mechanism, not authentication) ---

  issueSession(role: DemoRole): { session: DemoSession; principal: Principal } {
    const principal = this.listPrincipals().find((p) => p.role === role && p.active);
    if (!principal) throw new Error(`No active principal for role ${role}`);
    const session: DemoSession = {
      token: randomBytes(18).toString("base64url"),
      principalId: principal.id,
      issuedAt: this.nowIso(),
    };
    this.db.put("session", { id: session.token, ...session });
    return { session, principal };
  }

  resolveSession(token: string | null | undefined): Principal | null {
    if (!token) return null;
    const session = this.db.get<DemoSession & { id: string }>("session", token);
    if (!session) return null;
    const principal = this.getPrincipal(session.principalId);
    return principal && principal.active ? principal : null;
  }

  // ---- mission / policy / resources --------------------------------------

  getMission(id: string): Mission | null {
    return this.db.get<Mission>("mission", id);
  }
  putMission(m: Mission): Mission {
    return this.db.put("mission", m);
  }
  getPolicy(id: string): EntityPolicy | null {
    return this.db.get<EntityPolicy>("policy", id);
  }
  putPolicy(p: EntityPolicy): EntityPolicy {
    return this.db.put("policy", p);
  }
  getResource(id: string): ProtectedResource | null {
    return this.db.get<ProtectedResource>("resource", id);
  }
  listResources(): ProtectedResource[] {
    return this.db.list<ProtectedResource>("resource");
  }

  // ---- leases -----------------------------------------------------------

  getLease(id: string): AuthorityLease | null {
    return this.db.get<AuthorityLease>("lease", id);
  }
  listLeases(): AuthorityLease[] {
    return this.db.list<AuthorityLease>("lease");
  }
  putLease(l: AuthorityLease): AuthorityLease {
    return this.db.put("lease", l);
  }

  getProposal(id: string): LeaseProposal | null {
    return this.db.get<LeaseProposal>("proposal", id);
  }
  listProposals(): LeaseProposal[] {
    return this.db.list<LeaseProposal>("proposal");
  }
  putProposal(p: LeaseProposal): LeaseProposal {
    return this.db.put("proposal", p);
  }

  // ---- approvals / pending step-up ----------------------------------------

  getApproval(id: string): ExactActionApproval | null {
    return this.db.get<ExactActionApproval>("approval", id);
  }
  listApprovals(): ExactActionApproval[] {
    return this.db.list<ExactActionApproval>("approval");
  }
  putApproval(a: ExactActionApproval): ExactActionApproval {
    return this.db.put("approval", a);
  }
  getPending(id: string): PendingActionRequest | null {
    return this.db.get<PendingActionRequest>("pending", id);
  }
  listPending(): PendingActionRequest[] {
    return this.db.list<PendingActionRequest>("pending");
  }
  putPending(p: PendingActionRequest): PendingActionRequest {
    return this.db.put("pending", p);
  }

  // ---- connector state ----------------------------------------------------

  getConnector(resourceId: string): ConnectorState | null {
    const doc = this.db.get<ConnectorState & { id: string }>("connector", resourceId);
    if (!doc) return null;
    const { id: _id, ...state } = doc;
    void _id;
    return state;
  }
  putConnector(c: ConnectorState): ConnectorState {
    this.db.put("connector", { id: c.resourceId, ...c });
    return c;
  }

  // ---- decisions / events -------------------------------------------------

  putDecision(d: DecisionRecord): DecisionRecord {
    return this.db.put("decision", d);
  }
  getDecision(id: string): DecisionRecord | null {
    return this.db.get<DecisionRecord>("decision", id);
  }
  listDecisions(): DecisionRecord[] {
    return this.db.list<DecisionRecord>("decision");
  }

  appendEvent(
    kind: GovernanceEventKind,
    actorId: string | null,
    summary: string,
    receiptId: string | null,
    leaseId: string | null,
    leaseVersion: number | null,
  ): GovernanceEvent {
    const event: GovernanceEvent = {
      id: this.newId("evt"),
      seq: 0,
      kind,
      at: this.nowIso(),
      actorId,
      summary,
      receiptId,
      leaseId,
      leaseVersion,
    };
    event.seq = this.db.appendEvent(event);
    this.db.updateEvent(event);
    return event;
  }

  listEvents(): GovernanceEvent[] {
    return this.db.listEvents<GovernanceEvent>();
  }
}

// ---- process-wide singleton (survives Next.js HMR via globalThis) ----------

declare global {
  var __qalaaStore: Store | undefined;
}

export function createStore(location: string, clock: Clock): Store {
  return new Store(new Db(location), clock);
}

export function getStore(): Store {
  if (!globalThis.__qalaaStore) {
    const location = process.env.QALAA_DB_PATH ?? `${process.cwd()}/data/qalaa.sqlite`;
    globalThis.__qalaaStore = createStore(location, new SystemClock());
  }
  return globalThis.__qalaaStore;
}
