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
    locale?: { current: any; };
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
    const mainWindow = Zotero.getMainWindow();
    const zoteroPane = Zotero.getActiveZoteroPane();
    
    // Kijelölt cikkek lekérése a Zotero felületéről
    const selectedItems = zoteroPane ? zoteroPane.getSelectedItems() : [];
    const regularItems = selectedItems.filter((item: any) => item.isRegularItem());

    if (regularItems.length === 0) {
      if (mainWindow) mainWindow.alert("Kérlek, jelölj ki egy vagy több cikket a Zotero listában az elemzéshez!");
      return;
    }

    const pw = new this.data.ztoolkit.ProgressWindow("Zotero AI Tudástérkép", {
      closeOnClick: false,
      closeTime: -1,
    });
    
    const mainLine = pw.createLine({ text: "Pipeline indítása...", type: "info", progress: 0 });
    pw.show();

    try {
      mainLine.changeLine({ text: `Kijelölt cikkek beolvasása (${regularItems.length} db)...`, progress: 20 });
      
      // Csak a kijelölt cikkeket olvassuk be
      const limitedItems = await extractZoteroItems(regularItems); 
      
      mainLine.changeLine({ text: `AI elemzés folyamatban (${limitedItems.length} cikk)...`, progress: 50 });
      const subLine = pw.createLine({ text: "Kapcsolatok keresése a Neo4j-ben...", type: "info" });

      await runCloudPipeline(limitedItems);

      mainLine.changeLine({ text: "Gráf renderelése...", progress: 90 });
      subLine.changeLine({ text: "Adatok sikeresen feldolgozva.", type: "success" });

      await this.openGraphWindow(); 

      mainLine.changeLine({ text: "Kész!", progress: 100 });
      setTimeout(() => pw.close(), 800);

    } catch (error: any) { 
      mainLine.changeLine({ text: "Hiba történt!", type: "error", progress: 0 });
      pw.createLine({ text: error?.message || String(error), type: "error" });
      pw.startCloseTimer(8000); 
    }
  }

  public async expandKnowledgeGraph() {
    const mainWindow = Zotero.getMainWindow();
    const zoteroPane = Zotero.getActiveZoteroPane();
    
    // Kijelölt cikkek lekérése a Zotero felületéről
    const selectedItems = zoteroPane ? zoteroPane.getSelectedItems() : [];
    const regularItems = selectedItems.filter((item: any) => item.isRegularItem());

    if (regularItems.length === 0) {
      if (mainWindow) mainWindow.alert("Kérlek, jelölj ki a Zoteroban legalább 1 cikket bázisként a webes kereséshez!");
      return;
    }
    if (regularItems.length > 3) {
      if (mainWindow) mainWindow.alert("Kérlek, maximum 3 cikket jelölj ki, hogy ne lépd túl a Google API kvótáját!");
      return;
    }

    const pw = new this.data.ztoolkit.ProgressWindow("Zotero AI Gráf Bővítése", {
      closeOnClick: false,
      closeTime: -1, 
    });
    
    const mainLine = pw.createLine({ text: "Kijelölt bázis cikkek beolvasása...", type: "info", progress: 10 });
    pw.show();

    try {
      // 1. Kijelölt HELYI cikkek beolvasása
      const localArticles = await extractZoteroItems(regularItems);
      if (localArticles.length === 0) throw new Error("Nem sikerült beolvasni a cikkeket.");

      // 2. WEBES cikkek keresése a kijelöltek alapján
      mainLine.changeLine({ text: "Hasonló cikkek keresése az OpenAlex adatbázisban...", progress: 30 });
      const titlesToSearch = localArticles.map(item => item.title);
      const webArticles = await fetchRelatedPapersFromWeb(titlesToSearch);

      if (webArticles.length === 0) {
        mainLine.changeLine({ text: "Nem találtam megfelelő új cikket.", type: "error", progress: 100 });
        pw.startCloseTimer(4000);
        return;
      }

      mainLine.changeLine({ text: `AI elemzés (${localArticles.length} helyi + ${webArticles.length} webes cikk)...`, progress: 60 });
      const subLine = pw.createLine({ text: "Kapcsolatok keresése és mentés a Neo4j-be...", type: "info" });

      // ÚJ ÉS FONTOS: Összefűzzük a helyi és a webes cikkeket! 
      // Így az LLM a felhőben egyszerre látja mindkettőt, és létrehozza köztük a kapcsolatokat!
      const combinedArticles = [...localArticles, ...webArticles];

      await runCloudPipeline(combinedArticles);

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