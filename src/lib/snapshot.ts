import { CONNECTOR_ID, MISSION_ID, POLICY_B_ID } from "./domain/seed";
import type {
  AgentIdentity,
  AuthorityLease,
  ConnectorState,
  DecisionRecord,
  Entity,
  EntityPolicy,
  ExactActionApproval,
  GovernanceEvent,
  LeaseProposal,
  Mission,
  PendingActionRequest,
  Principal,
  ProtectedResource,
} from "./domain/types";
import { effectiveLease } from "./lease-status";
import { currentLease, pendingStepUp } from "./lifecycle";
import type { Store } from "./store";

export type GraphNodeKind = "agent" | "entity" | "mission" | "lease" | "resource";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel: string;
  status: string;
}

export type GraphEdgeKind =
  | "AFFILIATION"
  | "DECLARED"
  | "PROPOSED"
  | "ISSUER_APPROVED"
  | "RECEIVER_ACCEPTED"
  | "HOLDS"
  | "ACTIVE_AUTHORITY"
  | "OWNS"
  | "POLICY_DENIED";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  label: string;
  gated?: boolean;
}

export interface AuthorityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type DemoStep =
  | "NO_AUTHORITY"
  | "MISSION_DECLARED"
  | "PROPOSED"
  | "ISSUER_APPROVED"
  | "ACTIVE"
  | "STEP_UP_PENDING"
  | "STEP_UP_APPROVED"
  | "ISOLATED"
  | "REVOKED"
  | "EXPIRED";

export interface Snapshot {
  serverTime: string;
  synthetic: true;
  step: DemoStep;
  mission: Mission;
  lease: AuthorityLease | null;
  leases: AuthorityLease[];
  proposal: LeaseProposal | null;
  policyB: EntityPolicy;
  entities: Entity[];
  agents: AgentIdentity[];
  principals: Principal[];
  resources: ProtectedResource[];
  connector: ConnectorState;
  pending: PendingActionRequest | null;
  approvals: ExactActionApproval[];
  decisions: DecisionRecord[];
  events: GovernanceEvent[];
  graph: AuthorityGraph;
}

export function currentStep(store: Store): DemoStep {
  const mission = store.getMission(MISSION_ID);
  const lease = currentLease(store);
  const connector = store.getConnector(CONNECTOR_ID);
  if (lease) {
    if (lease.status === "REVOKED") return "REVOKED";
    if (lease.status === "EXPIRED") return "EXPIRED";
    if (lease.status === "PROPOSED") return "PROPOSED";
    if (lease.status === "ISSUER_APPROVED") return "ISSUER_APPROVED";
    if (connector?.isolated) return "ISOLATED";
    const pending = pendingStepUp(store);
    if (pending?.status === "APPROVED") return "STEP_UP_APPROVED";
    if (pending?.status === "PENDING") return "STEP_UP_PENDING";
    return "ACTIVE";
  }
  if (mission?.status === "DECLARED") return "MISSION_DECLARED";
  return "NO_AUTHORITY";
}

/**
 * Graph projection built only from the server state the resolver reads.
 * Nothing here is decorative: every edge corresponds to a check in the
 * resolver, and the cross-agency authority edges exist only while the lease
 * is ACTIVE.
 */
