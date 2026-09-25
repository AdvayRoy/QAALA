"use client";

import type { Snapshot } from "@/lib/snapshot";
import type { Decision } from "@/lib/domain/types";
import { minutesRemaining, type ObjectRef, type StopPoint } from "./evidence";

export interface GraphFocus {
  resourceId: string | null;
  decision: Decision;
  stopAt: StopPoint;
}

const W = 1000;
const H = 600;

const C = {
  canvas: "#0b0e13",
  domain: "#0e131a",
  tile: "#141a23",
  text: "#e3e8ef",
  muted: "#8a94a3",
  faint: "#525d6c",
  allow: "#3ecf8e",
  deny: "#ef5f6a",
  stepup: "#e5b43c",
  info: "#6aa6ff",
  isolated: "#f08a4b",
  trace: "#c3cad4",
};

const SANS = "var(--font-geist-sans)";

// Fixed operational layout: Entity A chain on the left, one boundary, Entity B resources on the right.
const A_X = 36;
const TILE_W = 300;
const TILE_H = 72;
const BOUNDARY_X = 560;
const BRIDGE_Y = 424;

const AGENT = { x: A_X, y: 100, w: TILE_W, h: TILE_H };
const MISSION = { x: A_X, y: 236, w: TILE_W, h: TILE_H };
const LEASE = { x: A_X, y: BRIDGE_Y - TILE_H / 2, w: TILE_W, h: TILE_H };

const TREE_X = BOUNDARY_X + 44;
const ROW_X = BOUNDARY_X + 76;
const ROW_W = W - ROW_X - 36;
const ROWS: Record<string, number> = { "telemetry-b": 92, "connector-b-17": 240, "citizen-records-b": 388 };

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

function sameRef(a: ObjectRef | null, b: ObjectRef) {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "resource" && b.kind === "resource") return a.id === b.id;
  if (a.kind === "entity" && b.kind === "entity") return a.id === b.id;
  return true;
}

