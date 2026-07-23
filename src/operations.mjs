import path from "node:path";

import { PORTALS } from "./constants.mjs";
import { CliError } from "./errors.mjs";
import {
  normalizeInspectionSections,
  requireString,
  validateWebhookUrl,
} from "./manifest.mjs";
import { redact } from "./output.mjs";
import { stateDirectory, writePrivateFile } from "./platform.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appIdFor(op, context) {
  const appId = op.app_id || context.app_id;
  requireString(appId, `${op.id}.app_id`);
  return appId;
}

function appIdFromRecord(app) {
  for (const key of ["appId", "appID", "AppID", "ClientID", "clientId", "client_id", "id"]) {
    if (typeof app?.[key] === "string" && app[key]) return app[key];
  }
  return "";
}

async function listApps(client, op) {
  const count = Number(op.count || 50);
  let cursor = Number(op.cursor || 0);
  const apps = [];
  let totalCount = 0;
  for (let page = 0; page < Number(op.max_pages || 200); page += 1) {
    const response = await client.post("/app/list", {
      Count: count,
      Cursor: cursor,
      QueryFilter: { filterAppSceneTypeList: op.scene_types || [0] },
      OrderBy: Number(op.order_by || 0),
    });
    const batch = response.data?.apps || [];
    totalCount = response.data?.totalCount || batch.length;
    apps.push(...batch);
    if (op.all === false || batch.length === 0 || apps.length >= totalCount) break;
    cursor += count;
  }
  return { apps, total_count: totalCount };
}

const SECTION_REQUEST = {
  event: (appId, options) => ({
    path: `/event/${encodeURIComponent(appId)}`,
    body: { needEventDetail: options.eventDetails === true },
  }),
  callback: (appId) => ({ path: `/callback/${encodeURIComponent(appId)}`, body: {} }),
  bot: (appId) => ({ path: `/robot/${encodeURIComponent(appId)}`, body: {} }),
  "external-sharing": (appId) => ({ path: `/b2c_share/${encodeURIComponent(appId)}`, body: {} }),
};

function summarizePortalSection(section, data, options) {
  if (section === "event" && options.eventDetails !== true) {
    return {
      event_mode: data.eventMode ?? null,
      events: data.events || [],
      cloud_functions: data.eventCloudFuncs || [],
      verification_status: data.verificationStatus ?? null,
      verification_url: data.verificationUrl || "",
    };
  }
  if (section === "callback") {
    return {
      callback_mode: data.callbackMode ?? null,
      callbacks: data.callbacks || [],
      verification_status: data.verificationStatus ?? null,
      verification_url: data.verificationUrl || "",
    };
  }
  if (section === "bot") {
    return {
      enabled: data.enable === true,
      menu_enabled: data.botMenuEnable === true,
      card_callback_mode: data.cardCallbackMode ?? null,
      card_request_url: data.cardRequestUrl || "",
    };
  }
  if (section === "external-sharing") {
    return {
      enabled: data.onlineB2CShareEnable === true,
      suggested: data.b2cShareSuggest === true,
      active_config: data.onlineB2CShareSplitConfig || null,
      suggested_config: data.b2cShareSplitConfigSuggest || null,
      feature_hint: data.b2cShareConfigHint || null,
    };
  }
  return data;
}

function normalizePortalRead(payload, section, options) {
  if (typeof payload.code === "number" && payload.code !== 0) {
    return {
      ok: false,
      code: payload.code,
      message: payload.msg || payload.message || "portal returned a nonzero code",
    };
  }
  return {
    ok: true,
    data: summarizePortalSection(section, payload.data ?? payload, options),
  };
}

async function readAppSection(client, appId, section, options = {}) {
  const request = SECTION_REQUEST[section](appId, options);
  const payload = await client.post(request.path, request.body, { allowNonzero: true });
  return normalizePortalRead(payload, section, options);
}

async function inspectApp(client, appId, sections, options = {}) {
  const inspection = {};
  for (const section of sections) {
    inspection[section.replaceAll("-", "_")] = await readAppSection(
      client,
      appId,
      section,
      options,
    );
  }
  return { app_id: appId, inspection };
}

