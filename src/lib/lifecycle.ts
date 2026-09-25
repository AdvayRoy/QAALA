import { addMinutes } from "./clock";
import { APPROVAL_TTL_MINUTES, CONNECTOR_ID, MISSION_ID, MISSION_MINUTES, POLICY_B_ID } from "./domain/seed";
import type {
  AuthorityLease,
  ExactActionApproval,
  LeaseProposal,
  LeaseScope,
  PendingActionRequest,
  Principal,
} from "./domain/types";
import { effectiveLease } from "./lease-status";
import {
  buildProposal,
  policyExcerpt,
  ruleBasedCandidate,
  validateCandidate,
  type CandidateProposal,
  type ProposalGenerator,
} from "./proposal";
import type { Store } from "./store";

export interface LifecycleResult<T = unknown> {
  status: number;
  body: { ok: boolean; code: string; message: string; data?: T };
}

function fail(status: number, code: string, message: string): LifecycleResult<never> {
  return { status, body: { ok: false, code, message } };
}
function ok<T>(code: string, message: string, data: T): LifecycleResult<T> {
  return { status: 200, body: { ok: true, code, message, data } };
}

function requireRole(principal: Principal | null, role: Principal["role"], entityId?: string): LifecycleResult<never> | null {
  if (!principal || !principal.active) return fail(401, "PRINCIPAL_UNKNOWN", "No active demo principal.");
  if (principal.role !== role) return fail(403, "ROLE_NOT_PERMITTED", `${principal.name} (${principal.role}) may not perform this transition.`);
  if (entityId && principal.entityId !== entityId) {
    return fail(403, "ROLE_NOT_PERMITTED", `${principal.name} belongs to ${principal.entityId}; ${entityId} must act here.`);
  }
  return null;
}

export function currentLease(store: Store): AuthorityLease | null {
  const leases = store.listLeases();
  if (!leases.length) return null;
  return effectiveLease(leases[leases.length - 1], store.now());
}

function openLease(store: Store): AuthorityLease | null {
  const lease = currentLease(store);
  if (!lease) return null;
  return lease.status === "REVOKED" || lease.status === "EXPIRED" ? null : lease;
}

// ---- mission ---------------------------------------------------------------

export function declareMission(store: Store, principal: Principal | null): LifecycleResult {
  const mission = store.getMission(MISSION_ID);
  if (!mission) return fail(404, "MISSION_UNKNOWN", "Mission not found.");
  const denied = requireRole(principal, "ISSUER_COMMANDER", mission.declaringEntityId);
  if (denied) return denied;
  if (mission.status === "DECLARED") return ok("ALREADY_DECLARED", `${mission.incidentCode} is already declared.`, mission);
  if (mission.status === "CLOSED") return fail(409, "MISSION_CLOSED", "Mission is closed.");
  const now = store.now();
  const updated = store.transaction(() => {
    const next = store.putMission({
      ...mission,
      status: "DECLARED",
      declaredBy: principal!.id,
      declaredAt: now.toISOString(),
      expiresAt: addMinutes(now, MISSION_MINUTES).toISOString(),
      version: mission.version + 1,
    });
    store.appendEvent("MISSION_DECLARED", principal!.id, `${next.incidentCode} declared HIGH by ${principal!.name} (${principal!.entityId})`, null, null, null);
    return next;
  });
  return ok("MISSION_DECLARED", `${updated.incidentCode} declared.`, updated);
}

// ---- proposal --------------------------------------------------------------

export interface GenerateOptions {
  generator?: ProposalGenerator | null;
}

/**
 * Governance AI (or rule fallback) proposes a lease. The result is always a
 * PROPOSED lease containing only policy-compliant terms; the generator can
 * never activate, approve or exceed Entity B policy.
 */
