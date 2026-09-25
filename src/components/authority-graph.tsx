"use client";

import type { AuthorityGraph, GraphEdge, GraphNode } from "@/lib/snapshot";

const W = 1010;
const H = 520;

// Fixed layout: no physics, no reflow. Positions are keyed by server node id.
const POS: Record<string, { x: number; y: number; w: number; h: number }> = {
  "entity-a": { x: 130, y: 90, w: 200, h: 64 },
  "agent-47": { x: 130, y: 270, w: 200, h: 64 },
  "entity-c": { x: 130, y: 450, w: 200, h: 56 },
  "mission-024": { x: 480, y: 90, w: 210, h: 64 },
  lease: { x: 480, y: 270, w: 230, h: 72 },
  "entity-b": { x: 830, y: 90, w: 200, h: 64 },
  "telemetry-b": { x: 830, y: 235, w: 210, h: 56 },
  "connector-b-17": { x: 830, y: 345, w: 210, h: 56 },
  "citizen-records-b": { x: 830, y: 455, w: 210, h: 56 },
};

const EDGE_STYLE: Record<GraphEdge["kind"], { stroke: string; dash?: string; width: number; glow?: boolean }> = {
  AFFILIATION: { stroke: "#3f4b5c", width: 1.2, dash: "3 4" },
  OWNS: { stroke: "#3f4b5c", width: 1.2, dash: "3 4" },
  DECLARED: { stroke: "#9aa8bd", width: 1.4 },
  PROPOSED: { stroke: "#a78bfa", width: 1.6, dash: "6 5" },
  ISSUER_APPROVED: { stroke: "#60a5fa", width: 1.8 },
  RECEIVER_ACCEPTED: { stroke: "#34d399", width: 1.8 },
  HOLDS: { stroke: "#e2e8f0", width: 1.6 },
  ACTIVE_AUTHORITY: { stroke: "#34d399", width: 2.4, glow: true },
  POLICY_DENIED: { stroke: "#f87171", width: 1.6, dash: "2 4" },
};

function anchor(from: string, to: string) {
  const a = POS[from];
  const b = POS[to];
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Same-column vertical edges bulge outward so they don't cross intermediate nodes.
  if (Math.abs(dx) < 1 && Math.abs(dy) > 120) {
    const side = a.x < 300 ? -1 : 1;
    const bulge = side * (a.w / 2 + 18 + Math.abs(dy) / 12);
    const start = { x: a.x + side * (a.w / 2), y: a.y + (dy > 0 ? 12 : -12) };
    const end = { x: b.x + side * (b.w / 2), y: b.y + (dy > 0 ? -12 : 12) };
    return { start, end, c1: { x: a.x + bulge, y: start.y }, c2: { x: b.x + bulge, y: end.y }, labelX: a.x + bulge * 0.62 };
  }
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const start = horizontal
    ? { x: a.x + (dx > 0 ? a.w / 2 : -a.w / 2), y: a.y }
    : { x: a.x, y: a.y + (dy > 0 ? a.h / 2 : -a.h / 2) };
  const end = horizontal
    ? { x: b.x + (dx > 0 ? -b.w / 2 : b.w / 2), y: b.y }
    : { x: b.x, y: b.y + (dy > 0 ? -b.h / 2 : b.h / 2) };
  const c1 = horizontal ? { x: (start.x + end.x) / 2, y: start.y } : { x: start.x, y: (start.y + end.y) / 2 };
  const c2 = horizontal ? { x: (start.x + end.x) / 2, y: end.y } : { x: end.x, y: (start.y + end.y) / 2 };
  return { start, end, c1, c2, labelX: null as number | null };
}

function nodeColors(n: GraphNode, dim: boolean) {
  if (dim) return { fill: "#0f141c", stroke: "#26303f", text: "#5b6a80", sub: "#42506a" };
  switch (n.kind) {
    case "agent":
      return { fill: "#111827", stroke: "#e2e8f0", text: "#f8fafc", sub: "#94a3b8" };
    case "mission":
      return n.status === "DECLARED"
        ? { fill: "#1f1220", stroke: "#fb7185", text: "#fecdd3", sub: "#fda4af" }
        : { fill: "#131820", stroke: "#3b4658", text: "#94a3b8", sub: "#64748b" };
    case "lease":
      if (n.status === "ACTIVE") return { fill: "#052e22", stroke: "#34d399", text: "#d1fae5", sub: "#6ee7b7" };
      if (n.status === "REVOKED" || n.status === "EXPIRED") return { fill: "#2a0f12", stroke: "#f87171", text: "#fecaca", sub: "#fca5a5" };
      if (n.status === "ISSUER_APPROVED") return { fill: "#0f1a2e", stroke: "#60a5fa", text: "#dbeafe", sub: "#93c5fd" };
      if (n.status === "PROPOSED") return { fill: "#1a1330", stroke: "#a78bfa", text: "#ede9fe", sub: "#c4b5fd" };
      return { fill: "#0f141c", stroke: "#34405a", text: "#7b8aa6", sub: "#55637c", dashed: true };
    case "resource":
      if (n.status === "ISOLATED") return { fill: "#2a1508", stroke: "#fb923c", text: "#ffedd5", sub: "#fdba74" };
      return { fill: "#0f172a", stroke: "#475569", text: "#e2e8f0", sub: "#94a3b8" };
    default:
      return { fill: "#0f172a", stroke: "#64748b", text: "#e2e8f0", sub: "#94a3b8" };
  }
}

