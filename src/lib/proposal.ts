import { addMinutes } from "./clock";
import { ACTION_DEFINITIONS, CONNECTOR_ID, POLICY_B_CLAUSES, PROPOSAL_MINUTES } from "./domain/seed";
import type {
  Action,
  EntityPolicy,
  LeaseProposal,
  LeaseScope,
  Mission,
  ProposalExclusion,
  ProposalSource,
  ProposalTerm,
  ProtectedResource,
  ResourceClass,
} from "./domain/types";
import type { Store } from "./store";

const ACTIONS: Action[] = ["READ_TELEMETRY", "READ_CITIZEN_RECORDS", "INSPECT_CONNECTOR", "ISOLATE_CONNECTOR"];
const CLASSES: ResourceClass[] = ["SECURITY_TELEMETRY", "CITIZEN_PII", "CONNECTOR"];

/** Strict structured output a proposal generator must produce. */
export interface CandidateProposal {
  scopes: Array<{ action: Action; resourceClass: ResourceClass; resourceIds: string[]; policyClause: string }>;
  exclusions: Array<{ resourceClass: ResourceClass; policyClause: string }>;
  expiryMinutes: number;
  rationale: string;
}

export interface ProposalGenerator {
  name: string;
  /** Returns null when unavailable, timed out or invalid. Never throws. */
  generate(input: { mission: Mission; policyExcerpt: string }): Promise<CandidateProposal | null>;
}

/** Deterministic rule-based fallback. Always available. */
export function ruleBasedCandidate(): CandidateProposal {
  return {
    scopes: [
      { action: "READ_TELEMETRY", resourceClass: "SECURITY_TELEMETRY", resourceIds: [], policyClause: "B-1.1" },
      { action: "INSPECT_CONNECTOR", resourceClass: "CONNECTOR", resourceIds: [CONNECTOR_ID], policyClause: "B-2.3" },
      { action: "ISOLATE_CONNECTOR", resourceClass: "CONNECTOR", resourceIds: [CONNECTOR_ID], policyClause: "B-2.4" },
    ],
    exclusions: [{ resourceClass: "CITIZEN_PII", policyClause: "B-3.0" }],
    expiryMinutes: PROPOSAL_MINUTES,
    rationale: "Containment of Incident 024 requires telemetry read and B-17 inspection; isolation is human-gated; citizen PII excluded by Entity B policy.",
  };
}

export function policyExcerpt(policy: EntityPolicy): string {
  return Object.entries(POLICY_B_CLAUSES)
    .map(([k, v]) => `${k}: ${v}`)
    .concat([`Policy ${policy.id} v${policy.version}; maximum lease ${policy.maximumLeaseMinutes} minutes.`])
    .join("\n");
}

function isAction(x: unknown): x is Action {
  return typeof x === "string" && (ACTIONS as string[]).includes(x);
}
function isClass(x: unknown): x is ResourceClass {
  return typeof x === "string" && (CLASSES as string[]).includes(x);
}

/**
 * Validate untrusted generator output. Unknown actions, classes or resources
 * are rejected outright (null → fallback). Structural validity only; policy
 * fit is evaluated per term in `buildProposal`.
 */
