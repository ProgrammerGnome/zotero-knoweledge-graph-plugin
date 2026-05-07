// src/modules/pipeline.ts

export interface ProcessedArticle {
  id: string;
  title: string;
  year: string;
  summary: string;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  type: string;
}

export async function extractZoteroItems(): Promise<{id: string, title: string, year: string, text: string}[]> {
  ztoolkit.log("Zotero elemek lekérdezése...");
  const items = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true, false);
  const results = [];

  for (const item of items) {
    if (item.isRegularItem()) {
      const title = item.getField("title") || "Ismeretlen cím";
      const date = item.getField("date") || "Ismeretlen év";
      const year = date.match(/\d{4}/)?.[0] || date;
      
      let textContent = "";
      const attachment = await item.getBestAttachment();
      
      if (attachment && attachment.isPDFAttachment()) {
        try {
            // Zotero 7+ kompatibilis szövegkinyerés
            const content = await (Zotero.Fulltext as any).getContent(attachment.id);
            textContent = content?.text || item.getField("abstractNote") || "";
        } catch (e) {
            textContent = item.getField("abstractNote") || "";
        }
      } else {
          textContent = item.getField("abstractNote") || "";
      }
      
      results.push({
        id: item.key,
        title: title,
        year: year,
        text: textContent.substring(0, 10000)
      });
    }
  }
  return results;
}

export async function callCloudService(title: string, text: string): Promise<string> {
  // === GCP VERTEX AI BEÁLLÍTÁSOK ===
  const PROJECT_ID = "zotero-content-graph-plugin"; 
  const LOCATION = "us-central1";
  const MODEL_ID = "gemini-1.5-flash-001";

  if (!text || text.length < 20) {
    return "Nincs elegendő szöveg az összefoglaláshoz.";
  }

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: `Írj erről a cikkről egy pontosan 2 mondatos magyar nyelvű összefoglalót.\nCím: ${title}\nSzöveg: ${text}` }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 200 }
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GCP_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      credentials: "omit", // Fontos: Sütik mellőzése a sandbox hiba elkerülésére
      body: body
    });

    if (!response.ok) {
        const errorDetail = await response.text();
        ztoolkit.log("GCP Hiba részletei:", errorDetail);
        return "Hiba a felhőhívás során (Status: " + response.status + ")";
    }

    const json = (await response.json()) as any;
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "A modell nem adott választ.";
  } catch (error) {
    ztoolkit.log("Fetch hiba:", error);
    return "Hálózati hiba a GCP felé.";
  }
}

export async function saveToNeo4j(articles: ProcessedArticle[], edges: GraphEdge[]) {
  const dbUrl = "http://localhost:7474/db/neo4j/tx/commit"; 
  const auth = "Basic " + btoa("neo4j:zotero123"); 

  for (const art of articles) {
    const query = `MERGE (a:Article {id: $id}) SET a.title = $title, a.year = $year, a.summary = $summary`;
    await fetch(dbUrl, {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({ statements: [{ statement: query, parameters: art }] })
    });
  }

  for (const edge of edges) {
    const query = `MATCH (a:Article {id: "${edge.sourceId}"}) MATCH (b:Article {id: "${edge.targetId}"}) MERGE (a)-[:${edge.type}]->(b)`;
    await fetch(dbUrl, {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({ statements: [{ statement: query }] })
    });
  }
}