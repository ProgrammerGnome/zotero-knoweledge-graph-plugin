// src/addon.ts
import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { fetchGraphData, GraphData } from "./modules/neo4j";
import { extractZoteroItems, runCloudPipeline, fetchRelatedPapersFromWeb } from "./modules/pipeline";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    dialog?: DialogHelper;
    graphData?: GraphData;
  };
  public hooks: typeof hooks;
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }

  public async openGraphWindow() {
    try {
      const graphData = await fetchGraphData();
      this.data.graphData = graphData;

      const mainWindow = Zotero.getMainWindow();
      if (mainWindow) {
        mainWindow.open(
          `chrome://${this.data.config.addonRef}/content/graph.html`,
          "neo4j-graph-window",
          "chrome,centerscreen,width=1000,height=800,resizable=yes"
        );
      }
    } catch (error) {
      ztoolkit.log("Error opening graph window: ", error);
    }
  }

  public async runAiPipelineAndVisualize() {
    // 1. GUI bekérés a cikkek számára
    const mainWindow = Zotero.getMainWindow();
    let limit = 10; // Alapértelmezett érték
    
    if (mainWindow) {
      const result = mainWindow.prompt("Hány cikket szeretnél elemezni a helyi könyvtárból?", "10");
      if (result === null) return; // Ha a felhasználó a Mégse gombra kattint, kilépünk
      
      const parsed = parseInt(result, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = parsed;
      } else {
        mainWindow.alert("Kérlek érvényes, nullánál nagyobb számot adj meg!");
        return;
      }
    }

    // 2. Ablak inicializálása címmel és ikonnal
    const pw = new this.data.ztoolkit.ProgressWindow("Zotero AI Tudástérkép", {
      closeOnClick: false,
      closeTime: -1,
    });
    
    const mainLine = pw.createLine({
      text: "Pipeline indítása...",
      type: "info",
      progress: 0 
    });
    
    pw.show();

    try {
      mainLine.changeLine({
        text: `Cikkek beolvasása a könyvtárból (max ${limit} db)...`,
        progress: 20
      });
      const items = await extractZoteroItems();
      
      // ITT HASZNÁLJUK A GUI-RÓL BEKÉRT ÉRTÉKET
      const limitedItems = items.slice(0, limit); 
      
      mainLine.changeLine({
        text: `AI elemzés folyamatban (${limitedItems.length} cikk)...`,
        progress: 50
      });
      
      const subLine = pw.createLine({
        text: "Kapcsolatok keresése a Neo4j-ben...",
        type: "info"
      });

      await runCloudPipeline(limitedItems);

      mainLine.changeLine({
        text: "Gráf renderelése...",
        progress: 90
      });
      subLine.changeLine({
        text: "Adatok sikeresen feldolgozva.",
        type: "success" 
      });

      await this.openGraphWindow(); 

      mainLine.changeLine({
        text: "Kész!",
        progress: 100
      });
      
      setTimeout(() => pw.close(), 800);

    } catch (error: any) { 
      mainLine.changeLine({
        text: "Hiba történt!",
        type: "error",
        progress: 0
      });
      
      pw.createLine({
        text: error?.message || String(error) || "Ismeretlen hiba a pipeline során.",
        type: "error"
      });

      pw.startCloseTimer(8000); 
    }
  }

  public async expandKnowledgeGraph() {
    // 1. GUI bekérés a cikkek számára
    const mainWindow = Zotero.getMainWindow();
    let limit = 3; // Alapértelmezett érték
    
    if (mainWindow) {
      const result = mainWindow.prompt("Hány helyi báziscikket használjunk a webes kereséshez?", "3");
      if (result === null) return; // Mégse gomb megnyomva
      
      const parsed = parseInt(result, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = parsed;
      } else {
        mainWindow.alert("Kérlek érvényes, nullánál nagyobb számot adj meg!");
        return;
      }
    }

    const pw = new this.data.ztoolkit.ProgressWindow("Zotero AI Gráf Bővítése", {
      closeOnClick: false,
      closeTime: -1, 
    });
    
    const mainLine = pw.createLine({ text: "Bázis cikkek kiválasztása...", type: "info", progress: 10 });
    pw.show();

    try {
      const localItems = await extractZoteroItems();
      if (localItems.length === 0) throw new Error("Nincs helyi cikk, amiből kiindulhatnánk.");
      
      // ITT HASZNÁLJUK A GUI-RÓL BEKÉRT ÉRTÉKET
      const limitedLocal = localItems.slice(0, limit); 

      mainLine.changeLine({ text: "Hasonló cikkek keresése az OpenAlex adatbázisban...", progress: 30 });
      const titlesToSearch = limitedLocal.map(item => item.title);
      const webArticles = await fetchRelatedPapersFromWeb(titlesToSearch);

      if (webArticles.length === 0) {
        mainLine.changeLine({ text: "Nem találtam megfelelő új cikket.", type: "error", progress: 100 });
        pw.startCloseTimer(4000);
        return;
      }

      mainLine.changeLine({ text: `AI elemzés (${webArticles.length} webes cikk)...`, progress: 60 });
      const subLine = pw.createLine({ text: "Kapcsolatok keresése és mentés a Neo4j-be...", type: "info" });

      await runCloudPipeline(webArticles);

      mainLine.changeLine({ text: "Bővített gráf renderelése...", progress: 90 });
      subLine.changeLine({ text: "Adatok sikeresen feldolgozva.", type: "success" });

      await this.openGraphWindow(); 

      mainLine.changeLine({ text: "Kész!", progress: 100 });
      setTimeout(() => pw.close(), 800);

    } catch (error: any) { 
      mainLine.changeLine({ text: "Hiba történt a bővítés során!", type: "error", progress: 0 });
      pw.createLine({ text: error?.message || String(error), type: "error" });
      pw.startCloseTimer(8000); 
    }
  }
}

export default Addon;