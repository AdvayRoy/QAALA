import type { Action, AuthorityCheck, Decision, DecisionRecord, GovernanceEvent } from "@/lib/domain/types";
import type { DemoStep, Snapshot } from "@/lib/snapshot";

export type Tone = "neutral" | "allow" | "deny" | "stepup" | "info";

export const ACTION_META: Record<Action, { title: string; method: "GET" | "POST"; path: string; resourceId: string; target: string }> = {
  READ_TELEMETRY: { title: "Read security telemetry", method: "GET", path: "/api/entity-b/security-telemetry", resourceId: "telemetry-b", target: "Entity B / Security Telemetry" },
  READ_CITIZEN_RECORDS: { title: "Read citizen records", method: "GET", path: "/api/entity-b/citizen-records", resourceId: "citizen-records-b", target: "Entity B / Citizen Records" },
  INSPECT_CONNECTOR: { title: "Inspect connector B-17", method: "GET", path: "/api/entity-b/connectors/b-17", resourceId: "connector-b-17", target: "Entity B / Connector B-17" },
  ISOLATE_CONNECTOR: { title: "Isolate connector B-17", method: "POST", path: "/api/entity-b/connectors/b-17/isolate", resourceId: "connector-b-17", target: "Entity B / Connector B-17" },
};

export function actionFromPath(path: string): Action | null {
  const hit = (Object.keys(ACTION_META) as Action[]).find((a) => ACTION_META[a].path === path);
  return hit ?? null;
}

/** Where along the authority chain a decision stopped, for the graph. */
export type StopPoint = "agent" | "mission" | "lease" | "boundary" | "resource" | "none";

export function stopPointFor(code: string, decision: Decision): StopPoint {
  if (decision === "ALLOW") return "none";
  if (decision === "HUMAN_APPROVAL_REQUIRED") return "resource";
  switch (code) {
    case "PRINCIPAL_UNKNOWN":
    case "PRINCIPAL_NOT_AGENT":
      return "agent";
    case "MISSION_UNKNOWN":
    case "MISSION_NOT_DECLARED":
    case "MISSION_PURPOSE_MISMATCH":
    case "MISSION_EXPIRED":
      return "mission";
    case "RESOURCE_CLASS_DENIED":
    case "POLICY_MISSING":
    case "POLICY_SEVERITY_REJECTED":
    case "POLICY_SCOPE_DENIED":
    case "SCOPE_NOT_GRANTED":
    case "RESOURCE_UNAVAILABLE":
      return "boundary";
    default:
      return "lease";
  }
}

/** Short operator-facing label for a resolver check; the raw string stays as evidence. */
export function checkLabel(check: string): string {
  if (check.startsWith("Principal")) return "Identity";
  if (check.includes(" bound to ") || check.startsWith("Resource ")) return check.startsWith("Resource class") ? "Entity B policy — resource class" : "Resource binding";
  if (check.startsWith("Owner policy")) return "Entity B policy loaded";
  if (check.startsWith("Mission")) return "Mission";
  if (check.startsWith("Authority lease exists")) return "Lease";
  if (check.startsWith("Lease ") && check.includes("binds")) return "Lease";
  if (check.startsWith("Lease ACTIVE")) return "Lease active";
  if (check.startsWith("Approved by") || check.includes("issuer approval and")) return "Entity A approval · Entity B acceptance";
  if (check.includes("accepts")) return "Purpose & severity";
  if (check.startsWith("Lease scope")) return "Resource scope — lease";
  if (check.includes("policy permits")) return "Resource scope — Entity B policy";
  if (check.startsWith("Exact")) return "Human step-up";
  if (check.startsWith("No human gate")) return "Human step-up — not required";
  if (check.startsWith("Pre-mutation")) return "Pre-mutation recheck";
  return check;
}

export function decisionTone(decision: Decision): Tone {
  return decision === "ALLOW" ? "allow" : decision === "HUMAN_APPROVAL_REQUIRED" ? "stepup" : "deny";
}

