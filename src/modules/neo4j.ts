const CLOUD_FUNCTION_URL = "https://zotero-content-graph-plugin-function-189833862333.us-central1.run.app";

export interface GraphNode {
  id: string;
  label: string;
  title: string;
  year: string;
  summary: string;
  origin: string;
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

export async function fetchGraphData(ids?: string[]): Promise<GraphData> {
  ztoolkit.log("Gráf adatok lekérése a felhőből...");
  try {
    let url = CLOUD_FUNCTION_URL;
    
    if (ids && ids.length > 0) {
      url += `?ids=${encodeURIComponent(ids.join(','))}`;
    }

    const response = await fetch(url, {
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