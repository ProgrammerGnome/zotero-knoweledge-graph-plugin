// src/modules/pipeline.ts

// IDE ILLYESZD BE A GOOGLE CLOUD RUN TRIGGER URL-EDET:
const CLOUD_FUNCTION_URL = "https://zotero-plugin-189833862333.us-central1.run.app";

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
        text: textContent.substring(0, 8000)
      });
    }
  }
  return results;
}

export async function runCloudPipeline(articles: any[]) {
  ztoolkit.log("Adatok küldése a Cloud Run mikroszolgáltatásnak...");
  try {
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit", // Kötelező a Zoteróban a CORS miatt
      body: JSON.stringify({ articles })
    });
    const result = (await response.json()) as any;
    if (!result.success) throw new Error(result.error);
    ztoolkit.log("Felhő feldolgozás sikeres!");
  } catch (error) {
    ztoolkit.log("Hiba a Cloud Function hívásakor:", error);
    throw error;
  }
}