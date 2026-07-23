export const VERSION = "0.4.0";

export const DEFAULT_ICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==";

export const PORTALS = {
  feishu: {
    open: "https://open.feishu.cn",
    apiOpen: "https://open.feishu.cn",
    accounts: "https://accounts.feishu.cn",
    passport: "https://passport.feishu.cn",
  },
  lark: {
    open: "https://open.larkoffice.com",
    apiOpen: "https://open.larksuite.com",
    accounts: "https://accounts.larksuite.com",
    passport: "https://passport.larksuite.com",
  },
};

export const ACTION_RISK = {
  "app.list": "read",
  "app.inspect": "read",
  "apps.inspect": "read",
  "app.create": "write",
  "secret.get": "sensitive-read",
  "bot.set": "write",
  "bot.get": "read",
  "scope.catalog": "read",
  "scopes.update": "write",
  "event.get": "read",
  "events.update": "write",
  "event.mode": "write",
  "callback.get": "read",
  "webhook.set": "write",
  "external-sharing.get": "read",
  "version.create": "write",
  "version.publish": "high-risk-write",
  "raw.request": "high-risk-write",
};

export const EVENT_MODES = {
  webhook: 1,
  "cloud-function": 2,
  "apaas-cloud-function": 3,
  websocket: 4,
};

export const INSPECTION_SECTIONS = ["event", "callback", "bot", "external-sharing"];

const ACTION_DESCRIPTIONS = {
  "app.list": "List applications available to the current developer account.",
  "app.inspect": "Read event, callback, bot, and external-sharing settings for one app.",
  "apps.inspect": "List apps and read selected settings for every app.",
  "app.create": "Create a custom application.",
  "secret.get": "Fetch an App Secret and store it in a protected local file.",
  "bot.get": "Read bot configuration.",
  "bot.set": "Enable or disable bot capability.",
  "scope.catalog": "Read the portal scope catalog and current scope state.",
  "scopes.update": "Add or remove exact tenant and user scopes.",
  "event.get": "Read event subscription and delivery configuration.",
  "events.update": "Add or remove event subscriptions.",
  "event.mode": "Switch event delivery mode.",
  "callback.get": "Read callback configuration.",
  "webhook.set": "Verify and save an HTTP event callback.",
  "external-sharing.get": "Read external availability and sharing configuration.",
  "version.create": "Create an application version.",
  "version.publish": "Submit an existing application version.",
  "raw.request": "Fallback for an unsupported developer-console endpoint.",
};

export function actionCatalog() {
  return Object.entries(ACTION_RISK).map(([action, risk]) => ({
    action,
    risk,
    description: ACTION_DESCRIPTIONS[action],
  }));
}
