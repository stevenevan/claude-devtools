/**
 * FileGraphView - force-directed visualization of file interactions within a
 * session. Uses a minimal Verlet-style simulation inline (no external dep) to
 * keep install lean; scales comfortably to 200 nodes.
 *
 * Node size = total interaction count · color intensity = edit count.
 * Edge color keyed by op kind: read-to-edit / edit-to-write / co-access.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';
import { createLogger } from '@shared/utils/logger';

import type { FileGraphResponse } from '@shared/types';

const logger = createLogger('Component:FileGraphView');

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 360;
const SIM_ITERATIONS = 220;
const LINK_DISTANCE = 70;
const REPEL_STRENGTH = 240;
const CENTER_STRENGTH = 0.02;

const EDGE_COLOR: Record<string, string> = {
  'read-to-edit': '#38bdf8',
  'edit-to-write': '#f97316',
  'co-access': 'rgba(148,163,184,0.35)',
};

interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  radius: number;
  tint: string;
  interactions: number;
  turnIndices: number[];
}

interface LaidOutEdge {
  from: string;
  to: string;
  kind: string;
  weight: number;
}

function tintFor(node: FileGraphResponse['nodes'][number]): string {
  if (node.writeCount > 0) return '#f97316';
  if (node.editCount > 0) return '#38bdf8';
  return '#a1a1aa';
}

function radiusFor(interactions: number): number {
  return 6 + Math.min(18, Math.sqrt(interactions) * 2.5);
}

function layoutForceDirected(
  nodes: FileGraphResponse['nodes'],
  edges: FileGraphResponse['edges']
): LaidOutNode[] {
  const cx = CANVAS_WIDTH / 2;
  const cy = CANVAS_HEIGHT / 2;
  if (nodes.length === 0) return [];

  // Initialize on a circle around the center.
  const laid: LaidOutNode[] = nodes.map((n, i) => ({
    id: n.path,
    x: cx + Math.cos((2 * Math.PI * i) / nodes.length) * 80,
    y: cy + Math.sin((2 * Math.PI * i) / nodes.length) * 80,
    radius: radiusFor(n.totalInteractions),
    tint: tintFor(n),
    interactions: n.totalInteractions,
    turnIndices: n.turnIndices,
  }));

  const byId = new Map(laid.map((n) => [n.id, n]));

  for (let iter = 0; iter < SIM_ITERATIONS; iter++) {
    // Repel all pairs.
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i];
        const b = laid[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = REPEL_STRENGTH / dist2;
        const fx = (dx / Math.sqrt(dist2)) * force;
        const fy = (dy / Math.sqrt(dist2)) * force;
        a.x -= fx;
        a.y -= fy;
        b.x += fx;
        b.y += fy;
      }
    }

    // Spring for each edge toward LINK_DISTANCE.
    for (const e of edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b || a === b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const delta = (dist - LINK_DISTANCE) * 0.05;
      const fx = (dx / dist) * delta;
      const fy = (dy / dist) * delta;
      a.x += fx;
      a.y += fy;
      b.x -= fx;
      b.y -= fy;
    }

    // Gentle pull toward center.
    for (const node of laid) {
      node.x += (cx - node.x) * CENTER_STRENGTH;
      node.y += (cy - node.y) * CENTER_STRENGTH;
    }
  }

  // Clamp to canvas bounds.
  for (const node of laid) {
    node.x = Math.min(CANVAS_WIDTH - node.radius, Math.max(node.radius, node.x));
    node.y = Math.min(CANVAS_HEIGHT - node.radius, Math.max(node.radius, node.y));
  }
  return laid;
}

interface FileGraphViewProps {
  projectId: string;
  sessionId: string;
  onTurnClick?: (turnIndex: number) => void;
  className?: string;
}

export const FileGraphView = ({
  projectId,
  sessionId,
  onTurnClick,
  className,
}: Readonly<FileGraphViewProps>): React.JSX.Element | null => {
  const [data, setData] = useState<FileGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getFileGraph(projectId, sessionId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        logger.error('Failed to load file graph', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, sessionId]);

  const laid = useMemo(() => {
    if (!data) return [];
    return layoutForceDirected(data.nodes, data.edges);
  }, [data]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, LaidOutNode>();
    for (const n of laid) map.set(n.id, n);
    return map;
  }, [laid]);

  const laidEdges: LaidOutEdge[] = data?.edges ?? [];
  const hoveredNode = hoverId ? nodeMap.get(hoverId) : null;

  if (loading) {
    return (
      <div
        className={cn(
          'border-border bg-background/50 text-text-muted rounded-xs border p-6 text-center text-xs',
          className
        )}
      >
        Loading file graph…
      </div>
    );
  }
  if (error) {
    return (
      <div className={cn('border-border bg-background/50 rounded-xs border p-4', className)}>
        <p className="text-text-muted text-[11px]">File Graph</p>
        <p className="text-text-muted mt-2 text-[10px]">{error}</p>
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div
        className={cn(
          'border-border bg-background/50 text-text-muted rounded-xs border p-4 text-center text-xs',
          className
        )}
      >
        No file interactions in this session.
      </div>
    );
  }

  return (
    <div className={cn('border-border bg-background/50 rounded-xs border p-3', className)}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-text text-sm font-medium">File Graph</h3>
        <span className="text-text-muted text-[10px]">
          {data.nodes.length} files · {data.edges.length} edges
        </span>
      </div>
      <svg
        ref={svgRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="bg-surface-overlay/40 w-full rounded-xs"
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      >
        {laidEdges.map((e, i) => {
          const a = nodeMap.get(e.from);
          const b = nodeMap.get(e.to);
          if (!a || !b) return null;
          if (a === b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={EDGE_COLOR[e.kind] ?? 'rgba(148,163,184,0.25)'}
              strokeWidth={Math.min(3, 0.5 + Math.log2(e.weight + 1))}
            />
          );
        })}
        {laid.map((n) => (
          <circle
            key={n.id}
            cx={n.x}
            cy={n.y}
            r={n.radius}
            fill={n.tint}
            opacity={hoverId && hoverId !== n.id ? 0.35 : 0.8}
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={1}
            className="cursor-pointer"
            onMouseEnter={() => setHoverId(n.id)}
            onMouseLeave={() => setHoverId((prev) => (prev === n.id ? null : prev))}
          />
        ))}
      </svg>

      {hoveredNode && (
        <div className="border-border bg-surface-overlay mt-2 rounded-xs border px-3 py-2 text-[10px]">
          <div className="text-text truncate font-mono">{hoveredNode.id}</div>
          <div className="text-text-muted mt-1">
            {hoveredNode.interactions} interactions · turns:{' '}
            {hoveredNode.turnIndices.map((turn) => (
              <button
                key={turn}
                onClick={() => onTurnClick?.(turn)}
                className="hover:text-text ml-1 underline"
              >
                {turn + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