export function buildGraph(store: Store): AuthorityGraph {
  const now = store.now();
  const entities = store.listEntities();
  const agents = store.listAgents();
  const mission = store.getMission(MISSION_ID)!;
  const lease = currentLease(store);
  const resources = store.listResources();
  const policyB = store.getPolicy(POLICY_B_ID)!;
  const connector = store.getConnector(CONNECTOR_ID);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const a of agents) {
    nodes.push({ id: a.id, kind: "agent", label: a.name, sublabel: `principal ${a.principalId}`, status: a.active ? "ACTIVE" : "INACTIVE" });
    edges.push({ id: `aff-${a.id}`, from: a.id, to: a.homeEntityId, kind: "AFFILIATION", label: "affiliated" });
  }
  for (const e of entities) {
    const policy = store.getPolicy(e.policyId);
    nodes.push({ id: e.id, kind: "entity", label: e.name, sublabel: `${e.policyId} v${policy?.version ?? "?"}`, status: e.active ? "ACTIVE" : "INACTIVE" });
  }
  nodes.push({
    id: mission.id,
    kind: "mission",
    label: mission.incidentCode,
    sublabel: mission.status === "DECLARED" ? `declared · until ${mission.expiresAt}` : mission.status.toLowerCase(),
    status: mission.status,
  });
  if (mission.status === "DECLARED") {
    edges.push({ id: "declared", from: mission.declaringEntityId, to: mission.id, kind: "DECLARED", label: "declared" });
  }

  nodes.push({
    id: "lease",
    kind: "lease",
    label: lease ? lease.id : "no lease",
    sublabel: lease ? `v${lease.version} · ${lease.status}` : "no cross-agency authority",
    status: lease ? lease.status : "NONE",
  });

  for (const r of resources) {
    nodes.push({ id: r.id, kind: "resource", label: r.displayName, sublabel: `${r.resourceClass} · v${r.version}`, status: r.id === CONNECTOR_ID && connector?.isolated ? "ISOLATED" : r.active ? "ACTIVE" : "INACTIVE" });
    edges.push({ id: `owns-${r.id}`, from: r.ownerEntityId, to: r.id, kind: "OWNS", label: "owns" });
    if (policyB.deniedResourceClasses.includes(r.resourceClass)) {
      edges.push({ id: `denied-${r.id}`, from: "entity-b", to: r.id, kind: "POLICY_DENIED", label: `denied · ${policyB.id} v${policyB.version}` });
    }
  }

  if (lease && lease.status !== "REVOKED" && lease.status !== "EXPIRED") {
    edges.push({ id: "mission-lease", from: mission.id, to: "lease", kind: "PROPOSED", label: "under mission" });
    if (lease.status === "PROPOSED") {
      edges.push({ id: "holds", from: lease.agentId, to: "lease", kind: "PROPOSED", label: "proposed for" });
    } else {
      edges.push({ id: "holds", from: lease.agentId, to: "lease", kind: "HOLDS", label: "holds" });
    }
    if (lease.issuerApprovedBy) {
      edges.push({ id: "issuer", from: lease.issuerEntityId, to: "lease", kind: "ISSUER_APPROVED", label: `approved · ${lease.issuerApprovedBy}` });
    }
    if (lease.status === "ACTIVE" && lease.receiverAcceptedBy && new Date(lease.expiresAt) > now) {
      edges.push({ id: "receiver", from: lease.receiverEntityId, to: "lease", kind: "RECEIVER_ACCEPTED", label: `accepted · ${lease.receiverAcceptedBy}` });
      for (const s of lease.scopes) {
        const targets = s.resourceIds.length ? s.resourceIds : resources.filter((r) => r.resourceClass === s.resourceClass && r.ownerEntityId === lease.receiverEntityId).map((r) => r.id);
        const gated = policyB.humanGated.some((g) => g.action === s.action && g.resourceClass === s.resourceClass);
        for (const t of targets) {
          edges.push({ id: `auth-${s.action}-${t}`, from: "lease", to: t, kind: "ACTIVE_AUTHORITY", label: s.action, gated });
        }
      }
    }
  }

  return { nodes, edges };
}

export function snapshot(store: Store): Snapshot {
  const now = store.now();
  const mission = store.getMission(MISSION_ID)!;
  const leases = store.listLeases().map((l) => effectiveLease(l, now));
  const lease = leases.length ? leases[leases.length - 1] : null;
  const proposals = store.listProposals();
  const proposal = lease ? proposals.find((p) => p.leaseId === lease.id) ?? null : null;
  return {
    serverTime: now.toISOString(),
    synthetic: true,
    step: currentStep(store),
    mission,
    lease,
    leases,
    proposal,
    policyB: store.getPolicy(POLICY_B_ID)!,
    entities: store.listEntities(),
    agents: store.listAgents(),
    principals: store.listPrincipals(),
    resources: store.listResources(),
    connector: store.getConnector(CONNECTOR_ID)!,
    pending: pendingStepUp(store),
    approvals: store.listApprovals(),
    decisions: store.listDecisions(),
    events: store.listEvents(),
    graph: buildGraph(store),
  };
}