function summarizeApp(app) {
  return {
    app_id: appIdFromRecord(app) || null,
    name: app.name || app.i18n?.zh_cn?.name || null,
    description: app.desc || app.i18n?.zh_cn?.description || null,
    version: app.version || null,
    abilities: app.ability || [],
    app_type: app.appType ?? null,
    app_status: app.appStatus ?? null,
    audit_status: app.auditStatus ?? null,
    developer_status: app.appListDevStatus ?? null,
    created_at: app.createTime ?? null,
    updated_at: app.updateTime ?? null,
  };
}

function arraysOnly(values, label) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new CliError(`${label} must be an array of strings`);
  }
  return [...new Set(values)];
}

function walkObjects(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, output);
  } else if (value && typeof value === "object") {
    output.push(value);
    for (const item of Object.values(value)) walkObjects(item, output);
  }
  return output;
}

function findScopeRecord(catalog, scopeName) {
  return walkObjects(catalog).find((record) =>
    Object.values(record).some((value) => typeof value === "string" && value === scopeName),
  );
}

function scopeIdFromRecord(record) {
  for (const key of ["scopeId", "scopeID", "scope_id", "id", "ID"]) {
    if (record?.[key] !== undefined && /^\d+$/.test(String(record[key]))) return String(record[key]);
  }
  for (const [key, value] of Object.entries(record || {})) {
    if (/scope.*id/i.test(key) && /^\d+$/.test(String(value))) return String(value);
  }
  return "";
}

function scopeTypeFromRecord(record) {
  const value = record?.scopeIdentityType ?? record?.scope_identity_type ?? record?.identityType;
  if (Number(value) === 2 || String(value).toLowerCase() === "tenant") return "tenant";
  if (Number(value) === 1 || String(value).toLowerCase() === "user") return "user";
  return "";
}

async function resolveScopeNames(client, appId, tenantNames, userNames) {
  if (tenantNames.length === 0 && userNames.length === 0) return { tenant: [], user: [] };
  const catalog = await client.post(`/scope/applied/${encodeURIComponent(appId)}`, {});
  const resolved = { tenant: [], user: [] };
  for (const [requestedType, names] of Object.entries({ tenant: tenantNames, user: userNames })) {
    for (const name of names) {
      const record = findScopeRecord(catalog, name);
      const id = scopeIdFromRecord(record);
      const detectedType = scopeTypeFromRecord(record);
      if (!record || !id) {
        throw new CliError(
          `scope ${name} could not be mapped to a numeric portal id; run scope.catalog or provide ${requestedType}_ids`,
        );
      }
      if (detectedType && detectedType !== requestedType) {
        throw new CliError(`scope ${name} is ${detectedType}, not ${requestedType}`);
      }
      resolved[requestedType].push(id);
    }
  }
  return resolved;
}

async function saveAppSecret(appId, appSecret, platform, options) {
  if (options["no-store-secrets"]) return null;
  const directory = path.resolve(options["secrets-dir"] || path.join(stateDirectory(), "apps"));
  const filename = path.join(directory, `${appId}.json`);
  await writePrivateFile(
    filename,
    `${JSON.stringify(
      { app_id: appId, app_secret: appSecret, platform, saved_at: new Date().toISOString() },
      null,
      2,
    )}\n`,
  );
  return filename;
}

function defaultReleasePayload(op, creatorId) {
  const visibility = op.visibility || "creator";
  if (!new Set(["creator", "all"]).has(visibility)) {
    throw new CliError(`${op.id}.visibility must be creator or all`);
  }
  return {
    appVersion: op.version,
    mobileDefaultAbility: op.mobile_default_ability || "bot",
    pcDefaultAbility: op.pc_default_ability || "bot",
    changeLog: op.changelog || op.version,
    visibleSuggest: {
      departments: [],
      members: visibility === "creator" ? [creatorId] : [],
      groups: [],
      isAll: visibility === "all" ? 1 : 0,
    },
    applyReasonConfig: {
      apiPrivilegeNeedReason: false,
      contactPrivilegeNeedReason: false,
      dataPrivilegeReasonMap: {},
      visibleScopeNeedReason: false,
      apiPrivilegeReasonMap: {},
      contactPrivilegeReason: "",
      isDataPrivilegeExpandMap: {},
      visibleScopeReason: "",
      dataPrivilegeNeedReason: false,
      isAutoAudit: false,
      isContactExpand: false,
    },
    b2cShareSuggest: false,
    autoPublish: false,
    blackVisibleSuggest: { departments: [], members: [], groups: [], isAll: 0 },
  };
}

