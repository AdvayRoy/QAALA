import { ACTION_DEFINITIONS, INCIDENT_PURPOSE, MISSION_ID } from "./domain/seed";
import type {
  Action,
  AuthorityCheck,
  AuthorityLease,
  Decision,
  DecisionRecord,
  EntityPolicy,
  ExactActionApproval,
  LeaseScope,
  Principal,
  ProtectedResource,
  ResolverResponse,
} from "./domain/types";
import { effectiveLease, missionIsValid } from "./lease-status";
import type { Store } from "./store";

/**
 * What a protected endpoint hands to the resolver. Everything except the
 * opaque IDs is server-owned: the principal comes from the demo session, the
 * action is bound to the endpoint, and the resource is looked up in the
 * server registry.
 */
export interface AuthorizationInput {
  principal: Principal | null;
  action: Action;
  /** Optional lease ID chosen by the client. Only the ID is trusted. */
  leaseId?: string | null;
  /** Optional mission ID chosen by the client. Only the ID is trusted. */
  missionId?: string | null;
}

export interface Resolution {
  decision: Decision;
  code: string;
  reason: string;
  httpStatus: number;
  authorityPath: AuthorityCheck[];
  actorId: string;
  missionId: string;
  lease: AuthorityLease | null;
  policy: EntityPolicy | null;
  resource: ProtectedResource | null;
  approval: ExactActionApproval | null;
  agentId: string | null;
}

export interface AuthorizationResult {
  status: number;
  body: ResolverResponse;
  receipt: DecisionRecord;
  resolution: Resolution;
}

function scopeCovers(scope: LeaseScope, action: Action, resource: ProtectedResource): boolean {
  if (scope.action !== action) return false;
  if (scope.resourceClass !== resource.resourceClass) return false;
  if (scope.resourceIds.length === 0) return true;
  return scope.resourceIds.includes(resource.id);
}

/**
 * Pure evaluation of the authority chain against current server state and
 * server time. Writes nothing; `authorize` persists the receipt.
 */
