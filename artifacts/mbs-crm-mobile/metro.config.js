const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Exclude pnpm temp directories from file watching to prevent ENOENT errors
const blockList = config.resolver.blockList;
const existingBlockList = Array.isArray(blockList)
  ? blockList
  : blockList
    ? [blockList]
    : [];

config.resolver.blockList = [
  ...existingBlockList,
  /node_modules\/\.pnpm\/.*_tmp_\d+\/.*/,
];

module.exports = config;