export function AuthorityGraphView({ graph, highlight }: { graph: AuthorityGraph; highlight: string | null }) {
  const nodes = graph.nodes.filter((n) => POS[n.id]);
  const edges = graph.edges.filter((e) => POS[e.from] && POS[e.to]);
  const hasActive = edges.some((e) => e.kind === "ACTIVE_AUTHORITY");
  // Parallel labelled edges between the same pair fan out vertically so labels never overlap.
  const pairCounts = new Map<string, number>();
  const pairIndex = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === "AFFILIATION" || e.kind === "OWNS") continue;
    const k = `${e.from}>${e.to}`;
    pairIndex.set(e.id, pairCounts.get(k) ?? 0);
    pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Authority graph derived from server state">
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#141a24" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      <g fontFamily="var(--font-geist-mono)" fontSize="10" fill="#4b5a70" letterSpacing="1.5">
        <text x={130} y={30} textAnchor="middle">REQUESTING AGENCY</text>
        <text x={480} y={30} textAnchor="middle">AUTHORITY</text>
        <text x={830} y={30} textAnchor="middle">RESOURCE OWNER · ENTITY B</text>
      </g>

      {edges.map((e) => {
        const g = anchor(e.from, e.to);
        if (!g) return null;
        const n = pairCounts.get(`${e.from}>${e.to}`) ?? 1;
        const i = pairIndex.get(e.id) ?? 0;
        const off = (i - (n - 1) / 2) * 16;
        if (off !== 0 && !g.labelX) {
          g.start = { x: g.start.x, y: g.start.y + off };
          g.end = { x: g.end.x, y: g.end.y + off };
          g.c1 = { x: g.c1.x, y: g.c1.y + off };
          g.c2 = { x: g.c2.x, y: g.c2.y + off };
        }
        const s = EDGE_STYLE[e.kind];
        const d = `M ${g.start.x} ${g.start.y} C ${g.c1.x} ${g.c1.y}, ${g.c2.x} ${g.c2.y}, ${g.end.x} ${g.end.y}`;
        const structural = e.kind === "AFFILIATION" || e.kind === "OWNS";
        const mid = g.labelX
          ? { x: g.labelX, y: Math.min(g.start.y, g.end.y) + 34 }
          : { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 + (n > 1 ? off * 0.9 : 0) };
        return (
          <g key={e.id} className="transition-opacity duration-300">
            <path
              d={d}
              fill="none"
              stroke={s.stroke}
              strokeWidth={s.width}
              strokeDasharray={s.dash}
              markerEnd={structural ? undefined : "url(#arrow)"}
              filter={s.glow ? "url(#glow)" : undefined}
              className={e.kind === "ACTIVE_AUTHORITY" ? "qalaa-flow" : undefined}
            />
            {!structural && (
              <text x={mid.x} y={mid.y - 6} textAnchor={g.labelX ? "start" : "middle"} transform={g.labelX ? `rotate(90 ${mid.x} ${mid.y - 6})` : undefined} fontSize="9.5" fill={s.stroke} fontFamily="var(--font-geist-mono)">
                {e.label.length > 34 ? `${e.label.slice(0, 33)}…` : e.label}
                {e.gated ? " · human-gated" : ""}
              </text>
            )}
          </g>
        );
      })}

      {nodes.map((n) => {
        const p = POS[n.id];
        const dim = n.id === "entity-c";
        const c = nodeColors(n, dim);
        const isHighlight = highlight === n.id;
        const isEmptyLease = n.kind === "lease" && n.status === "NONE";
        return (
          <g key={n.id} transform={`translate(${p.x - p.w / 2}, ${p.y - p.h / 2})`}>
            <rect
              width={p.w}
              height={p.h}
              rx={8}
              fill={c.fill}
              stroke={isHighlight ? "#fbbf24" : c.stroke}
              strokeWidth={isHighlight ? 2.2 : 1.4}
              strokeDasharray={isEmptyLease ? "5 4" : undefined}
              filter={n.kind === "lease" && n.status === "ACTIVE" ? "url(#glow)" : undefined}
            />
            <text x={12} y={22} fontSize="12.5" fontWeight={600} fill={c.text} fontFamily="var(--font-geist-sans)">
              {n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label}
            </text>
            <text x={12} y={40} fontSize="10" fill={c.sub} fontFamily="var(--font-geist-mono)">
              {n.sublabel.length > 36 ? `${n.sublabel.slice(0, 35)}…` : n.sublabel}
            </text>
            <text x={p.w - 10} y={p.h - 8} textAnchor="end" fontSize="9" fill={c.sub} fontFamily="var(--font-geist-mono)" letterSpacing="1">
              {n.status}
            </text>
          </g>
        );
      })}

      {!hasActive && (
        <text x={W / 2} y={H - 14} textAnchor="middle" fontSize="10" fill="#4b5a70" fontFamily="var(--font-geist-mono)" letterSpacing="1.5">
          NO CROSS-AGENCY AUTHORITY EDGES
        </text>
      )}
    </svg>
  );
}
