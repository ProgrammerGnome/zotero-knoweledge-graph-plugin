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
    prefs?: { window: Window; columns: Array<ColumnOptions>; rows: Array<{ [dataKey: string]: string }>; };
    dialog?: DialogHelper;
    graphData?: GraphData;
  };
  public hooks: typeof hooks;
  public api: object;

  constructor() {
    this.data = { alive: true, config, env: __env__, initialized: false, ztoolkit: createZToolkit(), };
    this.hooks = hooks;
    this.api = {};
  }

  public async openGraphWindow(ids?: string[]) {
    try {
      const graphData = await fetchGraphData(ids);
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

  public async showFullGraph() {
    const pw = new this.data.ztoolkit.ProgressWindow("Zotero AI Knowledge Map", { closeOnClick: false, closeTime: -1 });
    const mainLine = pw.createLine({ text: "Loading full graph from database...", type: "info", progress: 50 });
    pw.show();
    try {
      await this.openGraphWindow(); 
      mainLine.changeLine({ text: "Done!", type: "success", progress: 100 });
      setTimeout(() => pw.close(), 800);
    } catch (error: any) {
      mainLine.changeLine({ text: "An error occurred!", type: "error", progress: 0 });
      pw.createLine({ text: error?.message || String(error), type: "error" });
      pw.startCloseTimer(8000);
    }
  }

  public async runAiPipelineAndVisualize() {
    const mainWindow = Zotero.getMainWindow();
    const zoteroPane = Zotero.getActiveZoteroPane();
    const selectedItems = zoteroPane ? zoteroPane.getSelectedItems() : [];
    const regularItems = selectedItems.filter((item: any) => item.isRegularItem());

    if (regularItems.length === 0) {
      if (mainWindow) mainWindow.alert("Please select one or more articles in the Zotero list for analysis!");
      return;
    }

    const pw = new this.data.ztoolkit.ProgressWindow("Zotero AI Knowledge Map", { closeOnClick: false, closeTime: -1 });
    const mainLine = pw.createLine({ text: "Starting pipeline...", type: "info", progress: 0 });
    pw.show();

    try {
      mainLine.changeLine({ text: `Reading selected articles (${regularItems.length} items)...`, progress: 20 });
      const limitedItems = await extractZoteroItems(regularItems); 
      const itemIds = limitedItems.map(item => item.id);
      
      mainLine.changeLine({ text: "Checking existing database entries...", progress: 30 });
      const existingGraph = await fetchGraphData(itemIds);
      const existingIds = new Set(existingGraph.nodes.map(node => node.id));
      
      const newItems = limitedItems.filter(item => !existingIds.has(item.id));

      if (newItems.length > 0) {
        mainLine.changeLine({ text: `AI analysis in progress (${newItems.length} new articles)...`, progress: 50 });
        const subLine = pw.createLine({ text: "Searching for relationships in Neo4j...", type: "info" });
  
        await runCloudPipeline(newItems);
  
        subLine.changeLine({ text: "Data processed successfully.", type: "success" });
      } else {
        mainLine.changeLine({ text: "All selected articles are already in the database. Skipping AI analysis.", progress: 80 });
      }

      mainLine.changeLine({ text: "Rendering graph...", progress: 90 });
      
      await this.openGraphWindow(itemIds); 

      mainLine.changeLine({ text: "Done!", progress: 100 });
      setTimeout(() => pw.close(), 800);
    } catch (error: any) { 
      mainLine.changeLine({ text: "An error occurred!", type: "error", progress: 0 });
      pw.createLine({ text: error?.message || String(error), type: "error" });
      pw.startCloseTimer(8000); 
    }
  }

  public async expandKnowledgeGraph() {
    const mainWindow = Zotero.getMainWindow();
    const zoteroPane = Zotero.getActiveZoteroPane();
    const selectedItems = zoteroPane ? zoteroPane.getSelectedItems() : [];
    const regularItems = selectedItems.filter((item: any) => item.isRegularItem());

    if (regularItems.length === 0) {
      if (mainWindow) mainWindow.alert("Please select at least 1 article in Zotero as a base for the web search!");
      return;
    }

    const pw = new this.data.ztoolkit.ProgressWindow("Expanding Zotero AI Graph", { closeOnClick: false, closeTime: -1 });
    const mainLine = pw.createLine({ text: "Reading selected base articles...", type: "info", progress: 10 });
    pw.show();

    try {
      const localArticles = await extractZoteroItems(regularItems);
      if (localArticles.length === 0) throw new Error("Failed to read articles.");

      mainLine.changeLine({ text: "Searching for similar articles in the OpenAlex database...", progress: 30 });
      const titlesToSearch = localArticles.map(item => item.title);
      const webArticles = await fetchRelatedPapersFromWeb(titlesToSearch);

      if (webArticles.length === 0) {
        mainLine.changeLine({ text: "No suitable new articles found.", type: "error", progress: 100 });
        pw.startCloseTimer(4000);
        return;
      }

      const combinedArticles = [...localArticles, ...webArticles];
      const allItemIds = combinedArticles.map(item => item.id);

      mainLine.changeLine({ text: "Checking existing database entries...", progress: 50 });
      const existingGraph = await fetchGraphData(allItemIds);
      const existingIds = new Set(existingGraph.nodes.map(node => node.id));

      const newArticles = combinedArticles.filter(item => !existingIds.has(item.id));

      if (newArticles.length > 0) {
        mainLine.changeLine({ text: `AI analysis (${newArticles.length} new articles out of ${combinedArticles.length})...`, progress: 60 });
        const subLine = pw.createLine({ text: "Searching for relationships and saving to Neo4j...", type: "info" });
  
        await runCloudPipeline(newArticles);
  
        subLine.changeLine({ text: "Data processed successfully.", type: "success" });
      } else {
        mainLine.changeLine({ text: "All found articles already exist in the database.", progress: 80 });
      }

      mainLine.changeLine({ text: "Rendering expanded graph...", progress: 90 });

      await this.openGraphWindow(allItemIds); 

      mainLine.changeLine({ text: "Done!", progress: 100 });
      setTimeout(() => pw.close(), 800);
    } catch (error: any) {
      mainLine.changeLine({ text: "An error occurred during expansion!", type: "error", progress: 0 });
      pw.createLine({ text: error?.message || String(error), type: "error" });
      pw.startCloseTimer(8000); 
    }
  }
}

export default Addon;