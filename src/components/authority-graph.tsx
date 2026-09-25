"use client";

import type { Snapshot } from "@/lib/snapshot";
import type { Decision } from "@/lib/domain/types";
import { hhmm, type StopPoint } from "./evidence";

export interface GraphFocus {
  resourceId: string | null;
  decision: Decision;
  stopAt: StopPoint;
}

const W = 1000;
const H = 600;

const C = {
  panel: "#0f1319",
  panelLine: "#232b36",
  text: "#dfe5ee",
  muted: "#7d8896",
  faint: "#3a4452",
  allow: "#3ecf8e",
  deny: "#ef5f6a",
  stepup: "#e5b43c",
  info: "#6aa6ff",
  isolated: "#f08a4b",
};

// Fixed operational layout. Left trust domain (Entity A), boundary, right trust domain (Entity B).
const A = { x: 24, y: 40, w: 318, h: 508 };
const B = { x: 598, y: 40, w: 378, h: 508 };
const BOUNDARY_X = B.x;
const BRIDGE_Y = 440;

const AGENT = { x: A.x + 24, y: 108, w: 270, h: 62 };
const MISSION = { x: A.x + 24, y: 250, w: 270, h: 62 };
const LEASE = { x: A.x + 24, y: BRIDGE_Y - 34, w: 270, h: 68 };

const TREE_X = B.x + 40;
const ROW_X = B.x + 64;
const ROW_W = B.w - 88;
const ROWS: Record<string, number> = { "telemetry-b": 130, "connector-b-17": 278, "citizen-records-b": 426 };

type ResourceState = "ALLOWED" | "HUMAN-GATED" | "DENIED" | "ISOLATED" | "NO AUTHORITY";

function resourceStates(s: Snapshot): Record<string, { state: ResourceState; gated: boolean; denied: boolean; granted: boolean }> {
  const out: Record<string, { state: ResourceState; gated: boolean; denied: boolean; granted: boolean }> = {};
  for (const r of s.resources) {
    const denied = s.graph.edges.some((e) => e.kind === "POLICY_DENIED" && e.to === r.id);
    const auth = s.graph.edges.filter((e) => e.kind === "ACTIVE_AUTHORITY" && e.to === r.id);
    const gated = auth.some((e) => e.gated);
    const granted = auth.length > 0;
    let state: ResourceState = "NO AUTHORITY";
    if (denied) state = "DENIED";
    else if (r.id === "connector-b-17" && s.connector.isolated) state = "ISOLATED";
    else if (granted && gated) state = "HUMAN-GATED";
    else if (granted) state = "ALLOWED";
    out[r.id] = { state, gated, denied, granted };
  }
  return out;
}

function stateColor(state: ResourceState) {
  switch (state) {
    case "ALLOWED":
      return C.allow;
    case "HUMAN-GATED":
      return C.stepup;
    case "DENIED":
      return C.deny;
    case "ISOLATED":
      return C.isolated;
    default:
      return C.faint;
  }
}

const MARKER_KEYS = Object.entries(C) as Array<[string, string]>;
function arrowFor(color: string, large = false) {
  const hit = MARKER_KEYS.find(([, v]) => v === color);
  return hit ? `url(#m-${hit[0]}${large ? "-lg" : ""})` : undefined;
}

function toneColor(d: Decision) {
  return d === "ALLOW" ? C.allow : d === "HUMAN_APPROVAL_REQUIRED" ? C.stepup : C.deny;
}