export function eventTitle(e: GovernanceEvent, receipt: DecisionRecord | null): { title: string; tone: Tone } {
  switch (e.kind) {
    case "RESET":
      return { title: "STATE RESET", tone: "neutral" };
    case "MISSION_DECLARED":
      return { title: "MISSION DECLARED", tone: "info" };
    case "PROPOSAL_CREATED":
      return { title: "LEASE PROPOSED", tone: "info" };
    case "LEASE_ISSUER_APPROVED":
      return { title: "ENTITY A APPROVED", tone: "info" };
    case "LEASE_ACCEPTED":
      return { title: "ENTITY B ACCEPTED", tone: "allow" };
    case "LEASE_REJECTED":
      return { title: "ENTITY B REJECTED", tone: "deny" };
    case "LEASE_REVOKED":
      return { title: "AUTHORITY REVOKED", tone: "deny" };
    case "STEP_UP_REQUESTED":
      return { title: "STEP-UP SENT TO ENTITY B", tone: "stepup" };
    case "STEP_UP_APPROVED":
      return { title: "ENTITY B AUTHORIZED ISOLATION", tone: "stepup" };
    case "CONNECTOR_ISOLATED":
      return { title: "B-17 ISOLATED", tone: "allow" };
    case "DECISION": {
      if (!receipt) return { title: "DECISION", tone: "neutral" };
      const tone = decisionTone(receipt.decision);
      const ok = receipt.decision === "ALLOW";
      switch (receipt.action) {
        case "READ_TELEMETRY":
          return { title: ok ? "TELEMETRY ALLOWED" : "TELEMETRY DENIED", tone };
        case "READ_CITIZEN_RECORDS":
          return { title: ok ? "CITIZEN DATA ALLOWED" : "CITIZEN DATA DENIED", tone };
        case "INSPECT_CONNECTOR":
          return { title: ok ? "B-17 INSPECTED" : "B-17 INSPECTION DENIED", tone };
        case "ISOLATE_CONNECTOR":
          if (receipt.decision === "HUMAN_APPROVAL_REQUIRED") return { title: "HUMAN STEP-UP REQUIRED", tone };
          return { title: ok ? "B-17 ISOLATION EXECUTED" : "B-17 ISOLATION DENIED", tone };
      }
    }
  }
}

export interface BandState {
  label: string;
  tone: Tone;
  detail: string;
}

const LIFECYCLE_LABEL: Record<DemoStep, { label: string; tone: Tone }> = {
  NO_AUTHORITY: { label: "NO CROSS-AGENCY AUTHORITY", tone: "neutral" },
  MISSION_DECLARED: { label: "NO CROSS-AGENCY AUTHORITY", tone: "neutral" },
  PROPOSED: { label: "NO CROSS-AGENCY AUTHORITY", tone: "neutral" },
  ISSUER_APPROVED: { label: "NO CROSS-AGENCY AUTHORITY", tone: "neutral" },
  ACTIVE: { label: "TEMPORARY AUTHORITY ACTIVE", tone: "allow" },
  STEP_UP_PENDING: { label: "HUMAN AUTHORIZATION REQUIRED", tone: "stepup" },
  STEP_UP_APPROVED: { label: "TEMPORARY AUTHORITY ACTIVE", tone: "allow" },
  ISOLATED: { label: "TEMPORARY AUTHORITY ACTIVE", tone: "allow" },
  REVOKED: { label: "AUTHORITY REVOKED — CROSS-AGENCY ACCESS CLOSED", tone: "deny" },
  EXPIRED: { label: "AUTHORITY EXPIRED — CROSS-AGENCY ACCESS CLOSED", tone: "deny" },
};

export function hhmm(iso: string | null | undefined) {
  if (!iso) return "—";
  return `${new Date(iso).toISOString().slice(11, 16)}Z`;
}

export function hhmmss(iso: string | null | undefined) {
  if (!iso) return "—";
  return `${new Date(iso).toISOString().slice(11, 19)}Z`;
}

/**
 * Dominant state, computed only from server events and server-derived step.
 * The most recent server event wins when it is a decision that changes the
 * operational picture (a policy veto, a human gate, a revoked mandate).
 */