export function AuthorityGraphView({
  snapshot,
  focus,
  selected,
  onSelect,
}: {
  snapshot: Snapshot;
  focus: GraphFocus | null;
  selected: ObjectRef | null;
  onSelect: (ref: ObjectRef) => void;
}) {
  const lease = snapshot.lease;
  const mission = snapshot.mission;
  const live = lease ? lease.status !== "REVOKED" && lease.status !== "EXPIRED" : false;
  const bridgeActive = snapshot.graph.edges.some((e) => e.kind === "ACTIVE_AUTHORITY");
  const closed = !!lease && (lease.status === "REVOKED" || lease.status === "EXPIRED");
  const states = resourceStates(snapshot);
  const pending = snapshot.pending;

  const trace = focus ? (focus.decision === "ALLOW" ? C.allow : C.trace) : null;
  const reaches = (point: StopPoint) => {
    if (!focus) return false;
    const order: StopPoint[] = ["agent", "mission", "lease", "boundary", "resource", "none"];
    return order.indexOf(point) < order.indexOf(focus.stopAt) || focus.stopAt === "none";
  };
  const stoppedAt = (point: StopPoint) => !!focus && focus.stopAt === point;
  const glowFor = (point: StopPoint) => (stoppedAt(point) ? C.deny : trace && reaches(point) ? trace : null);

  const leaseState = !lease
    ? "NONE"
    : lease.status === "PROPOSED"
      ? "PROPOSED · AWAITING ENTITY A"
      : lease.status === "ISSUER_APPROVED"
        ? "ENTITY A APPROVED · AWAITING ENTITY B"
        : lease.status === "ACTIVE"
          ? `ACTIVE · ${minutesRemaining(lease.expiresAt, snapshot.serverTime)} MIN REMAINING`
          : lease.status;
  const leaseColor = !lease ? C.faint : lease.status === "ACTIVE" ? C.allow : closed ? C.deny : lease.status === "ISSUER_APPROVED" ? C.info : C.muted;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full select-none" role="img" aria-label="Common operating picture derived from server state">
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

      {/* Entity B is a separate trust domain: one tinted region, one hard boundary. */}
      <rect x={BOUNDARY_X} y={16} width={W - BOUNDARY_X} height={H - 32} fill={C.domain} />

      <DomainHeading x={A_X} title="ENTITY A" sub="Requesting agency" selected={sameRef(selected, { kind: "entity", id: "entity-a" })} onClick={() => onSelect({ kind: "entity", id: "entity-a" })} />
      <DomainHeading
        x={ROW_X}
        title="ENTITY B"
        sub="Resource owner · separate trust domain"
        selected={sameRef(selected, { kind: "entity", id: "entity-b" })}
        onClick={() => onSelect({ kind: "entity", id: "entity-b" })}
      />

      <text x={A_X} y={556} fontSize="11" fill={C.faint} fontFamily={SANS}>
        Entity C · Regional transit — not party to Incident 024
      </text>

      {/* Entity A chain: Agent → Mission → Temporary authority */}
      <Tile
        box={AGENT}
        kind="Autonomous response agent"
        title="Agent 47"
        state={bridgeActive ? "AUTHORIZED ON ENTITY B" : "NO CROSS-AGENCY AUTHORITY"}
        color={bridgeActive ? C.allow : C.muted}
        active
        glow={glowFor("agent")}
        selected={sameRef(selected, { kind: "agent" })}
        onClick={() => onSelect({ kind: "agent" })}
      />
      <Link
        x1={AGENT.x + AGENT.w / 2}
        y1={AGENT.y + AGENT.h}
        x2={MISSION.x + MISSION.w / 2}
        y2={MISSION.y}
        color={mission.status === "DECLARED" ? C.muted : C.faint}
        dashed={mission.status !== "DECLARED"}
        highlight={trace && reaches("agent") ? trace : null}
      />
      <Tile
        box={MISSION}
        kind="Mission"
        title="Incident 024"
        state={mission.status === "DECLARED" ? "HIGH · ACTIVE" : mission.status === "CLOSED" ? "HIGH · CLOSED" : "HIGH · NOT DECLARED"}
        color={mission.status === "DECLARED" ? C.info : C.muted}
        active={mission.status === "DECLARED"}
        glow={glowFor("mission")}
        selected={sameRef(selected, { kind: "mission" })}
        onClick={() => onSelect({ kind: "mission" })}
      />
      <Link
        x1={MISSION.x + MISSION.w / 2}
        y1={MISSION.y + MISSION.h}
        x2={LEASE.x + LEASE.w / 2}
        y2={LEASE.y}
        color={live ? C.muted : C.faint}
        dashed={!live}
        highlight={trace && reaches("mission") ? trace : null}
      />
      <Tile
        key={`lease-${lease?.id ?? "none"}-${lease?.status ?? "none"}`}
        box={LEASE}
        kind="Temporary authority"
        title={lease ? "Lease on Entity B" : "No lease"}
        state={leaseState}
        color={leaseColor}
        active={!!lease}
        ghost={!lease}
        glow={glowFor("lease")}
        selected={sameRef(selected, { kind: "lease" })}
        onClick={() => onSelect({ kind: "lease" })}
      />

      {/* Authority bridge across the boundary */}
      <Bridge x1={LEASE.x + LEASE.w} x2={BOUNDARY_X} y={BRIDGE_Y} active={bridgeActive} closed={closed} pending={!!lease && !bridgeActive && !closed} />

      {/* Boundary */}
      <line x1={BOUNDARY_X} y1={16} x2={BOUNDARY_X} y2={H - 16} stroke={C.text} strokeWidth={2} opacity={0.75} />
      <text x={BOUNDARY_X} y={H - 2} fontSize="10.5" fill={C.muted} fontFamily={SANS} textAnchor="middle" letterSpacing="0.1em">
        ENTITY B POLICY BOUNDARY
      </text>

      <ResourceTree
        snapshot={snapshot}
        states={states}
        bridgeActive={bridgeActive}
        focus={focus}
        selected={selected}
        onSelect={onSelect}
        pendingLabel={pending?.status === "PENDING" ? "Approval pending with Entity B" : pending?.status === "APPROVED" ? "Exact approval issued · one use" : null}
      />
    </svg>
  );
}

function DomainHeading({ x, title, sub, selected, onClick }: { x: number; title: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <g onClick={onClick} className="cursor-pointer">
      <rect x={x - 10} y={26} width={300} height={44} fill={selected ? "#ffffff" : "transparent"} opacity={selected ? 0.05 : 0} />
      <text x={x} y={46} fontSize="15" fontWeight={600} fill={C.text} fontFamily={SANS} letterSpacing="0.14em">
        {title}
      </text>
      <text x={x} y={63} fontSize="11" fill={C.muted} fontFamily={SANS}>
        {sub}
      </text>
    </g>
  );
}

