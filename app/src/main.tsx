import { runCli } from "@/cli";
import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/core/service/AuthClient";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { RecentFileManager } from "@/core/service/dataFileService/RecentFileManager";
import { StartFilesManager } from "@/core/service/dataFileService/StartFilesManager";
import { ColorManager } from "@/core/service/feedbackService/ColorManager";
import { QuickSettingsManager } from "@/core/service/QuickSettingsManager";
import { Settings } from "@/core/service/Settings";
import { Tutorials } from "@/core/service/Tutorials";
import { UserState } from "@/core/service/UserState";
import { EdgeCollisionBoxGetter } from "@/core/stage/stageObject/association/EdgeCollisionBoxGetter";
import { type AuthUser, currentUserAtom, isAuthLoadingAtom, store, tabsAtom } from "@/state";
import { exit, writeStderr } from "@/utils/otherApi";
import { isDesktop, isMobile, isWeb } from "@/utils/platform";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { exists } from "@tauri-apps/plugin-fs";
import "driver.js/dist/driver.css";
import i18next from "i18next";
import { Provider } from "jotai";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { initReactI18next } from "react-i18next";
import { toast } from "sonner";
import VConsole from "vconsole";
import { URI } from "vscode-uri";
import App from "./App";
import { ExtensionManager } from "./core/extension/ExtensionManager";
import { handleDeepLink, isProjectGraphDeepLink } from "./core/service/dataFileService/DeepLinkHandler";
import { onNewDraft, onOpenFile } from "./core/service/GlobalMenu";
import { TabWorkspace } from "./core/TabWorkspace";
import WelcomeWindow from "./sub/WelcomeWindow";
import KnowledgeBridgeWelcomeWindow from "./sub/KnowledgeBridgeWelcomeWindow";
import "./css/index.css";
import Fallback from "./Fallback";

if (import.meta.env.DEV && isMobile) {
  new VConsole();
}

const el = document.getElementById("root")!;

(async () => {
  const matches = !isWeb && isDesktop ? await getMatches() : null;
  const isCliMode = isDesktop && matches?.args.output?.occurrences === 1;
  await Promise.all([
    RecentFileManager.init(),
    StartFilesManager.init(),
    ColorManager.init(),
    Tutorials.init(),
    UserState.init(),
    QuickSettingsManager.init(),
    isWeb ? Promise.resolve() : ExtensionManager.init(),
  ]);
  const languageLoad = loadLanguageFiles();
  await Promise.all([isWeb ? Promise.resolve() : languageLoad, loadSyncModules(), initAuth()]);
  if (isWeb) {
    void languageLoad.catch((error) => console.warn("语言包后台加载失败", error));
  }
  await renderApp(isCliMode);
  await loadStartFile();
  if (!isCliMode) {
    await ensureStartupDraftAndWelcome();
  }
  if (isCliMode) {
    try {
      await runCli(matches);
      exit();
    } catch (e) {
      writeStderr(String(e));
      exit(1);
    }
  }
})().catch((error: unknown) => {
  console.error("Knowledge Bridge startup failed", error);
});

async function loadSyncModules() {
  EdgeCollisionBoxGetter.init();
  MouseLocation.init();
}

async function initAuth() {
  if (!authClient) {
    store.set(isAuthLoadingAtom, false);
    return;
  }
  try {
    const session = await UserState.getSession();
    if (session?.token) {
      const { data } = await authClient.getSession();
      if (data?.user) {
        store.set(currentUserAtom, data.user as AuthUser);
      } else {
        await UserState.clearSession();
      }
    }
  } catch {
    await UserState.clearSession();
  } finally {
    store.set(isAuthLoadingAtom, false);
  }
}

async function loadLanguageFiles() {
  i18next.use(initReactI18next).init({
    lng: Settings.language,
    debug: false,
    defaultNS: "",
    fallbackLng: false,
    saveMissing: false,
    resources: {
      en: await import("./locales/en.yml").then((module) => module.default),
      zh_CN: await import("./locales/zh_CN.yml").then((module) => module.default),
      zh_TW: await import("./locales/zh_TW.yml").then((module) => module.default),
      zh_TWC: await import("./locales/zh_TWC.yml").then((module) => module.default),
      id: await import("./locales/id.yml").then((module) => module.default),
    },
  });
}

async function renderApp(cli = false) {
  const root = createRoot(el);
  if (cli) {
    await getCurrentWindow().hide();
    await getCurrentWindow().setSkipTaskbar(true);
    root.render(<></>);
    return;
  }
  root.render(
    <Provider store={store}>
      <Toaster richColors visibleToasts={5} expand />
      <ErrorBoundary FallbackComponent={Fallback}>
        <App />
      </ErrorBoundary>
    </Provider>,
  );
}

async function loadStartFile() {
  if (isWeb || !isDesktop) return;

  const cliMatches = await getMatches();
  const argPath = cliMatches.args.path.value as string | undefined;
  if (argPath) {
    if (isProjectGraphDeepLink(argPath)) {
      try {
        await handleDeepLink([argPath]);
      } catch (error) {
        toast.error("处理 Deep Link 失败: " + String(error));
      }
    } else {
      try {
        if (await exists(argPath)) {
          await onOpenFile(URI.file(argPath), "CLI或双击文件");
        } else {
          toast.error("文件不存在");
        }
      } catch (error) {
        toast.error("打开文件失败: " + String(error));
      }
    }
  }

  const pending = await invoke<string[]>("take_pending_open_files");
  for (const path of pending) {
    if (!path.toLowerCase().endsWith(".prg")) continue;
    if (await exists(path)) {
      await onOpenFile(URI.file(path), "macOS双击文件(启动)");
    } else {
      toast.error("文件不存在");
    }
  }

  listen<string>("open-file-from-os", async (event) => {
    const path = event.payload;
    if (await exists(path)) {
      await onOpenFile(URI.file(path), "macOS双击文件");
    } else {
      toast.error("文件不存在");
    }
  });

  try {
    const urls = await getCurrent();
    if (urls && urls.length > 0) {
      await handleDeepLink(urls);
    }
  } catch (error) {
    toast.error("处理 Deep Link 失败: " + String(error));
  }

  onOpenUrl((urls) => {
    if (urls.length > 0) {
      void handleDeepLink(urls);
    }
  });
}

async function ensureStartupDraftAndWelcome() {
  if (store.get(tabsAtom).length > 0) return;
  await onNewDraft();
  if (isWeb) {
    TabWorkspace.synchronizeGroups();
    KnowledgeBridgeWelcomeWindow.open();
    return;
  }
  WelcomeWindow.open();
}