export async function generateProposal(
  store: Store,
  principal: Principal | null,
  opts: GenerateOptions = {},
): Promise<LifecycleResult<{ proposal: LeaseProposal; lease: AuthorityLease }>> {
  const mission = store.getMission(MISSION_ID);
  if (!mission) return fail(404, "MISSION_UNKNOWN", "Mission not found.");
  const denied = requireRole(principal, "ISSUER_COMMANDER", mission.declaringEntityId);
  if (denied) return denied;
  if (mission.status !== "DECLARED") return fail(409, "MISSION_NOT_DECLARED", "Declare the incident before proposing authority.");
  const existing = openLease(store);
  if (existing) return fail(409, "LEASE_EXISTS", `Lease ${existing.id} is ${existing.status}; revoke it before proposing another.`);
  const policy = store.getPolicy(POLICY_B_ID);
  if (!policy || !policy.active) return fail(409, "POLICY_MISSING", "Entity B policy unavailable; refusing to propose.");

  let candidate: CandidateProposal | null = null;
  let source: LeaseProposal["source"] = "RULE_FALLBACK";
  let sourceDetail = "Deterministic rule-based proposal (no model provider configured)";
  if (opts.generator) {
    const raw = await opts.generator.generate({ mission, policyExcerpt: policyExcerpt(policy) });
    const validated = raw ? validateCandidate(raw, store.listResources()) : null;
    if (validated) {
      candidate = validated;
      source = "MODEL";
      sourceDetail = `Bounded model proposal via ${opts.generator.name}; validated against Entity B policy`;
    } else {
      sourceDetail = `Model provider ${opts.generator.name} unavailable or returned invalid output; deterministic rule-based fallback used`;
    }
  }
  if (!candidate) candidate = ruleBasedCandidate();

  const agent = store.listAgents().find((a) => a.homeEntityId === mission.declaringEntityId && a.active);
  if (!agent) return fail(409, "AGENT_MISSING", "No active agent for the declaring entity.");

  const leaseId = `lease-024-${store.listLeases().length + 1}`;
  const { proposal, scopes, grantedMinutes } = buildProposal(store, mission, policy, candidate, source, sourceDetail, leaseId);
  if (scopes.length === 0) return fail(409, "PROPOSAL_EMPTY", "No proposed term is compliant with Entity B policy.");

  const now = store.now();
  const result = store.transaction(() => {
    const lease: AuthorityLease = {
      id: leaseId,
      missionId: mission.id,
      agentId: agent.id,
      issuerEntityId: mission.declaringEntityId,
      receiverEntityId: policy.ownerEntityId,
      purpose: mission.purpose,
      scopes,
      validFrom: now.toISOString(),
      expiresAt: addMinutes(now, grantedMinutes).toISOString(),
      status: "PROPOSED",
      issuerApprovedBy: null,
      issuerApprovedAt: null,
      receiverAcceptedBy: null,
      receiverAcceptedAt: null,
      revokedBy: null,
      revokedAt: null,
      version: 1,
    };
    store.putLease(lease);
    store.putProposal(proposal);
    store.appendEvent(
      "PROPOSAL_CREATED",
      principal!.id,
      `${source === "MODEL" ? "Model" : "Rule-based"} proposal: ${scopes.map((s) => s.action).join(", ")} for ${grantedMinutes} min; ${proposal.exclusions.map((e) => e.resourceClass).join(", ")} excluded`,
      null,
      lease.id,
      lease.version,
    );
    return { proposal, lease };
  });
  return ok("PROPOSAL_CREATED", `Lease ${leaseId} proposed (${source}).`, result);
}

// ---- issuer approval -------------------------------------------------------

