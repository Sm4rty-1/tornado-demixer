/**
 * The portable half of the tool. No Node built-ins, no npm packages, no DOM —
 * this directory is vendored into sm4rty.xyz as-is so the CLI and the web GUI
 * cannot drift apart in their analysis.
 */

export * from "./constants.js";
export * from "./hex.js";
export * from "./sources.js";
export * from "./heuristics.js";
export * from "./engine.js";
export * from "./report.js";
