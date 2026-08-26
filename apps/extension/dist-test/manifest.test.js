"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/manifest.test.ts
var import_node_test = require("node:test");
var import_node_assert = __toESM(require("node:assert"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function stripCommentsAndSourceMaps(content) {
  let clean = content.replace(/\/\*[\s\S]*?\*\//g, "");
  clean = clean.replace(/(^|[^:])\/\/.*$/gm, "$1");
  clean = clean.replace(/\/\/#\s*sourceMappingURL=.*$/gm, "");
  return clean;
}
(0, import_node_test.describe)("Extension Manifest Build Tests", () => {
  const distPath = path.join(__dirname, "../dist");
  const manifestPath = path.join(distPath, "manifest.json");
  (0, import_node_test.it)("should copy manifest.json to dist directory and contain correct references", () => {
    import_node_assert.default.ok(
      fs.existsSync(manifestPath),
      `manifest.json should exist in dist/ folder at path: ${manifestPath}`
    );
    const manifestContent = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);
    import_node_assert.default.strictEqual(manifest.manifest_version, 3, "Manifest version should be 3");
    import_node_assert.default.strictEqual(manifest.name, "WaveRPC", "Extension name should be WaveRPC");
    import_node_assert.default.ok(manifest.background, "Background configuration should exist");
    import_node_assert.default.strictEqual(
      manifest.background.service_worker,
      "background.js",
      "Service worker script should be background.js"
    );
    import_node_assert.default.strictEqual(manifest.background.type, "module", "Service worker type should be module");
    const backgroundWorker = path.join(distPath, manifest.background.service_worker);
    import_node_assert.default.ok(
      fs.existsSync(backgroundWorker),
      `Service worker file should exist at: ${backgroundWorker}`
    );
    for (const scriptInfo of manifest.content_scripts) {
      for (const scriptFile of scriptInfo.js) {
        const fullScriptPath = path.join(distPath, scriptFile);
        import_node_assert.default.ok(
          fs.existsSync(fullScriptPath),
          `Content script file should exist at: ${fullScriptPath}`
        );
      }
    }
  });
  (0, import_node_test.it)("should not contain browser-incompatible CommonJS or Node references in executable code", () => {
    const filesToCheck = [
      path.join(distPath, "background.js"),
      path.join(distPath, "content/soundcloud.js")
    ];
    const forbiddenPatterns = [
      { pattern: /require\(/, name: "require(" },
      { pattern: /\bmodule\.exports\b/, name: "module.exports" },
      { pattern: /\bexports\./, name: "exports." },
      { pattern: /\bexports\s*=/, name: "exports =" },
      { pattern: /\bprocess\b/, name: "process" },
      { pattern: /\b__dirname\b/, name: "__dirname" },
      { pattern: /\b__filename\b/, name: "__filename" }
    ];
    for (const file of filesToCheck) {
      import_node_assert.default.ok(fs.existsSync(file), `Compiled file should exist: ${file}`);
      const content = fs.readFileSync(file, "utf8");
      const cleanContent = stripCommentsAndSourceMaps(content);
      for (const { pattern, name } of forbiddenPatterns) {
        import_node_assert.default.ok(
          !pattern.test(cleanContent),
          `Compiled file ${path.basename(file)} should not contain ${name} in executable code`
        );
      }
    }
  });
  (0, import_node_test.it)("should attempt to connect to the correct WebSocket endpoint", () => {
    const backgroundWorker = path.join(distPath, "background.js");
    import_node_assert.default.ok(fs.existsSync(backgroundWorker), "background.js should exist");
    const content = fs.readFileSync(backgroundWorker, "utf8");
    import_node_assert.default.ok(
      content.includes("ws://127.0.0.1:6124"),
      "background.js must contain connection url: ws://127.0.0.1:6124"
    );
  });
});
//# sourceMappingURL=manifest.test.js.map