export function validateCandidate(raw: unknown, resources: ProtectedResource[]): CandidateProposal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.scopes) || !Array.isArray(r.exclusions)) return null;
  if (typeof r.expiryMinutes !== "number" || !Number.isFinite(r.expiryMinutes) || r.expiryMinutes <= 0) return null;
  const resourceIds = new Set(resources.map((x) => x.id));
  const scopes: CandidateProposal["scopes"] = [];
  for (const s of r.scopes) {
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    if (!isAction(o.action) || !isClass(o.resourceClass) || !Array.isArray(o.resourceIds)) return null;
    if (!o.resourceIds.every((id) => typeof id === "string" && resourceIds.has(id))) return null;
    const expected = resources.find((x) => x.id === ACTION_DEFINITIONS[o.action as Action].resourceId);
    if (!expected || expected.resourceClass !== o.resourceClass) return null;
    scopes.push({
      action: o.action,
      resourceClass: o.resourceClass,
      resourceIds: o.resourceIds as string[],
      policyClause: typeof o.policyClause === "string" ? o.policyClause.slice(0, 16) : "",
    });
  }
  const exclusions: CandidateProposal["exclusions"] = [];
  for (const e of r.exclusions) {
    if (!e || typeof e !== "object") return null;
    const o = e as Record<string, unknown>;
    if (!isClass(o.resourceClass)) return null;
    exclusions.push({ resourceClass: o.resourceClass, policyClause: typeof o.policyClause === "string" ? o.policyClause.slice(0, 16) : "" });
  }
  if (scopes.length === 0) return null;
  return {
    scopes,
    exclusions,
    expiryMinutes: Math.floor(r.expiryMinutes),
    rationale: typeof r.rationale === "string" ? r.rationale.slice(0, 400) : "",
  };
}

function scopeFits(policyScopes: LeaseScope[], s: LeaseScope): boolean {
  return policyScopes.some(
    (p) =>
      p.action === s.action &&
      p.resourceClass === s.resourceClass &&
      (p.resourceIds.length === 0 || (s.resourceIds.length > 0 && s.resourceIds.every((id) => p.resourceIds.includes(id)))),
  );
}

/**
 * Turn a validated candidate into a proposal record. Every term is checked
 * against Entity B's policy: terms that violate it are kept visible as
 * rejected and are never carried into the lease.
 */
export function buildProposal(
  store: Store,
  mission: Mission,
  policy: EntityPolicy,
  candidate: CandidateProposal,
  source: ProposalSource,
  sourceDetail: string,
  leaseId: string,
): { proposal: LeaseProposal; scopes: LeaseScope[]; grantedMinutes: number } {
  const terms: ProposalTerm[] = candidate.scopes.map((c) => {
    const scope: LeaseScope = { action: c.action, resourceClass: c.resourceClass, resourceIds: c.resourceIds };
    if (policy.deniedResourceClasses.includes(scope.resourceClass)) {
      return { scope, gate: "ALLOWED", policyClause: c.policyClause, accepted: false, rejectionReason: `${scope.resourceClass} is denied by ${policy.id} v${policy.version}` };
    }
    if (scopeFits(policy.humanGated, scope)) {
      return { scope, gate: "HUMAN_GATED", policyClause: c.policyClause, accepted: true, rejectionReason: null };
    }
    if (scopeFits(policy.allowed, scope)) {
      return { scope, gate: "ALLOWED", policyClause: c.policyClause, accepted: true, rejectionReason: null };
    }
    return { scope, gate: "ALLOWED", policyClause: c.policyClause, accepted: false, rejectionReason: `${scope.action} on ${scope.resourceIds.join(",") || scope.resourceClass} is outside ${policy.id} v${policy.version}` };
  });

  const exclusions: ProposalExclusion[] = [];
  for (const cls of policy.deniedResourceClasses) {
    const fromCandidate = candidate.exclusions.find((e) => e.resourceClass === cls);
    exclusions.push({ resourceClass: cls, policyClause: fromCandidate?.policyClause || "B-3.0" });
  }
  for (const e of candidate.exclusions) {
    if (!exclusions.some((x) => x.resourceClass === e.resourceClass)) exclusions.push(e);
  }

  const grantedMinutes = Math.min(candidate.expiryMinutes, policy.maximumLeaseMinutes);
  const proposal: LeaseProposal = {
    id: store.newId("prop"),
    missionId: mission.id,
    leaseId,
    source,
    sourceDetail,
    terms,
    exclusions,
    requestedMinutes: candidate.expiryMinutes,
    grantedMinutes,
    createdAt: store.nowIso(),
  };
  return { proposal, scopes: terms.filter((t) => t.accepted).map((t) => t.scope), grantedMinutes };
}

export function proposalExpiry(store: Store, minutes: number): string {
  return addMinutes(store.now(), minutes).toISOString();
}
