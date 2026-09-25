import { beforeEach, describe, expect, it } from "vitest";
import { generateProposal, issuerApprove, receiverAccept } from "@/lib/lifecycle";
import { readTelemetry } from "@/lib/protected";
import type { ProposalGenerator } from "@/lib/proposal";
import { createHarness, expectOk, type Harness } from "./harness";

let h: Harness;
beforeEach(async () => {
  h = createHarness();
  expectOk(await h.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
});

const commander = () => h.store.getPrincipal("principal-commander-a");
const approver = () => h.store.getPrincipal("principal-approver-b");
const agent = () => h.store.getPrincipal("principal-agent-47");

function generator(output: unknown, name = "test-model"): ProposalGenerator {
  return { name, generate: async () => output as never };
}

describe("Governance AI proposal boundaries", () => {
  it("a model proposal that exceeds Entity B policy is shown as rejected terms and never carried into the lease", async () => {
    const res = await generateProposal(h.store, commander(), {
      generator: generator({
        scopes: [
          { action: "READ_TELEMETRY", resourceClass: "SECURITY_TELEMETRY", resourceIds: [], policyClause: "B-1.1" },
          { action: "READ_CITIZEN_RECORDS", resourceClass: "CITIZEN_PII", resourceIds: ["citizen-records-b"], policyClause: "made-up" },
          { action: "ISOLATE_CONNECTOR", resourceClass: "CONNECTOR", resourceIds: ["connector-b-17"], policyClause: "B-2.4" },
        ],
        exclusions: [],
        expiryMinutes: 600,
        rationale: "grab everything",
      }),
    });
    expect(res.status).toBe(200);
    const { proposal, lease } = res.body.data!;
    expect(proposal.source).toBe("MODEL");
    expect(proposal.terms.find((t) => t.scope.action === "READ_CITIZEN_RECORDS")?.accepted).toBe(false);
    expect(proposal.exclusions.map((e) => e.resourceClass)).toContain("CITIZEN_PII");
    expect(lease.scopes.map((s) => s.action)).toEqual(["READ_TELEMETRY", "ISOLATE_CONNECTOR"]);
    expect(lease.status).toBe("PROPOSED");
    expect(proposal.grantedMinutes).toBe(90);
    expect(new Date(lease.expiresAt).getTime() - h.clock.now().getTime()).toBe(90 * 60_000);
  });

  it("the model cannot activate: a PROPOSED lease grants nothing until A approves and B accepts", async () => {
    const res = await generateProposal(h.store, commander(), { generator: generator({ ...validCandidate(), status: "ACTIVE", receiverAcceptedBy: "principal-approver-b" }) });
    expect(res.status).toBe(200);
    expect(res.body.data!.lease.status).toBe("PROPOSED");
    expect(res.body.data!.lease.receiverAcceptedBy).toBeNull();
    expect(readTelemetry(h.store, { principal: agent() }).status).toBe(403);
    expectOk(issuerApprove(h.store, commander()));
    expect(readTelemetry(h.store, { principal: agent() }).status).toBe(403);
    expectOk(receiverAccept(h.store, approver()));
    expect(readTelemetry(h.store, { principal: agent() }).status).toBe(200);
  });

  it("unknown actions, resources or classes invalidate the model output → labeled rule fallback", async () => {
    for (const bad of [
      { ...validCandidate(), scopes: [{ action: "DELETE_EVERYTHING", resourceClass: "CONNECTOR", resourceIds: [], policyClause: "" }] },
      { ...validCandidate(), scopes: [{ action: "READ_TELEMETRY", resourceClass: "SECURITY_TELEMETRY", resourceIds: ["telemetry-c"], policyClause: "" }] },
      { ...validCandidate(), scopes: [{ action: "READ_TELEMETRY", resourceClass: "CITIZEN_PII", resourceIds: [], policyClause: "" }] },
      "not json at all",
      null,
    ]) {
      const fresh = createHarness();
      expectOk(await fresh.api("POST", "/api/mission/declare", { as: "ISSUER_COMMANDER" }));
      const res = await generateProposal(fresh.store, fresh.store.getPrincipal("principal-commander-a"), { generator: generator(bad) });
      expect(res.status).toBe(200);
      expect(res.body.data!.proposal.source).toBe("RULE_FALLBACK");
      expect(res.body.data!.proposal.sourceDetail).toMatch(/fallback/i);
    }
  });

  it("model outage (throwing/timeout → null) does not make authorization more permissive", async () => {
    const outage: ProposalGenerator = { name: "down-model", generate: async () => null };
    const res = await generateProposal(h.store, commander(), { generator: outage });
    expect(res.status).toBe(200);
    expect(res.body.data!.proposal.source).toBe("RULE_FALLBACK");
    const lease = res.body.data!.lease;
    expect(lease.status).toBe("PROPOSED");
    expect(lease.scopes.some((s) => s.resourceClass === "CITIZEN_PII")).toBe(false);
    expect(readTelemetry(h.store, { principal: agent() }).status).toBe(403);
    expectOk(issuerApprove(h.store, commander()));
    expectOk(receiverAccept(h.store, approver()));
    expect(readTelemetry(h.store, { principal: agent() }).status).toBe(200);
    expect(h.store.getLease(lease.id)!.scopes).toEqual(lease.scopes);
  });

  it("Entity B acceptance re-applies its ceiling even if the stored lease over-reaches", async () => {
    const res = await generateProposal(h.store, commander(), { generator: null });
    const lease = res.body.data!.lease;
    // Simulate a corrupted / over-broad lease record reaching acceptance.
    h.store.putLease({
      ...lease,
      scopes: [...lease.scopes, { action: "READ_CITIZEN_RECORDS", resourceClass: "CITIZEN_PII", resourceIds: [] }],
      expiresAt: new Date(h.clock.now().getTime() + 10 * 60 * 60_000).toISOString(),
    });
    expectOk(issuerApprove(h.store, commander()));
    const accepted = receiverAccept(h.store, approver());
    expect(accepted.status).toBe(200);
    expect(accepted.body.data!.scopes.some((s) => s.resourceClass === "CITIZEN_PII")).toBe(false);
    expect(new Date(accepted.body.data!.expiresAt).getTime() - h.clock.now().getTime()).toBeLessThanOrEqual(90 * 60_000);
    expect(readTelemetry(h.store, { principal: agent() }).status).toBe(200);
    expect((await h.api("GET", "/api/entity-b/citizen-records")).body.code).toBe("RESOURCE_CLASS_DENIED");
  });
});

function validCandidate() {
  return {
    scopes: [
      { action: "READ_TELEMETRY", resourceClass: "SECURITY_TELEMETRY", resourceIds: [], policyClause: "B-1.1" },
      { action: "INSPECT_CONNECTOR", resourceClass: "CONNECTOR", resourceIds: ["connector-b-17"], policyClause: "B-2.3" },
      { action: "ISOLATE_CONNECTOR", resourceClass: "CONNECTOR", resourceIds: ["connector-b-17"], policyClause: "B-2.4" },
    ],
    exclusions: [{ resourceClass: "CITIZEN_PII", policyClause: "B-3.0" }],
    expiryMinutes: 90,
    rationale: "ok",
  };
}
