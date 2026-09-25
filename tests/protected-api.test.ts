import { beforeEach, describe, expect, it } from "vitest";
import { activateLease, createHarness, expectOk, type Harness } from "./harness";

let h: Harness;
beforeEach(() => {
  h = createHarness();
});

describe("Entity B protected APIs (direct route handler responses)", () => {
  it("no lease → telemetry 403 NO_ACTIVE_LEASE, with a receipt", async () => {
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    const res = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(res.status).toBe(403);
    expect(res.body.decision).toBe("DENY");
    expect(res.body.code).toBe("NO_ACTIVE_LEASE");
    expect(res.body.receiptId).toMatch(/^rcpt-/);
    expect(res.body.data).toBeUndefined();
    expect(h.store.getDecision(res.body.receiptId)?.leaseId).toBeNull();
  });

  it("before declaration → telemetry 403 MISSION_NOT_DECLARED", async () => {
    const res = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MISSION_NOT_DECLARED");
  });

  it("unknown session → 401 with receipt", async () => {
    const res = await h.api("GET", "/api/entity-b/security-telemetry", { token: "not-a-real-token" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PRINCIPAL_UNKNOWN");
    expect(res.body.receiptId).toMatch(/^rcpt-/);
  });

  it("issuer approval without Entity B acceptance → 403 RECEIVER_NOT_ACCEPTED", async () => {
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/issuer-approve", { as: "ISSUER_COMMANDER" }));
    const res = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RECEIVER_NOT_ACCEPTED");
  });

  it("proposed-only lease → 403 NO_ACTIVE_LEASE", async () => {
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
    const res = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NO_ACTIVE_LEASE");
  });

  it("active, Entity B-accepted lease → telemetry 200 ALLOW with payload", async () => {
    await activateLease(h);
    const res = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("ALLOW");
    expect(res.body.data.incidentCode).toBe("INC-024");
    expect(res.body.authorityPath.every((c: { passed: boolean }) => c.passed)).toBe(true);
  });

  it("citizen records remain 403 RESOURCE_CLASS_DENIED before and after activation, never returning data", async () => {
    const before = await h.api("GET", "/api/entity-b/citizen-records");
    expect(before.status).toBe(403);
    expect(before.body.code).toBe("RESOURCE_CLASS_DENIED");
    await activateLease(h);
    const after = await h.api("GET", "/api/entity-b/citizen-records");
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("RESOURCE_CLASS_DENIED");
    expect(after.body.data).toBeUndefined();
    expect(JSON.stringify(after.body)).not.toMatch(/citizen.*name|ssn|dob/i);
  });

  it("inspect connector requires an active lease, then returns server-owned connector state", async () => {
    const denied = await h.api("GET", "/api/entity-b/connectors/b-17");
    expect(denied.status).toBe(403);
    await activateLease(h);
    const res = await h.api("GET", "/api/entity-b/connectors/b-17");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ resourceId: "connector-b-17", isolated: false, version: 1 });
  });

  it("the 403 → 200 → 403 loop on the same telemetry endpoint as the lease changes", async () => {
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expect((await h.api("GET", "/api/entity-b/security-telemetry")).status).toBe(403);
    await activateLease_afterDeclare(h);
    expect((await h.api("GET", "/api/entity-b/security-telemetry")).status).toBe(200);
    expectOk(await h.api("POST", "/api/leases/revoke", { as: "RECEIVER_APPROVER" }));
    const revoked = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(revoked.status).toBe(403);
    expect(revoked.body.code).toBe("AUTHORITY_REVOKED");
  });
});

async function activateLease_afterDeclare(h: Harness) {
  expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
  expectOk(await h.api("POST", "/api/leases/issuer-approve", { as: "ISSUER_COMMANDER" }));
  expectOk(await h.api("POST", "/api/leases/receiver-accept", { as: "RECEIVER_APPROVER" }));
}

