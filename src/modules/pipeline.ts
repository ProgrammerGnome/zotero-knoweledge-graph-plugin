// src/modules/pipeline.ts

// IDE ILLYESZD BE A GOOGLE CLOUD RUN TRIGGER URL-EDET:
//const CLOUD_FUNCTION_URL = "https://zotero-plugin-189833862333.us-central1.run.app";
const CLOUD_FUNCTION_URL = "https://zotero-content-graph-plugin-function-189833862333.us-central1.run.app";

export async function extractZoteroItems(): Promise<{id: string, title: string, year: string, text: string, origin: string}[]> {
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
        text: textContent.substring(0, 8000),
        origin: "local" // <--- ÚJ: Megjelöljük helyi cikként
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
      credentials: "omit", 
      body: JSON.stringify({ articles })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Szerver HTTP hiba! Státusz: ${response.status}. Részletek: ${errorText}`);
    }

    const result = (await response.json()) as any;
    if (!result.success) throw new Error(result.error);
    ztoolkit.log("Felhő feldolgozás sikeres!");
  } catch (error: any) {
    ztoolkit.log("Hiba a Cloud Function hívásakor: " + (error.message || String(error)));
    throw error;
  }
}

// 1. Segédfüggvény a nagyon rövid várakozáshoz
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2. Segédfüggvény az OpenAlex absztraktok visszaállításához
function reconstructAbstract(invertedIndex: any): string | null {
  if (!invertedIndex) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions as number[]) {
      words[pos] = word;
    }
  }
  return words.filter(w => w !== undefined).join(' ');
}

// 3. Főfüggvény a kereséshez (OpenAlex verzió)
export async function fetchRelatedPapersFromWeb(titles: string[]): Promise<any[]> {
  ztoolkit.log("Keresés a weben hasonló cikkek után (OpenAlex)...");
  const relatedArticles = [];
  
  // !!! KÉRLEK ÍRD ÁT A SAJÁT EMAIL CÍMEDRE !!!
  const YOUR_EMAIL = "hallgato@uni.hu"; 
  const mailtoParam = `mailto=${YOUR_EMAIL}`;

  for (const title of titles) {
    try {
      ztoolkit.log(`Keresés az OpenAlex-ben: "${title}"`);
      
      if (title === "Ismeretlen cím" || title.length < 5) {
          ztoolkit.log("Kihagyva: Érvénytelen cím.");
          continue;
      }

      const query = encodeURIComponent(title);
      const searchUrl = `https://api.openalex.org/works?search=${query}&per-page=1&${mailtoParam}`;
      
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) continue;
      
      const searchData = (await searchRes.json()) as any;
      if (!searchData.results || searchData.results.length === 0) continue;

      const work = searchData.results[0];
      const openAlexId = work.id;
      
      const relatedWorksUrls = work.related_works;
      if (!relatedWorksUrls || relatedWorksUrls.length === 0) continue;

      const topRelatedIds = relatedWorksUrls.slice(0, 3).map((url: string) => url.split('/').pop());
      const filterParam = `openalex:${topRelatedIds.join('|')}`;
      const recUrl = `https://api.openalex.org/works?filter=${filterParam}&${mailtoParam}`;
      
      const recRes = await fetch(recUrl);
      if (!recRes.ok) continue;
      
      const recData = (await recRes.json()) as any;

      if (recData.results && recData.results.length > 0) {
        for (const paper of recData.results) {
          const abstractText = reconstructAbstract(paper.abstract_inverted_index);
          if (abstractText) {
            relatedArticles.push({
              id: `OA_${paper.id.split('/').pop()}`,
              title: paper.title,
              year: paper.publication_year ? String(paper.publication_year) : "Ismeretlen",
              text: `[Webről importálva OpenAlex API-n keresztül] ${abstractText}`,
              origin: "web" // <--- ÚJ: Megjelöljük webről érkezettként
            });
            ztoolkit.log(`+ Hozzáadva: ${paper.title}`);
          }
        }
      }
      await delay(500);

    } catch (e) {
      ztoolkit.log("Hiba az OpenAlex keresés során: " + e);
    }
  }
  
  ztoolkit.log(`Webes keresés befejezve. Összesen ${relatedArticles.length} db használható cikket találtunk.`);
  return relatedArticles;
}