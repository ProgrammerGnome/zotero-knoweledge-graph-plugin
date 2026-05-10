import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "zotero-menuitem-ai-graph-main",
    label: "Zotero AI Knowledge Map...",
    commandListener: () => {
      const dialogText = 
        "Select which AI function you would like to start!\n\n" +
        "1. Build Local Graph:\n" +
        "AI analysis and visualization of selected articles in your Zotero library.\n\n" +
        "2. Web Expansion (OpenAlex):\n" +
        "Search for similar publications on the web based on selected articles, and analyze them.";
      try {
        const Services = (globalThis as any).Services;
        const promptService = Services.prompt;
        const flags =
          (promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0) +
          (promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_1) +
          (promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_2);
        
        const result = promptService.confirmEx(
          win,
          "Zotero AI Knowledge Map Dashboard",
          dialogText,
          flags,
          "2. Web Expansion",
          "Cancel",
          "1. Local Graph",
          null,
          { value: false }
        );
        
        if (result === 0) {
          addon.expandKnowledgeGraph();
        } else if (result === 2) {
          addon.runAiPipelineAndVisualize();
        }
      } catch (error) {
        const fallbackResult = win.prompt(
          dialogText + "\n\nEnter the number of the chosen function (1 or 2):",
          "1"
        );
        if (fallbackResult === "1") {
          addon.runAiPipelineAndVisualize();
        } else if (fallbackResult === "2") {
          addon.expandKnowledgeGraph();
        }
      }
    },
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "zotero-menuitem-ai-graph-full",
    label: "Zotero AI: View Full Graph",
    commandListener: () => {
      addon.showFullGraph();
    },
  });
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  delete (Zotero as any)[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};