export function issuerApprove(store: Store, principal: Principal | null, leaseId?: string | null): LifecycleResult<AuthorityLease> {
  const lease = leaseId ? store.getLease(leaseId) : currentLease(store);
  if (!lease) return fail(404, "NO_LEASE", "No lease to approve.");
  const denied = requireRole(principal, "ISSUER_COMMANDER", lease.issuerEntityId);
  if (denied) return denied;
  const mission = store.getMission(lease.missionId);
  if (!mission || mission.status !== "DECLARED") return fail(409, "MISSION_NOT_DECLARED", "Mission must be declared.");
  const current = effectiveLease(lease, store.now());
  if (current.status !== "PROPOSED") return fail(409, "INVALID_TRANSITION", `Lease is ${current.status}; only PROPOSED leases can be issuer-approved.`);
  const next = store.transaction(() => {
    const updated = store.putLease({
      ...current,
      status: "ISSUER_APPROVED",
      issuerApprovedBy: principal!.id,
      issuerApprovedAt: store.nowIso(),
      version: current.version + 1,
    });
    store.appendEvent("LEASE_ISSUER_APPROVED", principal!.id, `${lease.issuerEntityId} commander approved lease ${updated.id} (v${updated.version}); awaiting ${lease.receiverEntityId}`, null, updated.id, updated.version);
    return updated;
  });
  return ok("LEASE_ISSUER_APPROVED", `Lease ${next.id} approved by issuer.`, next);
}

// ---- receiver acceptance ---------------------------------------------------

function applyPolicyCeiling(store: Store, lease: AuthorityLease): { scopes: LeaseScope[]; expiresAt: string; dropped: LeaseScope[] } | { error: string } {
  const receiver = store.getEntity(lease.receiverEntityId);
  const policy = receiver ? store.getPolicy(receiver.policyId) : null;
  const mission = store.getMission(lease.missionId);
  if (!policy || !policy.active || !mission) return { error: "Receiver policy or mission unavailable." };
  if (!policy.acceptedMissionSeverities.includes(mission.severity)) return { error: `Policy rejects severity ${mission.severity}.` };
  const fits = (list: LeaseScope[], s: LeaseScope) =>
    list.some(
      (p) =>
        p.action === s.action &&
        p.resourceClass === s.resourceClass &&
        (p.resourceIds.length === 0 || (s.resourceIds.length > 0 && s.resourceIds.every((id) => p.resourceIds.includes(id)))),
    );
  const kept: LeaseScope[] = [];
  const dropped: LeaseScope[] = [];
  for (const s of lease.scopes) {
    if (policy.deniedResourceClasses.includes(s.resourceClass)) dropped.push(s);
    else if (fits(policy.allowed, s) || fits(policy.humanGated, s)) kept.push(s);
    else dropped.push(s);
  }
  const now = store.now();
  const ceiling = addMinutes(now, policy.maximumLeaseMinutes).getTime();
  const proposed = new Date(lease.expiresAt).getTime();
  const missionEnd = mission.expiresAt ? new Date(mission.expiresAt).getTime() : ceiling;
  const expiresAt = new Date(Math.min(ceiling, proposed, missionEnd)).toISOString();
  return { scopes: kept, expiresAt, dropped };
}

export function receiverAccept(store: Store, principal: Principal | null, leaseId?: string | null): LifecycleResult<AuthorityLease> {
  const lease = leaseId ? store.getLease(leaseId) : currentLease(store);
  if (!lease) return fail(404, "NO_LEASE", "No lease to accept.");
  const denied = requireRole(principal, "RECEIVER_APPROVER", lease.receiverEntityId);
  if (denied) return denied;
  const current = effectiveLease(lease, store.now());
  if (current.status === "ACTIVE") return ok("ALREADY_ACTIVE", `Lease ${current.id} is already active.`, current);
  if (current.status !== "ISSUER_APPROVED") {
    return fail(409, "INVALID_TRANSITION", `Lease is ${current.status}; ${lease.receiverEntityId} accepts only after ${lease.issuerEntityId} issuer approval.`);
  }
  const ceiling = applyPolicyCeiling(store, current);
  if ("error" in ceiling) return fail(409, "POLICY_REJECTED", ceiling.error);
  if (ceiling.scopes.length === 0) return fail(409, "POLICY_REJECTED", "No proposed scope is compliant with receiver policy.");
  const next = store.transaction(() => {
    const now = store.nowIso();
    const updated = store.putLease({
      ...current,
      scopes: ceiling.scopes,
      validFrom: now,
      expiresAt: ceiling.expiresAt,
      status: "ACTIVE",
      receiverAcceptedBy: principal!.id,
      receiverAcceptedAt: now,
      version: current.version + 1,
    });
    store.appendEvent(
      "LEASE_ACCEPTED",
      principal!.id,
      `${lease.receiverEntityId} accepted lease ${updated.id} (v${updated.version}) under policy ceiling; ACTIVE until ${updated.expiresAt}${ceiling.dropped.length ? `; dropped ${ceiling.dropped.map((d) => d.action).join(", ")}` : ""}`,
      null,
      updated.id,
      updated.version,
    );
    return updated;
  });
  return ok("LEASE_ACCEPTED", `Lease ${next.id} is ACTIVE.`, next);
}

