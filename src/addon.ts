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
    try {
      /*
      ztoolkit.log("1. Zotero cikkek beolvasása...");
      const items = await extractZoteroItems();
      
      ztoolkit.log(`2. Adatok beküldése a felhőbe (${items.length} cikk)... Kérlek, várj!`);
      // Itt hívjuk a Cloud Run Function-t, ami elvégzi az AI és Neo4j folyamatokat
      await runCloudPipeline(items);
      */
     ztoolkit.log("1. Zotero cikkek beolvasása...");
      const items = await extractZoteroItems();
      
      // ÚJ: Korlátozzuk szigorúan 2 cikkre a limit túllépés elkerülése miatt!
      const limitedItems = items.slice(0, 2); 
      
      ztoolkit.log(`2. Adatok beküldése a felhőbe (${limitedItems.length} cikk)... Kérlek, várj!`);
      
      await runCloudPipeline(limitedItems);

      ztoolkit.log("3. Eredmény lekérése és Gráf megjelenítése...");
      this.openGraphWindow(); 

    } catch (error) {
      ztoolkit.log("Hiba a pipeline során: ", error);
    }
  }
}

export default Addon;