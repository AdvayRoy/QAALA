# Qalaa command center redesign

## Scope and preserved contracts

The existing Next.js route handlers, SQLite store, resolver, proposal validation,
lease lifecycle, server graph projection, and API tests remain unchanged.
Preserve the typed API client, receipt/check labels, and object-inspection data.

| Frontend dependency | Contract |
| --- | --- |
| `POST /api/demo/session` | One opaque session per AGENT, ISSUER_COMMANDER, RECEIVER_APPROVER; explicit session header on each role action. |
| `GET /api/demo/state` | Authoritative Snapshot: server time, mission, leases, proposal, policy, identities, resources, connector, pending approvals, receipts, events, graph. |
| `POST /api/demo/reset` | Resets synthetic operational data; sessions survive. Reconcile from state afterward. |
| `POST /api/mission/declare` | Entity A commander declares the mission. |
| `POST /api/leases/propose`, `issuer-approve` | Entity A proposes policy-bounded scope, then approves. Neither activates authority. |
| `POST /api/leases/receiver-accept`, `receiver-reject` | Separate Entity B approver accepts or rejects. |
| `POST /api/leases/revoke` | Entity B approver revokes; state refresh removes active authority edges. |
| `POST /api/step-up/approve` | Entity B submits the server-issued pendingRequestId for an exact one-use approval. |
| Entity B telemetry, citizen records, connector inspection, isolation | Existing methods and paths from api-client.ts. HTTP status, reason, checks, receiptId and optional data/pendingRequestId remain authoritative. |

## Screen and component architecture

- Persistent header: Qalaa identity, incident context, server time, demo label.
- Compact mission strip: incident title, severity, live lease condition.
- Left operation rail: guided next action, Entity A lifecycle, protected operations,
  Entity B review/revoke. Completed steps derive from actual events, not step indexes.
- Center: React Flow authority canvas with inspectable Entity A, Qalaa lease,
  Entity B, mission/agent, and protected resources. Map server graph relationships;
  never synthesize a granted edge. Missing or severed authority is explicitly labeled.
- Right evidence inspector: prominent HTTP decision, reason, receipt metadata,
  compact resolver checks, expandable raw evidence. Historical evidence stays dated.
- Bottom lineage: chronological, selectable server events linked to actual receipts.
- Entity B shadcn Sheet: separate role identity, policy-constrained proposal terms,
  accept/reject and exact human approval. Keyboard focus trapped and restored.
- A snapshot hook serializes/reconciles state reads after mutations and polls while
  visible. Network failures mark the view stale and disable mutations until recovery.

## Design system

| Token | Direction |
| --- | --- |
| Surfaces | Canvas #0c1015; panels #11161d; raised controls #1a222d |
| Borders | 1px #26313e, subdued structural dividers #202832 |
| Text | Primary #e7edf4; secondary #a5b0be; tertiary #7e8b9b |
| Semantic states | Denied/revoked/expired #ef7b83; pending/human gate #e6bd72; active/allowed #68d6aa; neutral steel #9ab6d3 |
| Typography | Existing Geist Sans; Geist Mono for IDs, timestamps, methods and status codes. 12–14px supporting text, 18–24px node/status titles, 44–54px decision code. |
| Spacing | 4px base; 8/12px compact gaps; 16/20/24px panel padding. |
| Borders/radii | 3–4px controls and nodes; structural panels square. No decorative gradients. |
| Canvas | Stable relationship positions, muted dot grid, directed edges, distinct policy boundary; status labels stay readable in 16:9. |
| Motion | 180–250ms opacity/position transitions after real state changes; no ornamental pulsing; honor reduced motion. |

## Validation

Run typecheck, lint, existing tests, production build, live acceptance script,
then browser UI workflow at 1440×810 and 1920×1080 plus a narrow viewport.
Confirm 403 → Entity A approval (still denied) → Entity B acceptance → 200 →
permanent resource deny → one-use human step-up → revoke → 403. Verify graph,
receipt IDs, event lineage, out-of-session reconciliation, drawer keyboard behavior,
and frontend runtime/console health.
