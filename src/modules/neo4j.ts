// src/modules/neo4j.ts

export interface GraphNode {
  id: string;
  label: string; // "Cím (Év)" formátumra fogjuk használni
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

/**
 * Valódi Neo4j adatbázis kapcsolat localhoston a Neo4j HTTP API-n keresztül.
 */
export async function fetchGraphData(): Promise<GraphData> {
  ztoolkit.log("Lekérdezés indítása a valódi Neo4j adatbázis felé...");

  // --- NEO4J BEÁLLÍTÁSOK ---
  // A Docker konténer alapértelmezett adatbázisa a 'neo4j'
  const dbUrl = "http://localhost:7474/db/neo4j/tx/commit"; 
  const username = "neo4j";
  const password = "zotero123"; // A Docker parancsban megadott jelszó

  // JAVÍTÁS 1: Sima JavaScript objektum használata a Headers objektum helyett
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": "Basic " + btoa(username + ":" + password)
  };

  // Cypher lekérdezés: Lekéri a gráfot (maximum 100 kapcsolatig)
  const cypherQuery = `
    MATCH (n)-[r]->(m)
    RETURN n, r, m
    LIMIT 100
  `;

  // A kérés törzse, amely a "graph" adatformátumot kéri a Neo4j-től
  const body = JSON.stringify({
    statements: [
      {
        statement: cypherQuery,
        resultDataContents: ["graph"]
      }
    ]
  });

  try {
    const response = await fetch(dbUrl, {
      method: "POST",
      headers: headers,
      body: body
    });

    if (!response.ok) {
      throw new Error(`Neo4j HTTP hiba! Státusz: ${response.status}`);
    }

    // JAVÍTÁS 2: "as any" hozzáadása, hogy a TypeScript ne panaszkodjon a típusokra
    const json = (await response.json()) as any;

    // Ha a Neo4j hibát dobott (pl. rossz jelszó vagy szintaxis)
    if (json.errors && json.errors.length > 0) {
      throw new Error("Neo4j lekérdezési hiba: " + JSON.stringify(json.errors));
    }

    const nodesMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    // Neo4j 'graph' formátumának feldolgozása
    const data = json.results[0].data;
    
    data.forEach((row: any) => {
      const graph = row.graph;
      
      // Csomópontok feldolgozása
      graph.nodes.forEach((n: any) => {
        if (!nodesMap.has(n.id)) {
          const title = n.properties.title || "Névtelen cikk";
          const year = n.properties.year || "????";
          const summary = n.properties.summary || "Nincs elérhető összefoglaló.";
          
          nodesMap.set(n.id, {
            id: String(n.id),
            title: title,
            year: year,
            label: `${title.substring(0, 20)}... (${year})`, // Cím rövidítve + Évszám
            summary: summary,
            type: n.labels && n.labels.length > 0 ? n.labels[0] : "Article"
          });
        }
      });

      // Élek feldolgozása
      graph.relationships.forEach((r: any) => {
        edges.push({
          source: String(r.startNode),
          target: String(r.endNode),
          type: r.type
        });
      });
    });

    ztoolkit.log(`Sikeres lekérdezés: ${nodesMap.size} node, ${edges.length} él.`);

    return {
      nodes: Array.from(nodesMap.values()),
      edges: edges
    };

  } catch (error) {
    ztoolkit.log("Kritikus hiba a Neo4j lekérdezés során: ", error);
    return { nodes: [], edges: [] };
  }
}