export function evaluate(store: Store, input: AuthorizationInput): Resolution {
  const now = store.now();
  const path: AuthorityCheck[] = [];
  const def = ACTION_DEFINITIONS[input.action];

  const base = {
    actorId: input.principal?.id ?? "unknown",
    missionId: input.missionId ?? MISSION_ID,
    lease: null as AuthorityLease | null,
    policy: null as EntityPolicy | null,
    resource: null as ProtectedResource | null,
    approval: null as ExactActionApproval | null,
    agentId: null as string | null,
  };

  const deny = (
    code: string,
    reason: string,
    check: string,
    httpStatus = 403,
    decision: Decision = "DENY",
  ): Resolution => {
    path.push({ check, passed: false });
    return { decision, code, reason, httpStatus, authorityPath: path, ...base };
  };
  const pass = (check: string) => path.push({ check, passed: true });

  // 1. Authenticated demo principal, must be an active agent identity.
  const principal = input.principal;
  if (!principal || !principal.active) {
    return deny("PRINCIPAL_UNKNOWN", "No active demo principal for this request.", "Principal resolved from server-side demo session", 401);
  }
  const agent = store.getAgentByPrincipal(principal.id);
  if (!agent || !agent.active || principal.role !== "AGENT") {
    return deny("PRINCIPAL_NOT_AGENT", `${principal.name} is not an active agent identity.`, "Principal resolved from server-side demo session");
  }
  base.agentId = agent.id;
  pass(`Principal ${agent.name} (${agent.homeEntityId}) authenticated`);

  // 2. Endpoint-bound action and server-registered resource.
  const resource = store.getResource(def.resourceId);
  if (!resource || !resource.active) {
    return deny("RESOURCE_UNAVAILABLE", "Protected resource is missing or inactive.", `Resource ${def.resourceId} resolved from registry`);
  }
  base.resource = resource;
  const owner = store.getEntity(resource.ownerEntityId);
  const policy = owner ? store.getPolicy(owner.policyId) : null;
  base.policy = policy;
  pass(`${def.label} bound to ${resource.id} [${resource.resourceClass}] owned by ${resource.ownerEntityId}`);

  // Owner deny rules override everything, including any lease.
  if (!owner || !owner.active || !policy || !policy.active) {
    return deny("POLICY_MISSING", "Resource owner has no active policy; failing closed.", "Owner policy loaded");
  }
  if (policy.deniedResourceClasses.includes(resource.resourceClass)) {
    return deny(
      "RESOURCE_CLASS_DENIED",
      `${resource.ownerEntityId} policy v${policy.version} forbids delegation of ${resource.resourceClass}.`,
      `Resource class ${resource.resourceClass} not denied by ${resource.ownerEntityId} policy`,
    );
  }
  pass(`Resource class ${resource.resourceClass} not denied by ${resource.ownerEntityId} policy v${policy.version}`);

  // 3. Mission must be DECLARED, purpose-matched and within validity.
  const mission = store.getMission(base.missionId);
  if (!mission) {
    return deny("MISSION_UNKNOWN", "Mission not found.", "Mission resolved");
  }
  if (mission.status !== "DECLARED") {
    return deny("MISSION_NOT_DECLARED", `Mission ${mission.incidentCode} is ${mission.status}; no authority can exist before declaration.`, `Mission ${mission.incidentCode} DECLARED and valid`);
  }
  if (mission.purpose !== INCIDENT_PURPOSE) {
    return deny("MISSION_PURPOSE_MISMATCH", "Mission purpose does not match the incident purpose.", `Mission ${mission.incidentCode} DECLARED and valid`);
  }
  if (!missionIsValid(mission, now)) {
    return deny("MISSION_EXPIRED", `Mission ${mission.incidentCode} validity window has ended.`, `Mission ${mission.incidentCode} DECLARED and valid`);
  }
  pass(`Mission ${mission.incidentCode} DECLARED, purpose ${mission.purpose}, valid until ${mission.expiresAt}`);

  // 4. Lease by ID (or the server's own record for this agent + mission).
  let stored: AuthorityLease | null = null;
  if (input.leaseId) {
    stored = store.getLease(input.leaseId);
  } else {
    const candidates = store
      .listLeases()
      .filter((l) => l.agentId === agent.id && l.missionId === mission.id && l.receiverEntityId === resource.ownerEntityId);
    stored = candidates.length ? candidates[candidates.length - 1] : null;
  }
  if (!stored) {
    return deny("NO_ACTIVE_LEASE", `No authority lease exists for ${agent.name} on ${resource.ownerEntityId}.`, "Authority lease exists for agent, mission and receiving agency");
  }
  const lease = effectiveLease(stored, now);
  base.lease = lease;
  if (
    lease.agentId !== agent.id ||
    lease.missionId !== mission.id ||
    lease.issuerEntityId !== agent.homeEntityId ||
    lease.receiverEntityId !== resource.ownerEntityId ||
    lease.purpose !== mission.purpose
  ) {
    return deny("LEASE_BINDING_MISMATCH", "Lease does not bind this agent, mission, issuer, receiving agency and purpose.", `Lease ${lease.id} v${lease.version} binds agent, mission, issuer, receiver and purpose`);
  }
  pass(`Lease ${lease.id} v${lease.version} binds ${agent.id} → ${lease.receiverEntityId} for ${mission.incidentCode}`);

  // 5. Lease status from server state and server time.
  if (lease.status === "REVOKED") {
    return deny("AUTHORITY_REVOKED", `Lease ${lease.id} was revoked by ${lease.revokedBy} at ${lease.revokedAt}.`, "Lease ACTIVE (not revoked, not expired)");
  }
  if (lease.status === "EXPIRED") {
    return deny("AUTHORITY_EXPIRED", `Lease ${lease.id} expired at ${lease.expiresAt}.`, "Lease ACTIVE (not revoked, not expired)");
  }
  if (lease.status === "ISSUER_APPROVED") {
    return deny("RECEIVER_NOT_ACCEPTED", `${lease.receiverEntityId} has not accepted lease ${lease.id}; issuer approval alone grants nothing.`, "Lease ACTIVE (not revoked, not expired)");
  }
  if (lease.status !== "ACTIVE") {
    return deny("NO_ACTIVE_LEASE", `Lease ${lease.id} is ${lease.status}, not ACTIVE.`, "Lease ACTIVE (not revoked, not expired)");
  }
  if (new Date(lease.validFrom).getTime() > now.getTime()) {
    return deny("NO_ACTIVE_LEASE", `Lease ${lease.id} is not yet valid.`, "Lease ACTIVE (not revoked, not expired)");
  }
  pass(`Lease ACTIVE until ${lease.expiresAt}`);

  // 6. Dual approval: issuer approval AND receiver acceptance.
  if (!lease.issuerApprovedBy || !lease.issuerApprovedAt) {
    return deny("ISSUER_NOT_APPROVED", "Issuing agency has not approved the lease.", `${lease.issuerEntityId} issuer approval and ${lease.receiverEntityId} acceptance both recorded`);
  }
  if (!lease.receiverAcceptedBy || !lease.receiverAcceptedAt) {
    return deny("RECEIVER_NOT_ACCEPTED", "Receiving agency has not accepted the lease.", `${lease.issuerEntityId} issuer approval and ${lease.receiverEntityId} acceptance both recorded`);
  }
  pass(`Approved by ${lease.issuerApprovedBy} (${lease.issuerEntityId}) · accepted by ${lease.receiverAcceptedBy} (${lease.receiverEntityId})`);

  // 7. Receiver policy ceiling (re-applied; deny already checked above).
  if (!policy.acceptedMissionSeverities.includes(mission.severity)) {
    return deny("POLICY_SEVERITY_REJECTED", "Receiver policy does not accept this mission severity.", `${resource.ownerEntityId} policy v${policy.version} accepts mission severity`);
  }
  pass(`${resource.ownerEntityId} policy v${policy.version} accepts ${mission.severity} missions; ${resource.resourceClass} permitted class`);

  // 8. Action/resource must fit lease scope AND receiver policy.
  const inLease = lease.scopes.some((s) => scopeCovers(s, input.action, resource));
  if (!inLease) {
    return deny("SCOPE_NOT_GRANTED", `Lease ${lease.id} v${lease.version} does not grant ${input.action} on ${resource.id}.`, `Lease scope covers ${input.action} on ${resource.id}`);
  }
  pass(`Lease scope covers ${input.action} on ${resource.id}`);
  const policyAllowed = policy.allowed.some((s) => scopeCovers(s, input.action, resource));
  const policyGated = policy.humanGated.some((s) => scopeCovers(s, input.action, resource));
  if (!policyAllowed && !policyGated) {
    return deny("POLICY_SCOPE_DENIED", `${resource.ownerEntityId} policy v${policy.version} does not permit ${input.action} on ${resource.id}.`, `${resource.ownerEntityId} policy permits ${input.action} on ${resource.id}`);
  }
  pass(`${resource.ownerEntityId} policy permits ${input.action} on ${resource.id}${policyGated ? " (human-gated)" : ""}`);

  // 9. Human gate requires an exact, unexpired, unused approval.
  if (policyGated) {
    const approval = store.listApprovals().find(
      (a) =>
        a.leaseId === lease.id &&
        a.leaseVersion === lease.version &&
        a.missionId === mission.id &&
        a.agentId === agent.id &&
        a.action === input.action &&
        a.resourceId === resource.id &&
        a.consumedAt === null &&
        new Date(a.expiresAt).getTime() > now.getTime(),
    );
    if (!approval) {
      return deny(
        "HUMAN_APPROVAL_REQUIRED",
        `${input.action} on ${resource.id} requires an exact, one-use approval from an ${resource.ownerEntityId} human for lease v${lease.version}.`,
        `Exact unexpired approval for lease v${lease.version}, ${input.action}, ${resource.id}`,
        409,
        "HUMAN_APPROVAL_REQUIRED",
      );
    }
    base.approval = approval;
    pass(`Exact approval ${approval.id} by ${approval.approvedBy} matches lease v${lease.version}, ${input.action}, ${resource.id}`);
  } else {
    pass("No human gate for this action");
  }

  return {
    decision: "ALLOW",
    code: "ALLOW",
    reason: `${input.action} on ${resource.id} permitted under lease ${lease.id} v${lease.version}.`,
    httpStatus: 200,
    authorityPath: path,
    ...base,
  };
}

