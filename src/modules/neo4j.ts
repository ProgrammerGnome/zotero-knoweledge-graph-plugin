// src/modules/neo4j.ts

// IDE IS ILLYESZD BE A GOOGLE CLOUD RUN TRIGGER URL-EDET:
const CLOUD_FUNCTION_URL = "https://zotero-plugin-189833862333.us-central1.run.app";

export interface GraphNode {
  id: string;
  label: string;
  title: string;
  year: string;
  summary: string;
  type: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchGraphData(): Promise<GraphData> {
  ztoolkit.log("Gráf adatok lekérése a felhőből...");
  try {
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "omit"
    });
    
    if (!response.ok) throw new Error("Hálózati hiba a felhő lekérdezésekor.");
    const json = (await response.json()) as any;
    
    return {
      nodes: json.nodes || [],
      edges: json.edges || []
    };
  } catch (error) {
    ztoolkit.log("Hiba a gráf lekérésekor:", error);
    return { nodes: [], edges: [] };
  }
}