export function AuthorityGraphView({ snapshot, focus }: { snapshot: Snapshot; focus: GraphFocus | null }) {
  const lease = snapshot.lease;
  const mission = snapshot.mission;
  const live = lease ? lease.status !== "REVOKED" && lease.status !== "EXPIRED" : false;
  const bridgeActive = snapshot.graph.edges.some((e) => e.kind === "ACTIVE_AUTHORITY");
  const closed = !!lease && (lease.status === "REVOKED" || lease.status === "EXPIRED");
  const states = resourceStates(snapshot);
  const pending = snapshot.pending;
  const approver = snapshot.principals.find((p) => p.role === "RECEIVER_APPROVER");
  const commander = snapshot.principals.find((p) => p.role === "ISSUER_COMMANDER");

  const fc = focus ? toneColor(focus.decision) : null;
  const reaches = (point: StopPoint) => {
    if (!focus) return false;
    const order: StopPoint[] = ["agent", "mission", "lease", "boundary", "resource", "none"];
    return order.indexOf(point) < order.indexOf(focus.stopAt) || focus.stopAt === "none";
  };
  const stoppedAt = (point: StopPoint) => !!focus && focus.stopAt === point;

  const leaseTitle = !lease ? "No authority lease" : "Temporary Authority Lease";
  const leaseStatus = !lease
    ? "NONE"
    : lease.status === "PROPOSED"
      ? "PROPOSED · NOT APPROVED"
      : lease.status === "ISSUER_APPROVED"
        ? "ENTITY A APPROVED · AWAITING ENTITY B"
        : lease.status === "ACTIVE"
          ? `ACTIVE · UNTIL ${hhmm(lease.expiresAt)}`
          : lease.status;
  const leaseColor = !lease ? C.faint : lease.status === "ACTIVE" ? C.allow : closed ? C.deny : lease.status === "ISSUER_APPROVED" ? C.info : C.muted;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Authority graph derived from server state">
      <defs>
        {MARKER_KEYS.map(([k, v]) => (
          <marker key={k} id={`m-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={v} />
          </marker>
        ))}
        {MARKER_KEYS.map(([k, v]) => (
          <marker key={`${k}-lg`} id={`m-${k}-lg`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={v} />
          </marker>
        ))}
      </defs>

      {/* Trust domains */}
      <Domain box={A} title="ENTITY A" sub="REQUESTING AGENCY · INCIDENT RESPONSE" />
      <Domain box={B} title="ENTITY B" sub="RESOURCE OWNER · CIVIC INFRASTRUCTURE" />

      {/* Entity C — visible, not party */}
      <g opacity={0.55}>
        <rect x={A.x} y={A.y + A.h + 10} width={A.w} height={28} fill="none" stroke={C.panelLine} strokeDasharray="3 4" />
        <text x={A.x + 14} y={A.y + A.h + 29} fontSize="11" fill={C.muted} fontFamily="var(--font-geist-sans)" letterSpacing="0.08em">
          ENTITY C · REGIONAL TRANSIT — not party to Incident 024
        </text>
      </g>

      {/* Entity A chain: Agent → Mission → Lease */}
      <ObjectBox
        box={AGENT}
        kind="AGENT"
        title="Agent 47"
        status="AUTONOMOUS · ENTITY A"
        color={C.text}
        active={true}
        glow={fc && (reaches("agent") || stoppedAt("agent")) ? (stoppedAt("agent") ? C.deny : fc) : null}
      />
      <Link
        x1={AGENT.x + AGENT.w / 2}
        y1={AGENT.y + AGENT.h}
        x2={MISSION.x + MISSION.w / 2}
        y2={MISSION.y}
        label="acts under"
        color={mission.status === "DECLARED" ? C.muted : C.faint}
        dashed={mission.status !== "DECLARED"}
        highlight={fc && reaches("agent") ? fc : null}
      />
      <ObjectBox
        box={MISSION}
        kind="MISSION"
        title={`Incident 024`}
        status={mission.status === "DECLARED" ? `HIGH · DECLARED BY ${(commander?.name ?? "ENTITY A").toUpperCase()}` : "HIGH · NOT DECLARED"}
        color={mission.status === "DECLARED" ? C.text : C.muted}
        active={mission.status === "DECLARED"}
        glow={fc && (reaches("mission") || stoppedAt("mission")) ? (stoppedAt("mission") ? C.deny : fc) : null}
      />
      <Link
        x1={MISSION.x + MISSION.w / 2}
        y1={MISSION.y + MISSION.h}
        x2={LEASE.x + LEASE.w / 2}
        y2={LEASE.y}
        label={lease?.issuerApprovedBy ? "authorizes · approved by Entity A" : "authorizes"}
        color={live ? C.muted : C.faint}
        dashed={!live}
        highlight={fc && reaches("mission") ? fc : null}
      />
      <ObjectBox
        box={LEASE}
        kind="AUTHORITY LEASE"
        title={leaseTitle}
        status={leaseStatus}
        color={leaseColor}
        active={!!lease}
        dashedBorder={!lease}
        glow={fc && (reaches("lease") || stoppedAt("lease")) ? (stoppedAt("lease") ? C.deny : fc) : null}
        key={`lease-${lease?.id ?? "none"}-${lease?.status ?? "none"}`}
      />

      {/* Mandate bridge across trust domains */}
      <Bridge
        x1={LEASE.x + LEASE.w}
        x2={BOUNDARY_X}
        y={BRIDGE_Y}
        active={bridgeActive}
        closed={closed}
        pending={!!lease && !bridgeActive && !closed}
        acceptedBy={lease?.receiverAcceptedBy ? approver?.name ?? "Entity B" : null}
        highlight={fc && reaches("lease") ? fc : null}
      />

      {/* Policy boundary */}
      <g>
        <line x1={BOUNDARY_X} y1={B.y - 6} x2={BOUNDARY_X} y2={B.y + B.h + 6} stroke={C.text} strokeWidth={2.5} opacity={0.85} />
        <text x={BOUNDARY_X} y={B.y + B.h + 29} fontSize="10" fill={C.muted} fontFamily="var(--font-geist-sans)" letterSpacing="0.16em" textAnchor="middle">
          ENTITY B POLICY BOUNDARY
        </text>
      </g>

      {/* Resource tree inside Entity B */}
      <ResourceTree
        snapshot={snapshot}
        states={states}
        bridgeActive={bridgeActive}
        focus={focus}
        pendingLabel={pending?.status === "PENDING" ? "APPROVAL PENDING" : pending?.status === "APPROVED" ? "EXACT APPROVAL ISSUED · ONE USE" : null}
      />
    </svg>
  );
}

function Domain({ box, title, sub }: { box: { x: number; y: number; w: number; h: number }; title: string; sub: string }) {
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={C.panel} stroke={C.panelLine} />
      <text x={box.x + 16} y={box.y + 24} fontSize="14" fontWeight={600} fill={C.text} fontFamily="var(--font-geist-sans)" letterSpacing="0.14em">
        {title}
      </text>
      <text x={box.x + 16} y={box.y + 40} fontSize="10" fill={C.muted} fontFamily="var(--font-geist-sans)" letterSpacing="0.12em">
        {sub}
      </text>
      <line x1={box.x} y1={box.y + 52} x2={box.x + box.w} y2={box.y + 52} stroke={C.panelLine} />
    </g>
  );
}

function ObjectBox({
  box,
  kind,
  title,
  status,
  color,
  active,
  dashedBorder,
  glow,
}: {
  box: { x: number; y: number; w: number; h: number };
  kind: string;
  title: string;
  status: string;
  color: string;
  active: boolean;
  dashedBorder?: boolean;
  glow: string | null;
}) {
  return (
    <g className="qalaa-fade">
      {glow && <rect x={box.x - 3} y={box.y - 3} width={box.w + 6} height={box.h + 6} fill="none" stroke={glow} strokeWidth={1.5} opacity={0.9} />}
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#131920" stroke={active ? color : C.faint} strokeWidth={1.4} strokeDasharray={dashedBorder ? "5 4" : undefined} />
      <rect x={box.x} y={box.y} width={4} height={box.h} fill={active ? color : C.faint} />
      <text x={box.x + 16} y={box.y + 17} fontSize="9.5" fill={C.muted} fontFamily="var(--font-geist-sans)" letterSpacing="0.16em">
        {kind}
      </text>
      <text x={box.x + 16} y={box.y + 36} fontSize="15" fontWeight={600} fill={active ? C.text : C.muted} fontFamily="var(--font-geist-sans)">
        {title}
      </text>
      <text x={box.x + 16} y={box.y + box.h - 10} fontSize="10" fill={active ? color : C.faint} fontFamily="var(--font-geist-mono)" letterSpacing="0.06em">
        {status}
      </text>
    </g>
  );
}

function Link({
  x1,
  y1,
  x2,
  y2,
  label,
  color,
  dashed,
  highlight,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  color: string;
  dashed: boolean;
  highlight: string | null;
}) {
  const stroke = highlight ?? color;
  return (
    <g className="qalaa-fade">
      <line x1={x1} y1={y1 + 2} x2={x2} y2={y2 - 2} stroke={stroke} strokeWidth={highlight ? 2.2 : 1.4} strokeDasharray={dashed ? "4 4" : undefined} markerEnd={arrowFor(stroke)} />
      <text x={x1 + 12} y={(y1 + y2) / 2 + 4} fontSize="10.5" fill={highlight ?? C.muted} fontFamily="var(--font-geist-sans)" letterSpacing="0.04em">
        {label}
      </text>
    </g>
  );
}

function Bridge({
  x1,
  x2,
  y,
  active,
  closed,
  pending,
  acceptedBy,
  highlight,
}: {
  x1: number;
  x2: number;
  y: number;
  active: boolean;
  closed: boolean;
  pending: boolean;
  acceptedBy: string | null;
  highlight: string | null;
}) {
  const mid = (x1 + x2) / 2;
  if (active) {
    const stroke = highlight ?? C.allow;
    return (
      <g className="qalaa-bridge-in" key="bridge-active">
        <line x1={x1 + 6} y1={y - 5} x2={x2 - 4} y2={y - 5} stroke={stroke} strokeWidth={2.4} />
        <line x1={x1 + 6} y1={y + 5} x2={x2 - 4} y2={y + 5} stroke={stroke} strokeWidth={2.4} />
        <line x1={x1 + 6} y1={y} x2={x2 - 6} y2={y} stroke={stroke} strokeWidth={1.2} opacity={0.9} markerEnd={arrowFor(stroke, true)} />
        <rect x={mid - 92} y={y - 30} width={184} height={18} fill="#0b0e13" stroke={stroke} strokeWidth={1} />
        <text x={mid} y={y - 17} fontSize="10" fontWeight={600} fill={stroke} fontFamily="var(--font-geist-sans)" letterSpacing="0.16em" textAnchor="middle">
          TEMPORARY MANDATE · ACTIVE
        </text>
        <text x={mid} y={y + 26} fontSize="10" fill={C.muted} fontFamily="var(--font-geist-sans)" textAnchor="middle" letterSpacing="0.04em">
          {acceptedBy ? "Entity B accepted · human approver" : "Entity B accepted"} · Policy B ceiling
        </text>
      </g>
    );
  }
  if (closed) {
    return (
      <g className="qalaa-fade" key="bridge-closed">
        <line x1={x1 + 6} y1={y} x2={x1 + 60} y2={y} stroke={C.deny} strokeWidth={2} />
        <line x1={x1 + 60} y1={y - 10} x2={x1 + 76} y2={y + 10} stroke={C.deny} strokeWidth={2} />
        <line x1={x1 + 76} y1={y - 10} x2={x1 + 60} y2={y + 10} stroke={C.deny} strokeWidth={2} />
        <line x1={x1 + 90} y1={y} x2={x2 - 4} y2={y} stroke={C.faint} strokeWidth={1} strokeDasharray="2 6" />
        <text x={mid + 20} y={y - 14} fontSize="10" fontWeight={600} fill={C.deny} fontFamily="var(--font-geist-sans)" letterSpacing="0.16em" textAnchor="middle">
          MANDATE CLOSED
        </text>
        <text x={mid + 20} y={y + 22} fontSize="10" fill={C.muted} fontFamily="var(--font-geist-sans)" textAnchor="middle">
          lease no longer active · no cross-agency path
        </text>
      </g>
    );
  }
  return (
    <g className="qalaa-fade" key="bridge-none">
      <line x1={x1 + 6} y1={y} x2={x2 - 4} y2={y} stroke={highlight ?? C.faint} strokeWidth={1.2} strokeDasharray="2 6" />
      <text x={mid} y={y - 14} fontSize="10" fill={highlight ?? C.muted} fontFamily="var(--font-geist-sans)" letterSpacing="0.16em" textAnchor="middle">
        {pending ? "NO MANDATE · AWAITING ENTITY B" : "NO CROSS-AGENCY MANDATE"}
      </text>
    </g>
  );
}

function ResourceTree({
  snapshot,
  states,
  bridgeActive,
  focus,
  pendingLabel,
}: {
  snapshot: Snapshot;
  states: ReturnType<typeof resourceStates>;
  bridgeActive: boolean;
  focus: GraphFocus | null;
  pendingLabel: string | null;
}) {
  const landingX = BOUNDARY_X;
  const ids = Object.keys(ROWS);
  const top = ROWS[ids[0]] + 20;
  const bottom = ROWS[ids[ids.length - 1]] + 20;
  const fc = focus ? toneColor(focus.decision) : null;
  const boundaryStop = focus?.stopAt === "boundary";

  return (
    <g>
      {/* trunk from the bridge landing */}
      <line x1={landingX} y1={BRIDGE_Y} x2={TREE_X} y2={BRIDGE_Y} stroke={bridgeActive ? C.allow : C.faint} strokeWidth={bridgeActive ? 2 : 1} strokeDasharray={bridgeActive ? undefined : "2 5"} />
      <line x1={TREE_X} y1={top} x2={TREE_X} y2={Math.max(bottom, BRIDGE_Y)} stroke={bridgeActive ? C.allow : C.faint} strokeWidth={bridgeActive ? 2 : 1} strokeDasharray={bridgeActive ? undefined : "2 5"} opacity={0.8} />

      {boundaryStop && (
        <g className="qalaa-fade">
          <rect x={BOUNDARY_X - 3} y={BRIDGE_Y - 26} width={6} height={52} fill={C.deny} />
          <text x={BOUNDARY_X + 14} y={BRIDGE_Y - 36} fontSize="10" fontWeight={600} fill={C.deny} fontFamily="var(--font-geist-sans)" letterSpacing="0.14em">
            STOPPED AT ENTITY B POLICY
          </text>
        </g>
      )}

      {snapshot.resources.map((r) => {
        const y = ROWS[r.id];
        if (y === undefined) return null;
        const st = states[r.id];
        const color = stateColor(st.state);
        const isFocus = focus?.resourceId === r.id;
        const rowGlow = isFocus && fc && (focus.stopAt === "resource" || focus.stopAt === "none") ? fc : null;
        const branchColor = st.denied ? C.deny : bridgeActive && st.granted ? (st.gated ? C.stepup : C.allow) : C.faint;
        const isolated = r.id === "connector-b-17" && snapshot.connector.isolated;
        return (
          <g key={r.id} className="qalaa-fade">
            {/* branch */}
            {st.denied ? (
              <>
                <line x1={TREE_X} y1={y + 20} x2={ROW_X - 22} y2={y + 20} stroke={isFocus && boundaryStop ? C.deny : C.faint} strokeWidth={isFocus && boundaryStop ? 2 : 1} strokeDasharray="3 4" />
                <circle cx={ROW_X - 12} cy={y + 20} r={6} fill="none" stroke={C.deny} strokeWidth={1.6} />
                <line x1={ROW_X - 16} y1={y + 24} x2={ROW_X - 8} y2={y + 16} stroke={C.deny} strokeWidth={1.6} />
              </>
            ) : (
              <line x1={TREE_X} y1={y + 20} x2={ROW_X - 4} y2={y + 20} stroke={rowGlow ?? branchColor} strokeWidth={rowGlow ? 2.4 : bridgeActive && st.granted ? 2 : 1} strokeDasharray={bridgeActive && st.granted ? undefined : "2 5"} markerEnd={bridgeActive && st.granted ? arrowFor(rowGlow ?? branchColor) : undefined} />
            )}
            {/* row */}
            {rowGlow && <rect x={ROW_X - 3} y={y - 3} width={ROW_W + 6} height={46} fill="none" stroke={rowGlow} strokeWidth={1.5} />}
            <rect x={ROW_X} y={y} width={ROW_W} height={40} fill="#131920" stroke={st.state === "NO AUTHORITY" ? C.faint : color} strokeWidth={1.2} />
            <rect x={ROW_X} y={y} width={4} height={40} fill={st.state === "NO AUTHORITY" ? C.faint : color} />
            <text x={ROW_X + 14} y={y + 15} fontSize="9" fill={C.muted} fontFamily="var(--font-geist-sans)" letterSpacing="0.14em">
              PROTECTED RESOURCE · {r.resourceClass}
            </text>
            <text x={ROW_X + 14} y={y + 31} fontSize="14" fontWeight={600} fill={C.text} fontFamily="var(--font-geist-sans)">
              {r.displayName}
            </text>
            <text x={ROW_X + ROW_W - 12} y={y + 31} fontSize="10.5" fontWeight={700} fill={color} fontFamily="var(--font-geist-mono)" textAnchor="end" letterSpacing="0.08em">
              {st.state === "ISOLATED" ? "ACTIVE → ISOLATED" : st.state}
            </text>
            {/* sub-tags */}
            {st.denied && (
              <text x={ROW_X + 14} y={y + 55} fontSize="10" fill={C.deny} fontFamily="var(--font-geist-sans)" letterSpacing="0.06em">
                Not in delegated mandate · Policy B-3.0 · Entity B veto
              </text>
            )}
            {r.id === "connector-b-17" && (st.gated || isolated) && (
              <text x={ROW_X + 14} y={y + 55} fontSize="10" fill={isolated ? C.isolated : C.stepup} fontFamily="var(--font-geist-sans)" letterSpacing="0.06em">
                {isolated ? `Isolated · state v${snapshot.connector.version} · approval consumed` : pendingLabel ? `Isolation requires Entity B human · ${pendingLabel}` : "Isolation requires exact Entity B human approval"}
              </text>
            )}
            {r.id === "telemetry-b" && st.state === "ALLOWED" && (
              <text x={ROW_X + 14} y={y + 55} fontSize="10" fill={C.allow} fontFamily="var(--font-geist-sans)" letterSpacing="0.06em">
                Read permitted under lease scope · Policy B-1.1
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
