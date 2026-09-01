// Toy MCP server over the KeremNaBot Hebrew evidence graph (heb-graph/graph.json).
//
// Deliberately minimal: two read-only tools, no auth, no chat orchestration --
// the point is to prove the "publish the KB as an MCP server, let the user's
// own chat client do the reasoning" architecture end-to-end before building
// the full tool surface (English graph, excerpt/quote lookup, ontology
// queries, semantic search).
//
// Uses the MCP SDK directly (no Agents SDK / Durable Objects) since this is
// stateless: a fresh McpServer per request, graph data cached in the isolate
// across warm invocations. See examples/mcp-server in cloudflare/agents for
// the pattern this follows.

import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";

const GRAPH_URL =
  "https://raw.githubusercontent.com/yoavbendor/keremnabot/main/heb-graph/graph.json";

interface Entity {
  key: string;
  name: string;
  type: string;
  aliases?: string[];
  support?: number;
}

interface Relationship {
  source: string;
  target: string;
  type: string;
  source_name: string;
  target_name: string;
  evidence: string[];
  cross_boundary: boolean;
  scope: string;
  support?: number;
}

interface Graph {
  entities: Entity[];
  relationships: Relationship[];
}

let cachedGraph: Graph | null = null;

async function loadGraph(): Promise<Graph> {
  if (cachedGraph) return cachedGraph;
  const res = await fetch(GRAPH_URL);
  if (!res.ok) {
    throw new Error(`failed to fetch graph.json: ${res.status} ${res.statusText}`);
  }
  cachedGraph = (await res.json()) as Graph;
  return cachedGraph;
}

function relationshipCounts(graph: Graph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of graph.relationships) {
    counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
    counts.set(r.target, (counts.get(r.target) ?? 0) + 1);
  }
  return counts;
}

function createServer() {
  const server = new McpServer({
    name: "keremnabot-kb-toy",
    version: "0.1.0"
  });

  server.registerTool(
    "search_entities",
    {
      description:
        "Search the KeremNaBot Hebrew knowledge graph (built from 26 human-rights " +
        "reports on the West Bank) for entities whose name contains the given " +
        "substring (case-insensitive, Hebrew or English). Returns each match's " +
        "canonical key (needed for get_entity), type, and relationship count -- " +
        "use the key, not the name, when calling get_entity.",
      inputSchema: z.object({
        query: z.string().describe("Substring to search for in entity names."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results to return (default 10).")
      })
    },
    async ({ query, limit }) => {
      const graph = await loadGraph();
      const counts = relationshipCounts(graph);
      const q = query.toLowerCase();
      const matches = graph.entities
        .filter((e) => e.name.toLowerCase().includes(q))
        .sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0))
        .slice(0, limit ?? 10)
        .map((e) => ({
          key: e.key,
          name: e.name,
          type: e.type,
          relationships: counts.get(e.key) ?? 0
        }));
      return {
        content: [{ type: "text", text: JSON.stringify(matches, null, 2) }]
      };
    }
  );

  server.registerTool(
    "get_entity",
    {
      description:
        "Get one entity's full detail from the KeremNaBot Hebrew knowledge graph " +
        "by its exact canonical key (from search_entities): its type, and every " +
        "relationship it appears in with the relation type, the other endpoint's " +
        "name, and the source-document evidence chunk ids backing it.",
      inputSchema: z.object({
        key: z.string().describe("The entity's canonical key, as returned by search_entities.")
      })
    },
    async ({ key }) => {
      const graph = await loadGraph();
      const entity = graph.entities.find((e) => e.key === key);
      if (!entity) {
        return {
          content: [{ type: "text", text: `No entity found with key ${JSON.stringify(key)}.` }],
          isError: true
        };
      }
      const relations = graph.relationships
        .filter((r) => r.source === key || r.target === key)
        .map((r) => ({
          direction: r.source === key ? "outgoing" : "incoming",
          type: r.type,
          other_entity: r.source === key ? r.target_name : r.source_name,
          evidence_count: r.evidence.length,
          evidence: r.evidence
        }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { key: entity.key, name: entity.name, type: entity.type, relations },
              null,
              2
            )
          }
        ]
      };
    }
  );

  return server;
}

// A fresh server is created per request; graph data is cached at module scope
// across warm invocations of the same isolate. No auth: this serves only
// public, already-published report data (see the repo's KeremNavotHeb/ docs).
export default createMcpHandler(createServer);