export function receiverReject(store: Store, principal: Principal | null, leaseId?: string | null): LifecycleResult<AuthorityLease> {
  const lease = leaseId ? store.getLease(leaseId) : currentLease(store);
  if (!lease) return fail(404, "NO_LEASE", "No lease to reject.");
  const denied = requireRole(principal, "RECEIVER_APPROVER", lease.receiverEntityId);
  if (denied) return denied;
  const current = effectiveLease(lease, store.now());
  if (current.status !== "ISSUER_APPROVED" && current.status !== "PROPOSED") {
    return fail(409, "INVALID_TRANSITION", `Lease is ${current.status}; only pending leases can be rejected.`);
  }
  const next = store.transaction(() => {
    const updated = store.putLease({ ...current, status: "REVOKED", revokedBy: principal!.id, revokedAt: store.nowIso(), version: current.version + 1 });
    store.appendEvent("LEASE_REJECTED", principal!.id, `${lease.receiverEntityId} rejected lease ${updated.id}`, null, updated.id, updated.version);
    return updated;
  });
  return ok("LEASE_REJECTED", `Lease ${next.id} rejected.`, next);
}

// ---- revocation ------------------------------------------------------------

export function revokeLease(store: Store, principal: Principal | null, leaseId?: string | null): LifecycleResult<AuthorityLease> {
  const lease = leaseId ? store.getLease(leaseId) : currentLease(store);
  if (!lease) return fail(404, "NO_LEASE", "No lease to revoke.");
  if (!principal || !principal.active) return fail(401, "PRINCIPAL_UNKNOWN", "No active demo principal.");
  const isReceiver = principal.role === "RECEIVER_APPROVER" && principal.entityId === lease.receiverEntityId;
  const isIssuer = principal.role === "ISSUER_COMMANDER" && principal.entityId === lease.issuerEntityId;
  if (!isReceiver && !isIssuer) {
    return fail(403, "ROLE_NOT_PERMITTED", `${principal.name} may not revoke lease ${lease.id}; only the ${lease.receiverEntityId} approver or the ${lease.issuerEntityId} commander may.`);
  }
  const current = effectiveLease(lease, store.now());
  if (current.status === "REVOKED") return ok("ALREADY_REVOKED", `Lease ${current.id} was already revoked by ${current.revokedBy}.`, current);
  const next = store.transaction(() => {
    const updated = store.putLease({
      ...current,
      status: "REVOKED",
      revokedBy: principal.id,
      revokedAt: store.nowIso(),
      version: current.version + 1,
    });
    for (const p of store.listPending()) {
      if (p.leaseId === updated.id && (p.status === "PENDING" || p.status === "APPROVED")) {
        store.putPending({ ...p, status: "SUPERSEDED" });
      }
    }
    store.appendEvent("LEASE_REVOKED", principal.id, `Lease ${updated.id} revoked by ${principal.name} (${principal.entityId}); v${updated.version}`, null, updated.id, updated.version);
    return updated;
  });
  return ok("LEASE_REVOKED", `Lease ${next.id} revoked.`, next);
}