/**
 * The single authority resolver every protected Entity B endpoint calls.
 *
 * Evaluates the chain, optionally performs the mutating side effect after a
 * recheck inside the same serialized transaction, and always writes a decision
 * receipt — for ALLOW, DENY and HUMAN_APPROVAL_REQUIRED alike.
 */
export function authorize(
  store: Store,
  input: AuthorizationInput,
  sideEffect?: (resolution: Resolution, requestId: string) => { code?: string; reason?: string } | void,
): AuthorizationResult {
  return store.transaction(() => {
    const requestId = store.newId("req");
    let resolution = evaluate(store, input);

    if (resolution.decision === "ALLOW" && sideEffect) {
      // Recheck immediately before the side effect using current state.
      const recheck = evaluate(store, input);
      if (recheck.decision !== "ALLOW") {
        recheck.authorityPath.push({ check: "Pre-mutation recheck of lease, policy and approval", passed: false });
        resolution = recheck;
      } else {
        recheck.authorityPath.push({ check: "Pre-mutation recheck of lease, policy and approval", passed: true });
        resolution = recheck;
        if (resolution.approval) {
          store.putApproval({ ...resolution.approval, consumedAt: store.nowIso() });
        }
        const outcome = sideEffect(resolution, requestId);
        if (outcome?.code) resolution.code = outcome.code;
        if (outcome?.reason) resolution.reason = outcome.reason;
      }
    }

    if (resolution.lease && resolution.lease.status === "EXPIRED") {
      const stored = store.getLease(resolution.lease.id);
      if (stored && stored.status !== "EXPIRED" && stored.status !== "REVOKED") {
        store.putLease({ ...stored, status: "EXPIRED" });
      }
    }

    const def = ACTION_DEFINITIONS[input.action];
    const receipt: DecisionRecord = {
      id: store.newId("rcpt"),
      requestId,
      actorId: resolution.actorId,
      missionId: resolution.missionId,
      leaseId: resolution.lease?.id ?? null,
      leaseVersion: resolution.lease?.version ?? null,
      policyId: resolution.policy?.id ?? "none",
      policyVersion: resolution.policy?.version ?? 0,
      resourceId: resolution.resource?.id ?? def.resourceId,
      resourceVersion: resolution.resource?.version ?? 0,
      action: input.action,
      actionDefinitionVersion: def.version,
      decision: resolution.decision,
      code: resolution.code,
      reason: resolution.reason,
      approvalId: resolution.approval?.id ?? null,
      decidedAt: store.nowIso(),
      httpStatus: resolution.httpStatus,
      authorityPath: resolution.authorityPath,
    };
    store.putDecision(receipt);
    store.appendEvent(
      "DECISION",
      resolution.actorId,
      `${input.action} → ${resolution.httpStatus} ${resolution.code}`,
      receipt.id,
      receipt.leaseId,
      receipt.leaseVersion,
    );

    return {
      status: resolution.httpStatus,
      body: {
        decision: resolution.decision,
        code: resolution.code,
        reason: resolution.reason,
        receiptId: receipt.id,
        authorityPath: resolution.authorityPath,
      },
      receipt,
      resolution,
    };
  });
}
