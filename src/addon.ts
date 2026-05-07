// src/addon.ts
import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { fetchGraphData, GraphData } from "./modules/neo4j";
import { extractZoteroItems, callCloudService, saveToNeo4j, ProcessedArticle, GraphEdge } from "./modules/pipeline";

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
    // Tulajdonság a gráf adatok ideiglenes tárolására
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

  /**
   * Lekéri a gráf adatokat és megnyitja a vizualizációs ablakot
   */
  public async openGraphWindow() {
    try {
      const graphData = await fetchGraphData();
      this.data.graphData = graphData;

      const mainWindow = Zotero.getMainWindow();
      if (mainWindow) {
        mainWindow.open(
          `chrome://${this.data.config.addonRef}/content/graph.html`,
          "neo4j-graph-window",
          "chrome,centerscreen,width=800,height=600,resizable=yes"
        );
      }
    } catch (error) {
      ztoolkit.log("Error opening graph window: ", error);
    }
  }

  /**
   * Csővezeték indítása: Zotero -> AI -> Neo4j -> Megjelenítés
   */
  public async runAiPipelineAndVisualize() {
    try {
      ztoolkit.log("1. Zotero cikkek beolvasása...");
      const items = await extractZoteroItems();
      
      const processedArticles: ProcessedArticle[] = [];
      const edges: GraphEdge[] = [];
      
      // Korlátozzuk 5 cikkre a demonstráció kedvéért
      const limit = Math.min(items.length, 5); 
      //const limit = items.length;
      
      ztoolkit.log("2. Felhőszolgáltatás (AI) hívása...");
      for (let i = 0; i < limit; i++) {
        const item = items[i];
        const summary = await callCloudService(item.title, item.text);
        processedArticles.push({
          id: item.id,
          title: item.title,
          year: item.year,
          summary: summary
        });
      }

      ztoolkit.log("3. Élek (kapcsolatok) generálása...");
      const relationshipTypes = ["EXTENDS", "REFUTES", "SUPPORTS", "APPLIES", "COMPARES", "REVIEWS", "CRITIQUES"];
      for (let i = 0; i < processedArticles.length - 1; i++) {
        const randomType = relationshipTypes[Math.floor(Math.random() * relationshipTypes.length)];
        edges.push({
          sourceId: processedArticles[i].id,
          targetId: processedArticles[i+1].id,
          type: randomType
        });
      }

      ztoolkit.log("4. Mentés a Neo4j adatbázisba...");
      await saveToNeo4j(processedArticles, edges);

      ztoolkit.log("5. Gráf megjelenítése...");
      this.openGraphWindow(); 

    } catch (error) {
      ztoolkit.log("Hiba a pipeline során: ", error);
    }
  }
}

export default Addon;