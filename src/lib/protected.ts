import { CONNECTOR_ID } from "./domain/seed";
import type { ConnectorState, PendingActionRequest, Principal, ResolverResponse } from "./domain/types";
import { authorize } from "./resolver";
import type { Store } from "./store";

export interface ProtectedCall {
  principal: Principal | null;
  leaseId?: string | null;
  missionId?: string | null;
}

export interface ProtectedResult<T = unknown> {
  status: number;
  body: ResolverResponse & { data?: T; pendingRequestId?: string };
}

/** Synthetic incident telemetry. Returned only after ALLOW. */
function telemetryPayload(store: Store) {
  const connector = store.getConnector(CONNECTOR_ID);
  return {
    incidentCode: "INC-024",
    window: { from: "2026-09-25T09:40:00Z", to: store.nowIso() },
    signals: [
      { id: "sig-1", kind: "AUTH_ANOMALY", source: "connector-b-17", severity: "HIGH", detail: "Service token reused from 3 distinct egress ranges" },
      { id: "sig-2", kind: "LATERAL_MOVEMENT", source: "registry-core-02", severity: "HIGH", detail: "SMB fan-out to 14 hosts in 90s" },
      { id: "sig-3", kind: "EXFIL_ATTEMPT", source: "connector-b-17", severity: "MEDIUM", detail: "2.1 GB staged to external relay; blocked by egress filter" },
    ],
    connectorB17: { isolated: connector?.isolated ?? false, version: connector?.version ?? 0 },
  };
}

export function readTelemetry(store: Store, call: ProtectedCall): ProtectedResult {
  const r = authorize(store, { principal: call.principal, action: "READ_TELEMETRY", leaseId: call.leaseId, missionId: call.missionId });
  if (r.status === 200) {
    return { status: 200, body: { ...r.body, data: telemetryPayload(store) } };
  }
  return { status: r.status, body: r.body };
}

export function readCitizenRecords(store: Store, call: ProtectedCall): ProtectedResult {
  const r = authorize(store, { principal: call.principal, action: "READ_CITIZEN_RECORDS", leaseId: call.leaseId, missionId: call.missionId });
  // Citizen data is never serialized, whatever the resolver says.
  return { status: r.status, body: r.body };
}

export function inspectConnector(store: Store, call: ProtectedCall): ProtectedResult<ConnectorState> {
  const r = authorize(store, { principal: call.principal, action: "INSPECT_CONNECTOR", leaseId: call.leaseId, missionId: call.missionId });
  if (r.status === 200) {
    const connector = store.getConnector(CONNECTOR_ID);
    return { status: 200, body: { ...r.body, data: connector ?? undefined } };
  }
  return { status: r.status, body: r.body };
}

export function isolateConnector(store: Store, call: ProtectedCall): ProtectedResult<ConnectorState> {
  const r = authorize(
    store,
    { principal: call.principal, action: "ISOLATE_CONNECTOR", leaseId: call.leaseId, missionId: call.missionId },
    (resolution, requestId) => {
      const connector = store.getConnector(CONNECTOR_ID);
      if (!connector) throw new Error("connector state missing");
      if (connector.isolated) {
        return { code: "ALREADY_ISOLATED", reason: `Connector B-17 was already isolated at ${connector.isolatedAt} (v${connector.version}); no state change.` };
      }
      const next: ConnectorState = {
        ...connector,
        isolated: true,
        isolatedAt: store.nowIso(),
        isolatedByRequestId: requestId,
        version: connector.version + 1,
      };
      store.putConnector(next);
      for (const p of store.listPending()) {
        if (p.approvalId && p.approvalId === resolution.approval?.id) {
          store.putPending({ ...p, status: "CONSUMED" });
        }
      }
      store.appendEvent(
        "CONNECTOR_ISOLATED",
        resolution.actorId,
        `Connector B-17 isolated (v${next.version}) under lease ${resolution.lease?.id} v${resolution.lease?.version}, approval ${resolution.approval?.id}`,
        null,
        resolution.lease?.id ?? null,
        resolution.lease?.version ?? null,
      );
      return { reason: `Connector B-17 isolated; state version ${connector.version} → ${next.version}; approval ${resolution.approval?.id} consumed.` };
    },
  );

  if (r.status === 409 && r.resolution.lease) {
    const lease = r.resolution.lease;
    const existing = store
      .listPending()
      .find((p) => p.status === "PENDING" && p.leaseId === lease.id && p.leaseVersion === lease.version && p.action === "ISOLATE_CONNECTOR");
    const pending: PendingActionRequest =
      existing ??
      store.transaction(() => {
        const created: PendingActionRequest = {
          id: store.newId("pend"),
          requestId: r.receipt.requestId,
          actorId: r.resolution.actorId,
          missionId: r.resolution.missionId,
          leaseId: lease.id,
          leaseVersion: lease.version,
          action: "ISOLATE_CONNECTOR",
          resourceId: CONNECTOR_ID,
          receiptId: r.receipt.id,
          requestedAt: store.nowIso(),
          leaseExpiresAt: lease.expiresAt,
          status: "PENDING",
          approvalId: null,
        };
        store.putPending(created);
        store.appendEvent(
          "STEP_UP_REQUESTED",
          created.actorId,
          `Step-up requested: ISOLATE_CONNECTOR on ${CONNECTOR_ID} (lease v${lease.version}) awaiting ${lease.receiverEntityId} approver`,
          r.receipt.id,
          lease.id,
          lease.version,
        );
        return created;
      });
    return { status: 409, body: { ...r.body, pendingRequestId: pending.id } };
  }

  if (r.status === 200) {
    return { status: 200, body: { ...r.body, data: store.getConnector(CONNECTOR_ID) ?? undefined } };
  }
  return { status: r.status, body: r.body };
}
