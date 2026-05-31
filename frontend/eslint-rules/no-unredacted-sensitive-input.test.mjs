/**
 * RuleTester suite for `no-unredacted-sensitive-input`.
 *
 * Locks: sensitive-named form-control elements MUST carry
 * `data-bridge-redact="true"` directly or on a JSX ancestor. Native
 * `<input type="password">` is exempt (SDK handles it unconditionally).
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6.
 */

import { RuleTester } from "eslint";
import rule from "./no-unredacted-sensitive-input.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("no-unredacted-sensitive-input", rule, {
  valid: [
    // Native password input — SDK redacts unconditionally.
    { code: '<input type="password" name="pw" />' },
    { code: '<input type="password" name="api_token" />' },

    // Explicit per-input marker.
    { code: '<input name="apiKey" data-bridge-redact="true" />' },
    { code: '<Input id="access_token" data-bridge-redact="true" />' },
    {
      code: '<Textarea placeholder="paste your refresh-token" data-bridge-redact="true" />',
    },

    // Ancestor marker on the enclosing form.
    {
      code: '<form data-bridge-redact="true"><input name="apiKey" /></form>',
    },
    // Deeper ancestor (div wrapper) — must still suppress.
    {
      code: '<form data-bridge-redact="true"><div><Input name="client_secret" /></div></form>',
    },
    // Marker via expression container (still a literal string).
    {
      code: '<form data-bridge-redact={"true"}><input name="token" /></form>',
    },

    // Non-sensitive attribute values — left alone.
    { code: '<input name="username" />' },
    { code: '<input name="email" />' },
    { code: '<Input id="display_name" />' },
    { code: '<Textarea placeholder="Write a description…" />' },

    // Non-targeted element — left alone.
    { code: '<select name="api_key_provider" />' },
    { code: '<Select name="api_key_provider" />' },

    // Member-expression JSX element (Foo.Bar) — out of scope.
    { code: '<Form.Input name="api_key" />' },

    // Attribute value is a non-literal expression — out of scope.
    { code: "<input name={dynamicName} />" },

    // No matching attributes at all.
    { code: "<input />" },
  ],

  invalid: [
    // Plain identifier matches.
    {
      code: '<input name="apiKey" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<Input id="access_token" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<Textarea placeholder="paste your refresh-token here" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<input name="otp_code" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<input name="2fa-code" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<input name="client_secret" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<input id="connection_string" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<input name="card_number" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<input name="cvv" />',
      errors: [{ messageId: "unredacted" }],
    },
    {
      code: '<PasswordInput name="recovery_token" />',
      errors: [{ messageId: "unredacted" }],
    },

    // Marker is present but value is not "true" — does NOT suppress.
    {
      code: '<input name="api_key" data-bridge-redact="false" />',
      errors: [{ messageId: "unredacted" }],
    },

    // type is set to something other than "password" — does NOT exempt.
    {
      code: '<input type="text" name="api_key" />',
      errors: [{ messageId: "unredacted" }],
    },
  ],
});
