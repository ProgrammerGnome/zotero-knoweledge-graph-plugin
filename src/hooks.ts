// src/hooks.ts
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

  // Egyetlen menüpont regisztrálása
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "zotero-menuitem-ai-graph-main",
    label: "Zotero AI Tudástérkép...",
    commandListener: () => {
      
      const dialogText = 
        "Válaszd ki, melyik AI funkciót szeretnéd indítani!\n\n" +
        "📚 1. Helyi Gráf Építése:\n" +
        "A Zotero könyvtáradban lévő meglévő cikkek AI elemzése és vizualizációja.\n\n" +
        "🌐 2. Webes Bővítés (OpenAlex):\n" +
        "A helyi cikkek alapján hasonló publikációk keresése a weben, és azok elemzése.";

      try {
        // A modern Zotero 7 / Mozilla Services API használata
        const Services = (globalThis as any).Services;
        const promptService = Services.prompt;
        
        const flags =
          (promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0) +
          (promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_1) +
          (promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_2);

        const result = promptService.confirmEx(
          win,
          "Zotero AI Tudástérkép Indítópult",
          dialogText,
          flags,
          "1. Helyi Gráf", // Gomb 0
          "2. Webes Bővítés", // Gomb 1
          "Mégse", // Gomb 2
          null,
          { value: false }
        );

        if (result === 0) {
          addon.runAiPipelineAndVisualize();
        } else if (result === 1) {
          addon.expandKnowledgeGraph();
        }
      } catch (error) {
        // BIZTONSÁGI FALLBACK: Ha az operációs rendszer vagy a Zotero blokkolja a modern panelt
        ztoolkit.log("A natív ablak nem indítható, fallback a beépített promptra.");
        
        const fallbackResult = win.prompt(
          dialogText + "\n\nÍRD BE A VÁLASZTOTT FUNKCIÓ SZÁMÁT (1 vagy 2):",
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
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  // @ts-expect-error
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  // Értesítések
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  // Beállítások eseményei
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};