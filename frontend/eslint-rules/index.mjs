/**
 * Local ESLint plugin for qontinui-web.
 *
 * Hosts repo-specific rules that don't yet warrant a separate npm package.
 * Add to `eslint.config.mjs` via:
 *
 *   import qontinuiWeb from "./eslint-rules/index.mjs";
 *   ...
 *   { plugins: { "@qontinui-web": qontinuiWeb } }
 *
 * Rules graduate to `@qontinui/ui-bridge-eslint-plugin` (the shared
 * package at `D:/qontinui-root/ui-bridge/packages/ui-bridge-eslint-plugin/`)
 * once they prove useful enough to other consumers.
 */

import noUnwrappedDestructiveHandler from "./no-unwrapped-destructive-handler.mjs";

const qontinuiWebPlugin = {
  rules: {
    "no-unwrapped-destructive-handler": noUnwrappedDestructiveHandler,
  },
};

export default qontinuiWebPlugin;
