export type EntityId = "entity-a" | "entity-b" | "entity-c";

export type Action =
  | "READ_TELEMETRY"
  | "READ_CITIZEN_RECORDS"
  | "INSPECT_CONNECTOR"
  | "ISOLATE_CONNECTOR";

export type ResourceClass = "SECURITY_TELEMETRY" | "CITIZEN_PII" | "CONNECTOR";

export type LeaseStatus =
  | "PROPOSED"
  | "ISSUER_APPROVED"
  | "ACTIVE"
  | "REVOKED"
  | "EXPIRED";

export type Decision = "ALLOW" | "DENY" | "HUMAN_APPROVAL_REQUIRED";

export interface Entity {
  id: EntityId;
  name: string;
  policyId: string;
  active: boolean;
}

export interface AgentIdentity {
  id: string;
  name: string;
  homeEntityId: EntityId;
  principalId: string;
  active: boolean;
}

export interface Mission {
  id: string;
  incidentCode: string;
  title: string;
  severity: "HIGH";
  purpose: string;
  declaringEntityId: EntityId;
  declaredBy: string | null;
  declaredAt: string | null;
  expiresAt: string | null;
  status: "DRAFT" | "DECLARED" | "CLOSED";
  version: number;
}

export interface LeaseScope {
  action: Action;
  resourceClass: ResourceClass;
  resourceIds: string[]; // empty means class-wide only where Entity B policy allows
}

export interface AuthorityLease {
  id: string;
  missionId: string;
  agentId: string;
  issuerEntityId: EntityId;
  receiverEntityId: EntityId;
  purpose: string;
  scopes: LeaseScope[];
  validFrom: string;
  expiresAt: string;
  status: LeaseStatus;
  issuerApprovedBy: string | null;
  issuerApprovedAt: string | null;
  receiverAcceptedBy: string | null;
  receiverAcceptedAt: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  version: number;
}

export interface EntityPolicy {
  id: string;
  ownerEntityId: EntityId;
  version: number;
  allowed: LeaseScope[];
  humanGated: LeaseScope[];
  deniedResourceClasses: ResourceClass[];
  maximumLeaseMinutes: number;
  acceptedMissionSeverities: Array<"HIGH">;
  active: boolean;
}

export interface ProtectedResource {
  id: string;
  ownerEntityId: EntityId;
  resourceClass: ResourceClass;
  displayName: string;
  active: boolean;
  version: number;
}

export interface ActionRequest {
  id: string;
  actorId: string; // resolved from server-side demo session
  missionId: string;
  leaseId: string;
  action: Action; // bound to endpoint, not trusted from body
  resourceId: string; // resolved against server resource registry
  requestedAt: string; // server time
}

export interface ExactActionApproval {
  id: string;
  leaseId: string;
  leaseVersion: number;
  missionId: string;
  agentId: string;
  action: "ISOLATE_CONNECTOR";
  resourceId: "connector-b-17";
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface DecisionRecord {
  id: string;
  requestId: string;
  actorId: string;
  missionId: string;
  leaseId: string | null;
  leaseVersion: number | null;
  policyId: string;
  policyVersion: number;
  resourceId: string;
  resourceVersion: number;
  action: Action;
  actionDefinitionVersion: number;
  decision: Decision;
  code: string;
  reason: string;
  approvalId: string | null;
  decidedAt: string;
  httpStatus: number;
  authorityPath: AuthorityCheck[];
}

export interface ConnectorState {
  resourceId: "connector-b-17";
  isolated: boolean;
  isolatedAt: string | null;
  isolatedByRequestId: string | null;
  version: number;
}

/** Human principals in the synthetic demo (not real authentication). */
export type DemoRole = "AGENT" | "ISSUER_COMMANDER" | "RECEIVER_APPROVER";

export interface Principal {
  id: string;
  name: string;
  entityId: EntityId;
  role: DemoRole;
  active: boolean;
}

export interface DemoSession {
  token: string;
  principalId: string;
  issuedAt: string;
}

/** Pending step-up request for a human-gated action. */
export interface PendingActionRequest {
  id: string;
  requestId: string;
  actorId: string;
  missionId: string;
  leaseId: string;
  leaseVersion: number;
  action: Action;
  resourceId: string;
  receiptId: string;
  requestedAt: string;
  leaseExpiresAt: string;
  status: "PENDING" | "APPROVED" | "CONSUMED" | "SUPERSEDED";
  approvalId: string | null;
}

export type ProposalSource = "MODEL" | "RULE_FALLBACK";

export interface ProposalTerm {
  scope: LeaseScope;
  gate: "ALLOWED" | "HUMAN_GATED";
  policyClause: string;
  accepted: boolean;
  rejectionReason: string | null;
}

export interface ProposalExclusion {
  resourceClass: ResourceClass;
  policyClause: string;
}

export interface LeaseProposal {
  id: string;
  missionId: string;
  leaseId: string;
  source: ProposalSource;
  sourceDetail: string;
  terms: ProposalTerm[];
  exclusions: ProposalExclusion[];
  requestedMinutes: number;
  grantedMinutes: number;
  createdAt: string;
}

export type GovernanceEventKind =
  | "RESET"
  | "MISSION_DECLARED"
  | "PROPOSAL_CREATED"
  | "LEASE_ISSUER_APPROVED"
  | "LEASE_ACCEPTED"
  | "LEASE_REJECTED"
  | "LEASE_REVOKED"
  | "STEP_UP_REQUESTED"
  | "STEP_UP_APPROVED"
  | "CONNECTOR_ISOLATED"
  | "DECISION";

export interface GovernanceEvent {
  id: string;
  seq: number;
  kind: GovernanceEventKind;
  at: string;
  actorId: string | null;
  summary: string;
  receiptId: string | null;
  leaseId: string | null;
  leaseVersion: number | null;
}

export interface AuthorityCheck {
  check: string;
  passed: boolean;
}

export interface ResolverResponse {
  decision: Decision;
  code: string;
  reason: string;
  receiptId: string;
  authorityPath: AuthorityCheck[];
}
