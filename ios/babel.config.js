const path = require("path");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: [path.resolve(__dirname)],
          alias: {
            "@shared": path.resolve(__dirname, "../shared"),
            "@": path.resolve(__dirname, "app"),
            "hit-music-kit": path.resolve(
              __dirname,
              "modules/hit-music-kit/src"
            ),
          },
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
        },
      ],
    ],
  };
};