function Tile({
  box,
  kind,
  title,
  state,
  color,
  active,
  ghost,
  glow,
  selected,
  onClick,
}: {
  box: { x: number; y: number; w: number; h: number };
  kind: string;
  title: string;
  state: string;
  color: string;
  active: boolean;
  ghost?: boolean;
  glow: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <g className="qalaa-fade cursor-pointer" onClick={onClick}>
      {glow && <rect x={box.x - 4} y={box.y - 4} width={box.w + 8} height={box.h + 8} fill="none" stroke={glow} strokeWidth={1.5} opacity={0.9} />}
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={ghost ? "transparent" : C.tile} stroke={selected ? C.text : ghost ? C.faint : "none"} strokeWidth={selected ? 1.2 : 1} strokeDasharray={ghost && !selected ? "4 5" : undefined} />
      <rect x={box.x} y={box.y} width={3} height={box.h} fill={active ? color : C.faint} />
      <text x={box.x + 18} y={box.y + 20} fontSize="10.5" fill={C.muted} fontFamily={SANS} letterSpacing="0.1em">
        {kind.toUpperCase()}
      </text>
      <text x={box.x + 18} y={box.y + 43} fontSize="17" fontWeight={600} fill={active ? C.text : C.muted} fontFamily={SANS}>
        {title}
      </text>
      <text x={box.x + 18} y={box.y + 61} fontSize="11.5" fontWeight={600} fill={active ? color : C.faint} fontFamily={SANS} letterSpacing="0.06em">
        {state}
      </text>
    </g>
  );
}

function Link({ x1, y1, x2, y2, color, dashed, highlight }: { x1: number; y1: number; x2: number; y2: number; color: string; dashed: boolean; highlight: string | null }) {
  const stroke = highlight ?? color;
  return <line className="qalaa-fade" x1={x1} y1={y1 + 3} x2={x2} y2={y2 - 3} stroke={stroke} strokeWidth={highlight ? 2.2 : 1.4} strokeDasharray={dashed ? "4 4" : undefined} markerEnd={arrowFor(stroke)} />;
}

function Bridge({ x1, x2, y, active, closed, pending }: { x1: number; x2: number; y: number; active: boolean; closed: boolean; pending: boolean }) {
  const mid = (x1 + x2) / 2;
  if (active) {
    const stroke = C.allow;
    return (
      <g className="qalaa-bridge-in" key="bridge-active">
        <line x1={x1 + 8} y1={y - 5} x2={x2 - 4} y2={y - 5} stroke={stroke} strokeWidth={2.4} />
        <line x1={x1 + 8} y1={y + 5} x2={x2 - 4} y2={y + 5} stroke={stroke} strokeWidth={2.4} />
        <line x1={x1 + 8} y1={y} x2={x2 - 6} y2={y} stroke={stroke} strokeWidth={1.2} opacity={0.9} markerEnd={arrowFor(stroke, true)} />
        <text x={mid} y={y - 16} fontSize="12" fontWeight={600} fill={stroke} fontFamily={SANS} letterSpacing="0.1em" textAnchor="middle">
          TEMPORARY AUTHORITY · ACTIVE
        </text>
        <text x={mid} y={y + 26} fontSize="11" fill={C.muted} fontFamily={SANS} textAnchor="middle">
          Accepted by Entity B under its own policy ceiling
        </text>
      </g>
    );
  }
  if (closed) {
    return (
      <g className="qalaa-fade" key="bridge-closed">
        <line x1={x1 + 8} y1={y} x2={x1 + 56} y2={y} stroke={C.deny} strokeWidth={2} />
        <line x1={x1 + 58} y1={y - 9} x2={x1 + 74} y2={y + 9} stroke={C.deny} strokeWidth={2} />
        <line x1={x1 + 74} y1={y - 9} x2={x1 + 58} y2={y + 9} stroke={C.deny} strokeWidth={2} />
        <line x1={x1 + 88} y1={y} x2={x2 - 4} y2={y} stroke={C.faint} strokeWidth={1} strokeDasharray="2 6" />
        <text x={mid + 24} y={y - 16} fontSize="12" fontWeight={600} fill={C.deny} fontFamily={SANS} letterSpacing="0.1em" textAnchor="middle">
          AUTHORITY CLOSED
        </text>
        <text x={mid + 24} y={y + 26} fontSize="11" fill={C.muted} fontFamily={SANS} textAnchor="middle">
          No cross-agency path
        </text>
      </g>
    );
  }
  return (
    <g className="qalaa-fade" key="bridge-none">
      <line x1={x1 + 8} y1={y} x2={x2 - 4} y2={y} stroke={pending ? C.info : C.faint} strokeWidth={1.2} strokeDasharray={pending ? "6 5" : "2 6"} />
      <text x={mid} y={y - 16} fontSize="12" fontWeight={600} fill={pending ? C.info : C.faint} fontFamily={SANS} letterSpacing="0.1em" textAnchor="middle">
        {pending ? "AWAITING ENTITY B" : "NO AUTHORITY"}
      </text>
    </g>
  );
}

