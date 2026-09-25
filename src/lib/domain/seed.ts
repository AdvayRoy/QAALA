import type {
  Action,
  AgentIdentity,
  ConnectorState,
  Entity,
  EntityPolicy,
  Mission,
  Principal,
  ProtectedResource,
} from "./types";

export const MISSION_ID = "mission-024";
export const INCIDENT_PURPOSE = "INCIDENT_024_CONTAINMENT";
export const AGENT_ID = "agent-47";
export const CONNECTOR_ID = "connector-b-17" as const;
export const TELEMETRY_ID = "telemetry-b";
export const CITIZEN_RECORDS_ID = "citizen-records-b";
export const POLICY_B_ID = "policy-b";
export const LEASE_ID = "lease-024-a-b";
export const PROPOSAL_MINUTES = 90;
export const MISSION_MINUTES = 240;
export const APPROVAL_TTL_MINUTES = 10;

export const PRINCIPAL_AGENT_47 = "principal-agent-47";
export const PRINCIPAL_COMMANDER_A = "principal-commander-a";
export const PRINCIPAL_APPROVER_B = "principal-approver-b";

/**
 * Action definitions are server-owned. Each protected endpoint is bound to
 * exactly one action and one protected resource; the client never chooses.
 */
export const ACTION_DEFINITIONS: Record<
  Action,
  { version: number; resourceId: string; mutating: boolean; label: string }
> = {
  READ_TELEMETRY: {
    version: 1,
    resourceId: TELEMETRY_ID,
    mutating: false,
    label: "Read security telemetry",
  },
  READ_CITIZEN_RECORDS: {
    version: 1,
    resourceId: CITIZEN_RECORDS_ID,
    mutating: false,
    label: "Read citizen records",
  },
  INSPECT_CONNECTOR: {
    version: 1,
    resourceId: CONNECTOR_ID,
    mutating: false,
    label: "Inspect connector B-17",
  },
  ISOLATE_CONNECTOR: {
    version: 1,
    resourceId: CONNECTOR_ID,
    mutating: true,
    label: "Isolate connector B-17",
  },
};

export const SEED_ENTITIES: Entity[] = [
  { id: "entity-a", name: "Entity A · Incident Response Authority", policyId: "policy-a", active: true },
  { id: "entity-b", name: "Entity B · Civic Infrastructure Registry", policyId: POLICY_B_ID, active: true },
  { id: "entity-c", name: "Entity C · Regional Transit Board", policyId: "policy-c", active: true },
];

export const SEED_PRINCIPALS: Principal[] = [
  { id: PRINCIPAL_AGENT_47, name: "Agent 47 (autonomous)", entityId: "entity-a", role: "AGENT", active: true },
  { id: PRINCIPAL_COMMANDER_A, name: "Cmdr. R. Okafor", entityId: "entity-a", role: "ISSUER_COMMANDER", active: true },
  { id: PRINCIPAL_APPROVER_B, name: "Approver M. Lindqvist", entityId: "entity-b", role: "RECEIVER_APPROVER", active: true },
];

export const SEED_AGENTS: AgentIdentity[] = [
  { id: AGENT_ID, name: "Agent 47", homeEntityId: "entity-a", principalId: PRINCIPAL_AGENT_47, active: true },
];

export const SEED_MISSION: Mission = {
  id: MISSION_ID,
  incidentCode: "INC-024",
  title: "Incident 024 · Lateral movement via connector B-17",
  severity: "HIGH",
  purpose: INCIDENT_PURPOSE,
  declaringEntityId: "entity-a",
  declaredBy: null,
  declaredAt: null,
  expiresAt: null,
  status: "DRAFT",
  version: 1,
};

export const SEED_POLICIES: EntityPolicy[] = [
  {
    id: "policy-a",
    ownerEntityId: "entity-a",
    version: 1,
    allowed: [],
    humanGated: [],
    deniedResourceClasses: [],
    maximumLeaseMinutes: 240,
    acceptedMissionSeverities: ["HIGH"],
    active: true,
  },
  {
    id: POLICY_B_ID,
    ownerEntityId: "entity-b",
    version: 1,
    allowed: [
      { action: "READ_TELEMETRY", resourceClass: "SECURITY_TELEMETRY", resourceIds: [] },
      { action: "INSPECT_CONNECTOR", resourceClass: "CONNECTOR", resourceIds: [CONNECTOR_ID] },
    ],
    humanGated: [{ action: "ISOLATE_CONNECTOR", resourceClass: "CONNECTOR", resourceIds: [CONNECTOR_ID] }],
    deniedResourceClasses: ["CITIZEN_PII"],
    maximumLeaseMinutes: 90,
    acceptedMissionSeverities: ["HIGH"],
    active: true,
  },
  {
    id: "policy-c",
    ownerEntityId: "entity-c",
    version: 1,
    allowed: [],
    humanGated: [],
    deniedResourceClasses: ["CITIZEN_PII"],
    maximumLeaseMinutes: 60,
    acceptedMissionSeverities: ["HIGH"],
    active: true,
  },
];

/** Human-readable clause references shown in proposals and receipts. */
export const POLICY_B_CLAUSES: Record<string, string> = {
  "B-1.1": "Security telemetry may be read class-wide by an accepted incident agent.",
  "B-2.3": "Connector B-17 may be inspected within an accepted lease.",
  "B-2.4": "Connector isolation requires an exact, one-use approval by an Entity B human.",
  "B-3.0": "Citizen PII is never delegable to any external agent.",
  "B-4.2": "No lease may exceed 90 minutes.",
  "B-5.1": "Only HIGH-severity declared missions are accepted.",
};

export const SEED_RESOURCES: ProtectedResource[] = [
  {
    id: TELEMETRY_ID,
    ownerEntityId: "entity-b",
    resourceClass: "SECURITY_TELEMETRY",
    displayName: "Security telemetry",
    active: true,
    version: 1,
  },
  {
    id: CITIZEN_RECORDS_ID,
    ownerEntityId: "entity-b",
    resourceClass: "CITIZEN_PII",
    displayName: "Citizen records",
    active: true,
    version: 1,
  },
  {
    id: CONNECTOR_ID,
    ownerEntityId: "entity-b",
    resourceClass: "CONNECTOR",
    displayName: "Connector B-17",
    active: true,
    version: 1,
  },
];

export const SEED_CONNECTOR: ConnectorState = {
  resourceId: CONNECTOR_ID,
  isolated: false,
  isolatedAt: null,
  isolatedByRequestId: null,
  version: 1,
};