describe("Human step-up for connector isolation", () => {
  it("isolation returns 409 HUMAN_APPROVAL_REQUIRED before step-up and creates a pending request", async () => {
    await activateLease(h);
    const res = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(res.status).toBe(409);
    expect(res.body.decision).toBe("HUMAN_APPROVAL_REQUIRED");
    expect(res.body.code).toBe("HUMAN_APPROVAL_REQUIRED");
    expect(res.body.pendingRequestId).toMatch(/^pend-/);
    expect(h.store.getConnector("connector-b-17")?.isolated).toBe(false);
    const state = await h.api("GET", "/api/demo/state");
    expect(state.body.pending.id).toBe(res.body.pendingRequestId);
    expect(state.body.step).toBe("STEP_UP_PENDING");
  });

  it("only Entity B's approver can approve; Entity A commander is refused", async () => {
    await activateLease(h);
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    const asA = await h.api("POST", "/api/step-up/approve", { as: "ISSUER_COMMANDER", body: { pendingRequestId: req.body.pendingRequestId } });
    expect(asA.status).toBe(403);
    expect(asA.body.code).toBe("ROLE_NOT_PERMITTED");
    const asAgent = await h.api("POST", "/api/step-up/approve", { as: "AGENT", body: { pendingRequestId: req.body.pendingRequestId } });
    expect(asAgent.status).toBe(403);
  });

  it("exact approval → isolation succeeds, changes connector state exactly once, consumes approval", async () => {
    await activateLease(h);
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    const approved = expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    const approvalId = approved.body.data.approval.id;

    const first = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(first.status).toBe(200);
    expect(first.body.decision).toBe("ALLOW");
    expect(first.body.data).toMatchObject({ isolated: true, version: 2 });
    expect(h.store.getApproval(approvalId)?.consumedAt).not.toBeNull();
    expect(h.store.getDecision(first.body.receiptId)?.approvalId).toBe(approvalId);

    const second = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("HUMAN_APPROVAL_REQUIRED");
    const connector = h.store.getConnector("connector-b-17")!;
    expect(connector.version).toBe(2);
    expect(connector.isolatedByRequestId).toBe(h.store.getDecision(first.body.receiptId)?.requestId);
  });

  it("double-click approval is idempotent (same approval returned)", async () => {
    await activateLease(h);
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    const a = expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    const b = expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    expect(b.body.code).toBe("ALREADY_APPROVED");
    expect(b.body.data.approval.id).toBe(a.body.data.approval.id);
    expect(h.store.listApprovals()).toHaveLength(1);
  });

  it("a second isolation with a fresh approval does not change state again", async () => {
    await activateLease(h);
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    expect((await h.api("POST", "/api/entity-b/connectors/b-17/isolate")).status).toBe(200);
    const req2 = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(req2.status).toBe(409);
    expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req2.body.pendingRequestId } }));
    const again = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(again.status).toBe(200);
    expect(again.body.code).toBe("ALREADY_ISOLATED");
    expect(h.store.getConnector("connector-b-17")?.version).toBe(2);
  });

  it("approval for another lease version fails (lease revoked & re-proposed)", async () => {
    await activateLease(h);
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    // Lease changes version via revocation; the approval was bound to the previous version.
    expectOk(await h.api("POST", "/api/leases/revoke", { as: "RECEIVER_APPROVER" }));
    const denied = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("AUTHORITY_REVOKED");
    expect(h.store.getConnector("connector-b-17")?.isolated).toBe(false);
  });

  it("an approval forged for another resource/action/agent/version never matches", async () => {
    const lease = await activateLease(h);
    h.store.putApproval({
      id: "appr-forged-resource",
      leaseId: lease.id,
      leaseVersion: lease.version,
      missionId: lease.missionId,
      agentId: lease.agentId,
      action: "ISOLATE_CONNECTOR",
      resourceId: "connector-b-99" as "connector-b-17",
      approvedBy: "principal-approver-b",
      approvedAt: h.store.nowIso(),
      expiresAt: new Date(h.clock.now().getTime() + 600_000).toISOString(),
      consumedAt: null,
    });
    h.store.putApproval({
      id: "appr-forged-version",
      leaseId: lease.id,
      leaseVersion: lease.version - 1,
      missionId: lease.missionId,
      agentId: lease.agentId,
      action: "ISOLATE_CONNECTOR",
      resourceId: "connector-b-17",
      approvedBy: "principal-approver-b",
      approvedAt: h.store.nowIso(),
      expiresAt: new Date(h.clock.now().getTime() + 600_000).toISOString(),
      consumedAt: null,
    });
    h.store.putApproval({
      id: "appr-forged-agent",
      leaseId: lease.id,
      leaseVersion: lease.version,
      missionId: lease.missionId,
      agentId: "agent-99",
      action: "ISOLATE_CONNECTOR",
      resourceId: "connector-b-17",
      approvedBy: "principal-approver-b",
      approvedAt: h.store.nowIso(),
      expiresAt: new Date(h.clock.now().getTime() + 600_000).toISOString(),
      consumedAt: null,
    });
    const res = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("HUMAN_APPROVAL_REQUIRED");
    expect(h.store.getConnector("connector-b-17")?.isolated).toBe(false);
  });

  it("an expired approval no longer authorizes isolation", async () => {
    await activateLease(h);
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    h.clock.advanceMinutes(11);
    const res = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect(res.status).toBe(409);
    expect(h.store.getConnector("connector-b-17")?.isolated).toBe(false);
  });
});

