const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");
const sharedRoot = path.resolve(monorepoRoot, "shared");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Watch the monorepo root so /shared changes hot-reload
config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Resolve @shared/* → ../shared/*
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@shared": sharedRoot,
  "hit-music-kit": path.resolve(projectRoot, "modules/hit-music-kit"),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@shared" || moduleName.startsWith("@shared/")) {
    const subpath =
      moduleName === "@shared"
        ? "index.js"
        : moduleName.slice("@shared/".length);
    return {
      filePath: path.resolve(sharedRoot, subpath),
      type: "sourceFile",
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
