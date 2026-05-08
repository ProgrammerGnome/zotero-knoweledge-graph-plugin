// src/addon.ts
import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { fetchGraphData, GraphData } from "./modules/neo4j";
import { extractZoteroItems, runCloudPipeline } from "./modules/pipeline";

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
    // 1. Ablak inicializálása címmel és ikonnal
    const pw = new this.data.ztoolkit.ProgressWindow("Zotero AI Tudástérkép", {
      closeOnClick: false,
      closeTime: -1, // <--- EZ A KULCS! Letiltja az automatikus bezáródást
    });
    
    // Kezdő sor beállítása homokóra ikonnal ("info" típus)
    const mainLine = pw.createLine({
      text: "Pipeline indítása...",
      type: "info",
      progress: 0 // Megjelenik a kék progress bar
    });
    
    pw.show();

    try {
      // 1. fázis: Cikkek beolvasása
      mainLine.changeLine({
        text: "Cikkek beolvasása a könyvtárból...",
        progress: 20
      });
      const items = await extractZoteroItems();
      const limitedItems = items.slice(0, 5); 
      
      // 2. fázis: Felhő alapú elemzés
      mainLine.changeLine({
        text: `AI elemzés folyamatban (${limitedItems.length} cikk)...`,
        progress: 50
      });
      
      // Alsor hozzáadása a részletesebb infóhoz
      const subLine = pw.createLine({
        text: "Kapcsolatok keresése a Neo4j-ben...",
        type: "info"
      });

      // Itt most már nem fog eltűnni az ablak várakozás közben!
      await runCloudPipeline(limitedItems);

      // 3. fázis: Vizualizáció előkészítése
      mainLine.changeLine({
        text: "Gráf renderelése...",
        progress: 90
      });
      subLine.changeLine({
        text: "Adatok sikeresen feldolgozva.",
        type: "success" // Pipa ikon
      });

      await this.openGraphWindow(); 

      // Befejezés: 100% és bezárás rövid késleltetéssel
      mainLine.changeLine({
        text: "Kész!",
        progress: 100
      });
      
      // Rövid várakozás, hogy látható legyen a siker
      setTimeout(() => pw.close(), 800);

    } catch (error: any) { 
      // Hiba kezelése piros ikonnal
      mainLine.changeLine({
        text: "Hiba történt!",
        type: "error",
        progress: 0
      });
      
      // Részletes hiba kiírása egy új sorba
      pw.createLine({
        text: error?.message || String(error) || "Ismeretlen hiba a pipeline során.",
        type: "error"
      });

      // A hiba ablaknál is be kell állítani az automatikus bezárást, mert a -1 miatt amúgy örökre ott maradna
      pw.startCloseTimer(8000); 
    }
  }
}

export default Addon;