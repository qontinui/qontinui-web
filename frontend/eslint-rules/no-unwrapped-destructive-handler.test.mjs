/**
 * RuleTester suite for `no-unwrapped-destructive-handler`.
 *
 * Locks: which JSX shapes the rule flags (destructive identifier in a
 * non-DestructiveButton element) and which it leaves alone (handler is
 * benign / wrapper is allowed / handler shape can't be statically read).
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.4.
 */

import { RuleTester } from "eslint";
import rule from "./no-unwrapped-destructive-handler.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("no-unwrapped-destructive-handler", rule, {
  valid: [
    // Already wrapped: ok.
    { code: "<DestructiveButton onClick={handleDelete} />" },
    { code: "<DestructiveButton onClick={() => handleRevokeKey(id)} />" },

    // Allowed gating wrappers: ok.
    { code: "<DeleteConfirmationDialog onConfirm={handleDelete} />" },
    { code: "<DeleteCategoryDialog onClick={handleDelete} />" },

    // Handler name is not destructive: ok.
    { code: "<Button onClick={handleSave} />" },
    { code: "<Button onClick={handleSubmit} />" },
    { code: "<button onClick={onClose} />" },
    { code: "<Button onClick={() => setOpen(false)} />" },

    // Verb 'reset' is intentionally NOT on the destructive list (too
    // many false positives in form / state contexts).
    { code: "<Button onClick={handleReset} />" },
    { code: "<button onClick={handleRemoveTag} />" }, // 'remove' is also off the list

    // Member-expression JSX element (Foo.Bar) — out of scope.
    { code: "<Foo.Action onClick={handleDelete} />" },

    // Handler shape we can't statically read — out of scope.
    { code: "<Button onClick={handlers[index]} />" },
    { code: "<Button onClick={maybeHandler ?? noop} />" },

    // Attribute with no expression — out of scope.
    { code: '<Button onClick="" />' },

    // Other attributes — out of scope.
    { code: "<Button onChange={handleDelete} />" },
    { code: "<Button onMouseDown={handleDelete} />" },
  ],

  invalid: [
    // Identifier handler, plain Button.
    {
      code: "<Button onClick={handleDelete} />",
      errors: [{ messageId: "unwrapped" }],
    },
    {
      code: "<Button onClick={deleteProject} />",
      errors: [{ messageId: "unwrapped" }],
    },
    {
      code: "<button onClick={handleRevoke} />",
      errors: [{ messageId: "unwrapped" }],
    },
    {
      code: "<Button onClick={handleApprove} />",
      errors: [{ messageId: "unwrapped" }],
    },

    // Arrow-wrapped handlers.
    {
      code: "<Button onClick={() => handleDestroyProject()} />",
      errors: [{ messageId: "unwrapped" }],
    },
    {
      code: "<Button onClick={() => handleRotateKey(id)} />",
      errors: [{ messageId: "unwrapped" }],
    },
    {
      code: "<Button onClick={() => { handleWipeData(); }} />",
      errors: [{ messageId: "unwrapped" }],
    },

    // Method-call handler.
    {
      code: "<Button onClick={() => store.purgeAll()} />",
      errors: [{ messageId: "unwrapped" }],
    },

    // onSubmit also covered.
    {
      code: "<form onSubmit={handleDeleteAccount} />",
      errors: [{ messageId: "unwrapped" }],
    },
  ],
});
