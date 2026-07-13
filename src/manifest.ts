import { BUILT_IN_CONTENT_MATCHES } from "./shared/built-in-sites.ts";
import type { Manifest } from "./shared/chrome-types";

const manifest: Manifest = {
  manifest_version: 3,
  minimum_chrome_version: "116",
  name: "TurnMap",
  version: "0.9.0",
  description: "Turn AI conversations into editable mind maps.",
  icons: {
    "16": "icons/turnmap-16.png",
    "32": "icons/turnmap-32.png",
    "48": "icons/turnmap-48.png",
    "128": "icons/turnmap-128.png"
  },
  action: {
    default_title: "Open TurnMap",
    default_icon: {
      "16": "icons/turnmap-16.png",
      "32": "icons/turnmap-32.png",
      "48": "icons/turnmap-48.png",
      "128": "icons/turnmap-128.png"
    }
  },
  options_page: "src/settings-page/index.html",
  permissions: ["activeTab", "scripting", "sidePanel", "storage", "tabs", "webRequest"],
  host_permissions: [
    ...BUILT_IN_CONTENT_MATCHES,
    "https://chatgpt.com/backend-api/*",
    "https://api.openai.com/*",
    "https://api.deepseek.com/*",
    "https://openrouter.ai/*",
    "https://dashscope-intl.aliyuncs.com/*",
    "https://api.moonshot.ai/*",
    "https://ark.cn-beijing.volces.com/*",
    "https://open.bigmodel.cn/*",
    "https://api.mistral.ai/*"
  ],
  optional_host_permissions: [
    "https://*/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  background: {
    service_worker: "background/service-worker.js",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["https://gemini.google.com/*"],
      js: ["gemini-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: BUILT_IN_CONTENT_MATCHES,
      js: ["content/index.js"],
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: [
    {
      resources: ["icons/turnmap-128.png"],
      matches: BUILT_IN_CONTENT_MATCHES
    }
  ],
  side_panel: {
    default_path: "src/side-panel/index.html"
  }
};

export default manifest;
