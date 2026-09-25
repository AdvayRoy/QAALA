import type { AuthorityLease, Mission } from "./domain/types";

/**
 * Expiry is evaluated from server time on every read. ACTIVE or
 * ISSUER_APPROVED leases whose expiry has passed are reported as EXPIRED;
 * REVOKED is terminal and never changes.
 */
export function effectiveLease(lease: AuthorityLease, now: Date): AuthorityLease {
  if (lease.status === "REVOKED" || lease.status === "EXPIRED") return lease;
  if (new Date(lease.expiresAt).getTime() <= now.getTime()) {
    return { ...lease, status: "EXPIRED" };
  }
  return lease;
}

export function missionIsValid(mission: Mission, now: Date): boolean {
  if (mission.status !== "DECLARED") return false;
  if (!mission.expiresAt) return false;
  return new Date(mission.expiresAt).getTime() > now.getTime();
}