// ---- exact step-up approval -----------------------------------------------

export function pendingStepUp(store: Store): PendingActionRequest | null {
  const list = store.listPending().filter((p) => p.status === "PENDING" || p.status === "APPROVED");
  return list.length ? list[list.length - 1] : null;
}

export function approveStepUp(
  store: Store,
  principal: Principal | null,
  pendingId: string | null | undefined,
): LifecycleResult<{ approval: ExactActionApproval; pending: PendingActionRequest; idempotent: boolean }> {
  if (!pendingId) return fail(400, "PENDING_REQUIRED", "pendingRequestId is required.");
  const pending = store.getPending(pendingId);
  if (!pending) return fail(404, "PENDING_UNKNOWN", "Pending request not found.");
  const lease = store.getLease(pending.leaseId);
  if (!lease) return fail(404, "NO_LEASE", "Lease not found.");
  const denied = requireRole(principal, "RECEIVER_APPROVER", lease.receiverEntityId);
  if (denied) return denied;
  const now = store.now();
  const current = effectiveLease(lease, now);

  if (pending.status === "APPROVED" && pending.approvalId) {
    const approval = store.getApproval(pending.approvalId);
    if (approval && approval.consumedAt === null && new Date(approval.expiresAt).getTime() > now.getTime()) {
      return ok("ALREADY_APPROVED", `Approval ${approval.id} already issued.`, { approval, pending, idempotent: true });
    }
  }
  if (pending.status !== "PENDING") return fail(409, "INVALID_TRANSITION", `Pending request is ${pending.status}.`);
  if (current.status !== "ACTIVE") return fail(409, "LEASE_NOT_ACTIVE", `Lease is ${current.status}; cannot approve a step-up for an inactive lease.`);
  if (current.version !== pending.leaseVersion) {
    return fail(409, "LEASE_VERSION_CHANGED", `Lease is now v${current.version}; request was for v${pending.leaseVersion}. Agent must re-request.`);
  }
  if (pending.resourceId !== CONNECTOR_ID || pending.action !== "ISOLATE_CONNECTOR") {
    return fail(409, "UNSUPPORTED_STEP_UP", "Only ISOLATE_CONNECTOR on connector-b-17 is human-gated.");
  }
  const agent = store.getAgentByPrincipal(pending.actorId);
  if (!agent || agent.id !== current.agentId) return fail(409, "AGENT_MISMATCH", "Pending request actor is not the lease agent.");

  const result = store.transaction(() => {
    const approval: ExactActionApproval = {
      id: store.newId("appr"),
      leaseId: current.id,
      leaseVersion: current.version,
      missionId: pending.missionId,
      agentId: agent.id,
      action: "ISOLATE_CONNECTOR",
      resourceId: CONNECTOR_ID,
      approvedBy: principal!.id,
      approvedAt: now.toISOString(),
      expiresAt: new Date(Math.min(addMinutes(now, APPROVAL_TTL_MINUTES).getTime(), new Date(current.expiresAt).getTime())).toISOString(),
      consumedAt: null,
    };
    store.putApproval(approval);
    const updated = store.putPending({ ...pending, status: "APPROVED", approvalId: approval.id });
    store.appendEvent(
      "STEP_UP_APPROVED",
      principal!.id,
      `${principal!.name} approved ISOLATE_CONNECTOR on ${CONNECTOR_ID} for lease ${current.id} v${current.version} (one-use, expires ${approval.expiresAt})`,
      null,
      current.id,
      current.version,
    );
    return { approval, pending: updated, idempotent: false };
  });
  return ok("STEP_UP_APPROVED", `Exact approval ${result.approval.id} issued.`, result);
}

// ---- reset -----------------------------------------------------------------

export function resetDemo(store: Store): LifecycleResult<{ resetAt: string }> {
  store.reset();
  return ok("RESET", "Demo state restored to initial conditions.", { resetAt: store.nowIso() });
}