describe("Expiry, revocation and stale clients", () => {
  it("expiry blocks access with 403 AUTHORITY_EXPIRED and the read view shows EXPIRED", async () => {
    await activateLease(h);
    expect((await h.api("GET", "/api/entity-b/security-telemetry")).status).toBe(200);
    h.clock.advanceMinutes(91);
    const res = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTHORITY_EXPIRED");
    const state = await h.api("GET", "/api/demo/state");
    expect(state.body.lease.status).toBe("EXPIRED");
    expect(state.body.step).toBe("EXPIRED");
  });

  it("Entity B acceptance caps the lease at the policy maximum (90 minutes)", async () => {
    const lease = await activateLease(h);
    const minutes = (new Date(lease.expiresAt).getTime() - h.clock.now().getTime()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(90);
  });

  it("revocation blocks access; same endpoint returns 403 AUTHORITY_REVOKED; receipts are kept", async () => {
    await activateLease(h);
    const ok = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(ok.status).toBe(200);
    const revoked = expectOk(await h.api("POST", "/api/leases/revoke", { as: "ISSUER_COMMANDER" }));
    expect(revoked.body.data.revokedBy).toBe("principal-commander-a");
    const res = await h.api("GET", "/api/entity-b/security-telemetry");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTHORITY_REVOKED");
    expect(h.store.getDecision(ok.body.receiptId)).not.toBeNull();
    // Graph: no active authority edge remains.
    const state = await h.api("GET", "/api/demo/state");
    expect(state.body.graph.edges.filter((e: { kind: string }) => e.kind === "ACTIVE_AUTHORITY")).toHaveLength(0);
  });

  it("a revoked lease cannot be reactivated by Entity B", async () => {
    await activateLease(h);
    expectOk(await h.api("POST", "/api/leases/revoke", { as: "RECEIVER_APPROVER" }));
    const res = await h.api("POST", "/api/leases/receiver-accept", { as: "RECEIVER_APPROVER" });
    expect(res.status).toBe(409);
    expect((await h.api("GET", "/api/entity-b/security-telemetry")).body.code).toBe("AUTHORITY_REVOKED");
  });

  it("a stale client lease snapshot cannot bypass revocation", async () => {
    const lease = await activateLease(h);
    expectOk(await h.api("POST", "/api/leases/revoke", { as: "RECEIVER_APPROVER" }));
    const res = await h.api("GET", `/api/entity-b/security-telemetry?leaseId=${lease.id}&leaseVersion=${lease.version}&status=ACTIVE`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTHORITY_REVOKED");
    const stale = await h.api("POST", "/api/entity-b/connectors/b-17/isolate", {
      body: { leaseId: lease.id, lease: { ...lease, status: "ACTIVE" }, approval: { id: "fake" }, actorId: "agent-47", resourceClass: "SECURITY_TELEMETRY" },
    });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("AUTHORITY_REVOKED");
  });

  it("client-supplied identity is ignored; only the server session counts", async () => {
    await activateLease(h);
    const res = await h.api("POST", "/api/entity-b/connectors/b-17/isolate", { as: "ISSUER_COMMANDER", body: { actorId: "agent-47" } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PRINCIPAL_NOT_AGENT");
  });
});

describe("Authority separation", () => {
  it("Entity A cannot accept on Entity B's behalf", async () => {
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/issuer-approve", { as: "ISSUER_COMMANDER" }));
    const res = await h.api("POST", "/api/leases/receiver-accept", { as: "ISSUER_COMMANDER" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ROLE_NOT_PERMITTED");
    expect((await h.api("GET", "/api/entity-b/security-telemetry")).status).toBe(403);
  });

  it("Entity B cannot accept before Entity A approves", async () => {
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
    const res = await h.api("POST", "/api/leases/receiver-accept", { as: "RECEIVER_APPROVER" });
    expect(res.status).toBe(409);
  });

  it("the agent cannot declare, propose, approve or accept", async () => {
    expect((await h.api("POST", "/api/mission/declare", { as: "AGENT" })).status).toBe(403);
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expect((await h.api("POST", "/api/leases/propose", { as: "AGENT" })).status).toBe(403);
    expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
    expect((await h.api("POST", "/api/leases/issuer-approve", { as: "AGENT" })).status).toBe(403);
    expect((await h.api("POST", "/api/leases/receiver-accept", { as: "AGENT" })).status).toBe(403);
  });

  it("Entity B may reject an issuer-approved lease; nothing activates", async () => {
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/issuer-approve", { as: "ISSUER_COMMANDER" }));
    expectOk(await h.api("POST", "/api/leases/receiver-reject", { as: "RECEIVER_APPROVER" }));
    expect((await h.api("GET", "/api/entity-b/security-telemetry")).body.code).toBe("AUTHORITY_REVOKED");
  });
});

describe("Reset and demo state", () => {
  it("reset restores initial state without restart and clears the event stream", async () => {
    await activateLease(h);
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    expect((await h.api("POST", "/api/entity-b/connectors/b-17/isolate")).status).toBe(200);
    const reset = await h.api("POST", "/api/demo/reset");
    expect(reset.status).toBe(200);
    const state = await h.api("GET", "/api/demo/state");
    expect(state.body.step).toBe("NO_AUTHORITY");
    expect(state.body.mission.status).toBe("DRAFT");
    expect(state.body.lease).toBeNull();
    expect(state.body.connector).toMatchObject({ isolated: false, version: 1 });
    expect(state.body.approvals).toHaveLength(0);
    expect(state.body.decisions).toHaveLength(0);
    expect(state.body.events.map((e: { kind: string }) => e.kind)).toEqual(["RESET"]);
    expect(state.body.policyB.version).toBe(1);
    // Sessions survive reset (identity mechanism), authority does not.
    expect((await h.api("GET", "/api/entity-b/security-telemetry")).body.code).toBe("MISSION_NOT_DECLARED");
  });

  it("the step endpoint tracks the presentation flow", async () => {
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("NO_AUTHORITY");
    expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("MISSION_DECLARED");
    expectOk(await h.api("POST", "/api/leases/propose", { as: "ISSUER_COMMANDER" }));
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("PROPOSED");
    expectOk(await h.api("POST", "/api/leases/issuer-approve", { as: "ISSUER_COMMANDER" }));
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("ISSUER_APPROVED");
    expectOk(await h.api("POST", "/api/leases/receiver-accept", { as: "RECEIVER_APPROVER" }));
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("ACTIVE");
    const req = await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("STEP_UP_PENDING");
    expectOk(await h.api("POST", "/api/step-up/approve", { as: "RECEIVER_APPROVER", body: { pendingRequestId: req.body.pendingRequestId } }));
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("STEP_UP_APPROVED");
    expectOk(await h.api("POST", "/api/entity-b/connectors/b-17/isolate"));
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("ISOLATED");
    expectOk(await h.api("POST", "/api/leases/revoke", { as: "RECEIVER_APPROVER" }));
    expect((await h.api("GET", "/api/demo/step")).body.step).toBe("REVOKED");
  });

  it("every authorization attempt leaves a decision receipt in the lineage", async () => {
    await h.api("GET", "/api/entity-b/security-telemetry");
    await h.api("GET", "/api/entity-b/citizen-records");
    await activateLease(h);
    await h.api("GET", "/api/entity-b/security-telemetry");
    await h.api("POST", "/api/entity-b/connectors/b-17/isolate");
    const state = await h.api("GET", "/api/demo/state");
    expect(state.body.decisions).toHaveLength(4);
    expect(state.body.decisions.map((d: { decision: string }) => d.decision)).toEqual(["DENY", "DENY", "ALLOW", "HUMAN_APPROVAL_REQUIRED"]);
    for (const d of state.body.decisions) {
      expect(d.policyId).toBe("policy-b");
      expect(d.policyVersion).toBe(1);
      expect(d.actionDefinitionVersion).toBe(1);
      expect(d.resourceVersion).toBe(1);
    }
  });
});