function ResourceTree({
  snapshot,
  states,
  bridgeActive,
  focus,
  selected,
  onSelect,
  pendingLabel,
}: {
  snapshot: Snapshot;
  states: ReturnType<typeof resourceStates>;
  bridgeActive: boolean;
  focus: GraphFocus | null;
  selected: ObjectRef | null;
  onSelect: (ref: ObjectRef) => void;
  pendingLabel: string | null;
}) {
  const ids = Object.keys(ROWS);
  const top = ROWS[ids[0]] + TILE_H / 2;
  const bottom = ROWS[ids[ids.length - 1]] + TILE_H / 2;
  const fc = focus ? toneColor(focus.decision) : null;
  const boundaryStop = focus?.stopAt === "boundary";
  const trunkColor = bridgeActive ? C.allow : C.faint;

  return (
    <g>
      <line x1={BOUNDARY_X} y1={BRIDGE_Y} x2={TREE_X} y2={BRIDGE_Y} stroke={trunkColor} strokeWidth={bridgeActive ? 2 : 1} strokeDasharray={bridgeActive ? undefined : "2 5"} />
      <line x1={TREE_X} y1={top} x2={TREE_X} y2={Math.max(bottom, BRIDGE_Y)} stroke={trunkColor} strokeWidth={bridgeActive ? 2 : 1} strokeDasharray={bridgeActive ? undefined : "2 5"} opacity={0.8} />

      {boundaryStop && (
        <g className="qalaa-fade">
          <rect x={BOUNDARY_X - 4} y={BRIDGE_Y - 28} width={8} height={56} fill={C.deny} />
          <text x={BOUNDARY_X + 14} y={BRIDGE_Y - 38} fontSize="11.5" fontWeight={600} fill={C.deny} fontFamily={SANS} letterSpacing="0.1em">
            ENTITY B VETO
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
        const cy = y + TILE_H / 2;
        const isSelected = sameRef(selected, { kind: "resource", id: r.id });
        const sub = st.denied
          ? "CITIZEN_PII · outside delegated scope"
          : r.id === "connector-b-17" && isolated
            ? "State changed under exact human approval"
            : r.id === "connector-b-17" && st.gated
              ? pendingLabel ?? "Isolation requires an Entity B human"
              : null;
        return (
          <g key={r.id} className="qalaa-fade cursor-pointer" onClick={() => onSelect({ kind: "resource", id: r.id })}>
            {st.denied ? (
              <>
                <line x1={TREE_X} y1={cy} x2={ROW_X - 16} y2={cy} stroke={isFocus && boundaryStop ? C.deny : C.faint} strokeWidth={isFocus && boundaryStop ? 2 : 1} strokeDasharray="3 4" />
                <rect x={ROW_X - 14} y={cy - 9} width={3} height={18} fill={C.deny} />
              </>
            ) : (
              <line
                x1={TREE_X}
                y1={cy}
                x2={ROW_X - 4}
                y2={cy}
                stroke={rowGlow ?? branchColor}
                strokeWidth={rowGlow ? 2.4 : bridgeActive && st.granted ? 2 : 1}
                strokeDasharray={bridgeActive && st.granted ? undefined : "2 5"}
                markerEnd={bridgeActive && st.granted ? arrowFor(rowGlow ?? branchColor) : undefined}
              />
            )}
            {rowGlow && <rect x={ROW_X - 4} y={y - 4} width={ROW_W + 8} height={TILE_H + 8} fill="none" stroke={rowGlow} strokeWidth={1.5} />}
            <rect x={ROW_X} y={y} width={ROW_W} height={TILE_H} fill={C.tile} stroke={isSelected ? C.text : "none"} strokeWidth={1.2} />
            <rect x={ROW_X} y={y} width={3} height={TILE_H} fill={st.state === "NO AUTHORITY" ? C.faint : color} />
            <text x={ROW_X + 18} y={y + 20} fontSize="10.5" fill={C.muted} fontFamily={SANS} letterSpacing="0.1em">
              PROTECTED RESOURCE
            </text>
            <text x={ROW_X + 18} y={y + 43} fontSize="17" fontWeight={600} fill={C.text} fontFamily={SANS}>
              {r.displayName}
            </text>
            <text x={ROW_X + ROW_W - 16} y={y + 43} fontSize="12" fontWeight={700} fill={st.state === "NO AUTHORITY" ? C.faint : color} fontFamily={SANS} textAnchor="end" letterSpacing="0.08em">
              {st.state === "ALLOWED" ? "ACCESS GRANTED" : st.state === "ISOLATED" ? "ISOLATED" : st.state === "NO AUTHORITY" ? "NO ACCESS" : st.state}
            </text>
            {sub && (
              <text x={ROW_X + 18} y={y + 61} fontSize="11.5" fill={st.denied ? C.deny : isolated ? C.isolated : C.stepup} fontFamily={SANS}>
                {sub}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