export function bandState(s: Snapshot): BandState {
  const lease = s.lease;
  const last = s.events[s.events.length - 1];
  const receipt = last?.receiptId ? s.decisions.find((d) => d.id === last.receiptId) ?? null : null;

  if (last?.kind === "DECISION" && receipt) {
    if (receipt.decision === "HUMAN_APPROVAL_REQUIRED") {
      return { label: "HUMAN AUTHORIZATION REQUIRED", tone: "stepup", detail: `${receipt.action} on ${receipt.resourceId} is human-gated by Entity B policy. Autonomous authority is held until an Entity B approver issues an exact, one-use approval.` };
    }
    if (["RESOURCE_CLASS_DENIED", "SCOPE_NOT_GRANTED", "POLICY_SCOPE_DENIED", "POLICY_SEVERITY_REJECTED"].includes(receipt.code)) {
      return { label: "ACCESS DENIED — OUTSIDE DELEGATED MANDATE", tone: "deny", detail: receipt.reason };
    }
    if (receipt.code === "AUTHORITY_REVOKED" || receipt.code === "AUTHORITY_EXPIRED") {
      return { label: receipt.code === "AUTHORITY_EXPIRED" ? LIFECYCLE_LABEL.EXPIRED.label : LIFECYCLE_LABEL.REVOKED.label, tone: "deny", detail: receipt.reason };
    }
  }

  if (s.pending?.status === "PENDING" && lease?.status === "ACTIVE") {
    return { label: "HUMAN AUTHORIZATION REQUIRED", tone: "stepup", detail: `${s.pending.action} on ${s.pending.resourceId} is human-gated by Entity B policy. Autonomous authority is held until an Entity B approver issues an exact, one-use approval.` };
  }

  const base = LIFECYCLE_LABEL[s.step];
  let detail = "";
  switch (s.step) {
    case "NO_AUTHORITY":
      detail = "Incident 024 not declared. Agent 47 holds no authority on Entity B; every protected call is denied.";
      break;
    case "MISSION_DECLARED":
      detail = `Incident ${s.mission.incidentCode} declared HIGH by Entity A. No lease exists yet.`;
      break;
    case "PROPOSED":
      detail = "Bounded lease proposed under Incident 024. Awaiting Entity A approval, then Entity B acceptance. Nothing is granted.";
      break;
    case "ISSUER_APPROVED":
      detail = "Entity A approved the mission and lease. Entity B has not accepted — issuer approval alone grants nothing.";
      break;
    case "ACTIVE":
      detail = lease ? `Lease ${lease.id} v${lease.version} accepted by Entity B under its policy ceiling · valid until ${hhmm(lease.expiresAt)} · ${lease.scopes.map((x) => x.action).join(" · ")}` : "";
      break;
    case "STEP_UP_PENDING":
      detail = "Isolation of connector B-17 is held. An Entity B approver must issue an exact, one-use approval.";
      break;
    case "STEP_UP_APPROVED":
      detail = "Entity B issued an exact one-use approval for ISOLATE_CONNECTOR on B-17. Agent 47 must re-attempt; the approval is consumed on execution.";
      break;
    case "ISOLATED":
      detail = `Connector B-17 isolated under lease ${lease?.id ?? ""} v${lease?.version ?? ""} · approval consumed · mandate remains active until ${hhmm(lease?.expiresAt)}`;
      break;
    case "REVOKED":
      detail = lease ? `Lease ${lease.id} revoked by ${s.principals.find((p) => p.id === lease.revokedBy)?.name ?? lease.revokedBy} at ${hhmmss(lease.revokedAt)}. Agent 47 holds no authority on Entity B.` : "";
      break;
    case "EXPIRED":
      detail = lease ? `Lease ${lease.id} expired at ${hhmmss(lease.expiresAt)}. Agent 47 holds no authority on Entity B.` : "";
      break;
  }
  return { ...base, detail };
}

export function failedCheck(path: AuthorityCheck[]): AuthorityCheck | null {
  return path.find((c) => !c.passed) ?? null;
}
