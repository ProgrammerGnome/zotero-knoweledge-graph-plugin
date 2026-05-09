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

  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "zotero-menuitem-build-graph",
    label: "Zotero AI Gráf Építése (Helyi könyvtár)",
    commandListener: () => {
      addon.runAiPipelineAndVisualize();
    },
  });
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: "zotero-menuitem-expand-graph",
    label: "Zotero AI Gráf Bővítése webről (Semantic Scholar)",
    commandListener: () => {
      addon.expandKnowledgeGraph();
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
  // Ide jöhetnek az értesítések (pl. új elem hozzáadása)
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