export async function runOperation(client, op, context, options = {}) {
  switch (op.action) {
    case "app.list":
      return listApps(client, op);
    case "app.inspect": {
      const appId = appIdFor(op, context);
      return inspectApp(
        client,
        appId,
        normalizeInspectionSections(op.sections, `${op.id}.sections`),
        { eventDetails: op.event_details === true },
      );
    }
    case "apps.inspect": {
      const listed = await listApps(client, op);
      const sections = normalizeInspectionSections(op.sections, `${op.id}.sections`);
      const apps = [];
      for (const app of listed.apps) {
        const appId = appIdFromRecord(app);
        apps.push({
          app: op.full_app_records === true ? app : summarizeApp(app),
          ...(appId
            ? await inspectApp(client, appId, sections, { eventDetails: op.event_details === true })
            : { app_id: null, inspection: {}, error: "app record does not contain an app id" }),
        });
      }
      return { apps, total_count: listed.total_count };
    }
    case "app.create": {
      const avatar = op.avatar_url || (await client.uploadIcon(op.icon_path));
      const description = op.description || op.name;
      const primaryLanguage = op.primary_language || (context.platform === "lark" ? "en_us" : "zh_cn");
      const response = await client.post("/app/create", {
        appSceneType: Number(op.app_scene_type || 0),
        name: op.name,
        desc: description,
        avatar,
        i18n: op.i18n || { [primaryLanguage]: { name: op.name, description } },
        primaryLang: primaryLanguage,
      });
      const appId = response.data?.ClientID;
      requireString(appId, `${op.id} result app_id`);
      context.app_id = appId;
      let secretFile = null;
      if (!options["no-store-secrets"] && op.fetch_secret !== false) {
        const secretResponse = await client.post(`/secret/${encodeURIComponent(appId)}`);
        const appSecret = secretResponse.data?.secret;
        requireString(appSecret, `${op.id} result app_secret`);
        secretFile = await saveAppSecret(appId, appSecret, context.platform, options);
      }
      return {
        app_id: appId,
        console_url: `${PORTALS[context.platform].open}/app/${appId}`,
        secret_stored: Boolean(secretFile),
        secret_file: secretFile,
      };
    }
    case "secret.get": {
      const appId = appIdFor(op, context);
      if (options["no-store-secrets"]) {
        throw new CliError("secret.get cannot be used with --no-store-secrets");
      }
      const response = await client.post(`/secret/${encodeURIComponent(appId)}`);
      const appSecret = response.data?.secret;
      requireString(appSecret, `${op.id} result app_secret`);
      const secretFile = await saveAppSecret(appId, appSecret, context.platform, options);
      return { app_id: appId, secret_stored: true, secret_file: secretFile };
    }
    case "bot.set": {
      const appId = appIdFor(op, context);
      await client.post(`/robot/switch/${encodeURIComponent(appId)}`, { enable: op.enabled });
      if (op.enabled) await client.post(`/robot/${encodeURIComponent(appId)}`);
      return { app_id: appId, enabled: op.enabled };
    }
    case "bot.get": {
      const appId = appIdFor(op, context);
      return { app_id: appId, bot: await readAppSection(client, appId, "bot") };
    }
    case "scope.catalog": {
      const appId = appIdFor(op, context);
      const response = await client.post(`/scope/applied/${encodeURIComponent(appId)}`, {});
      return { app_id: appId, catalog: response.data ?? response };
    }
    case "scopes.update": {
      const appId = appIdFor(op, context);
      const tenantNames = arraysOnly(op.tenant_scopes, `${op.id}.tenant_scopes`);
      const userNames = arraysOnly(op.user_scopes, `${op.id}.user_scopes`);
      const fromNames = await resolveScopeNames(client, appId, tenantNames, userNames);
      const tenantIds = [...arraysOnly(op.tenant_ids, `${op.id}.tenant_ids`), ...fromNames.tenant];
      const userIds = [...arraysOnly(op.user_ids, `${op.id}.user_ids`), ...fromNames.user];
      if (tenantIds.length === 0 && userIds.length === 0) {
        throw new CliError(`${op.id} has no scopes to update`);
      }
      await client.post(`/scope/update/${encodeURIComponent(appId)}`, {
        appScopeIDs: [...new Set(tenantIds)],
        userScopeIDs: [...new Set(userIds)],
        scopeIds: arraysOnly(op.scope_ids, `${op.id}.scope_ids`),
        operation: op.operation || "add",
        isDeveloperPanel: true,
      });
      return {
        app_id: appId,
        operation: op.operation || "add",
        tenant_ids: [...new Set(tenantIds)],
        user_ids: [...new Set(userIds)],
      };
    }
    case "events.update": {
      const appId = appIdFor(op, context);
      const payload = {
        operation: op.operation || "add",
        events: arraysOnly(op.events, `${op.id}.events`),
        appEvents: arraysOnly(op.app_events, `${op.id}.app_events`),
        userEvents: arraysOnly(op.user_events, `${op.id}.user_events`),
        eventMode: Number.isInteger(op.event_mode) ? op.event_mode : 1,
      };
      await client.post(`/event/update/${encodeURIComponent(appId)}`, payload);
      return { app_id: appId, ...payload };
    }
    case "event.get": {
      const appId = appIdFor(op, context);
      return {
        app_id: appId,
        event: await readAppSection(client, appId, "event", {
          eventDetails: op.need_event_detail === true,
        }),
      };
    }
    case "event.mode": {
      const appId = appIdFor(op, context);
      await client.post(`/event/switch/${encodeURIComponent(appId)}`, { eventMode: op.event_mode });
      return { app_id: appId, event_mode: op.event_mode };
    }
    case "callback.get": {
      const appId = appIdFor(op, context);
      return { app_id: appId, callback: await readAppSection(client, appId, "callback") };
    }
    case "webhook.set": {
      const appId = appIdFor(op, context);
      validateWebhookUrl(op.url, op.allow_insecure, `${op.id}.url`);
      const config = await client.post(`/event/${encodeURIComponent(appId)}`, {
        needEventDetail: true,
      });
      const verificationToken = config.data?.verificationToken;
      requireString(verificationToken, `${op.id} verification token`);
      const attempts = Number(op.retries || 5);
      let accepted = false;
      let lastResponse;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (op.warmup !== false) {
          await fetch(op.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challenge: `feishu-app-admin-${Date.now()}`,
              token: verificationToken,
              type: "url_verification",
            }),
          }).catch(() => undefined);
        }
        lastResponse = await client.post(
          `/event/check_url/${encodeURIComponent(appId)}`,
          { verificationToken, verificationUrl: op.url },
          { allowNonzero: true },
        );
        if (lastResponse.code === 0 && lastResponse.data?.access === true) {
          accepted = true;
          break;
        }
        if (attempt < attempts) await sleep(1000);
      }
      if (!accepted) {
        throw new CliError("the callback URL did not pass Feishu verification", {
          exitCode: 5,
          details: redact(lastResponse),
        });
      }
      await client.post(`/event/switch/${encodeURIComponent(appId)}`, { eventMode: 1 });
      return { app_id: appId, url: op.url, verified: true, event_mode: 1 };
    }
    case "external-sharing.get": {
      const appId = appIdFor(op, context);
      return {
        app_id: appId,
        external_sharing: await readAppSection(client, appId, "external-sharing"),
      };
    }
    case "version.create": {
      const appId = appIdFor(op, context);
      const creatorId = op.payload ? null : await client.creatorId();
      const payload = op.payload || defaultReleasePayload(op, creatorId);
      const response = await client.post(`/app_version/create/${encodeURIComponent(appId)}`, payload);
      const versionId = response.data?.versionId;
      requireString(versionId, `${op.id} result version_id`);
      if (op.publish === true) {
        await client.post(`/publish/commit/${encodeURIComponent(appId)}/${encodeURIComponent(versionId)}`);
      }
      return {
        app_id: appId,
        version_id: versionId,
        console_url: `${PORTALS[context.platform].open}/app/${appId}/version/${versionId}`,
        published: op.publish === true,
      };
    }
    case "version.publish": {
      const appId = appIdFor(op, context);
      await client.post(`/publish/commit/${encodeURIComponent(appId)}/${encodeURIComponent(op.version_id)}`);
      return { app_id: appId, version_id: op.version_id, published: true };
    }
    case "raw.request": {
      const response = await client.request(op.path, {
        method: op.method || "POST",
        body: op.body,
        query: op.query,
        allowNonzero: op.allow_nonzero === true,
      });
      return { response };
    }
    default:
      throw new CliError(`unsupported action ${op.action}`);
  }
}
