import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions } from "../dist-test/release.js";

test("version comparison orders releases correctly", () => {
  assert.ok(compareVersions("0.2.0", "0.1.0") > 0);
  assert.ok(compareVersions("0.1.0", "0.2.0") < 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);

  // A leading v is how GitHub tags usually arrive.
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.ok(compareVersions("v1.3.0", "1.2.9") > 0);

  // Numeric, not lexicographic: "0.10.0" must beat "0.9.0".
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.ok(compareVersions("1.0.10", "1.0.9") > 0);

  // Uneven lengths treat the missing pieces as zero.
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.ok(compareVersions("1.2.1", "1.2") > 0);

  // Garbage must not throw or read as an upgrade.
  assert.equal(compareVersions("", ""), 0);
  assert.equal(compareVersions("not-a-version", "0.0.0"), 0);
});

test("an equal or older published tag is never offered as an update", async () => {
  const { checkForUpdate } = await import("../dist-test/release.js");
  const original = globalThis.fetch;

  const reply = (body, status = 200) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  try {
    globalThis.fetch = reply({ tag_name: "v0.1.0", html_url: "u" });
    assert.equal((await checkForUpdate("0.1.0")).status, "current");

    globalThis.fetch = reply({ tag_name: "v0.0.9", html_url: "u" });
    assert.equal((await checkForUpdate("0.1.0")).status, "current");

    globalThis.fetch = reply({ tag_name: "v0.2.0", html_url: "u", body: "notes" });
    const available = await checkForUpdate("0.1.0");
    assert.equal(available.status, "available");
    assert.equal(available.version, "0.2.0");

    // Drafts and pre-releases are not offered.
    globalThis.fetch = reply({ tag_name: "v9.9.9", prerelease: true });
    assert.equal((await checkForUpdate("0.1.0")).status, "current");
    globalThis.fetch = reply({ tag_name: "v9.9.9", draft: true });
    assert.equal((await checkForUpdate("0.1.0")).status, "current");
  } finally {
    globalThis.fetch = original;
  }
});

test("a failed check reports an error instead of throwing", async () => {
  const { checkForUpdate } = await import("../dist-test/release.js");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError("network down"); };
    const offline = await checkForUpdate("0.1.0");
    assert.equal(offline.status, "error");
    assert.match(offline.message, /internet/i);

    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    assert.match((await checkForUpdate("0.1.0")).message, /No releases/i);

    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
    assert.match((await checkForUpdate("0.1.0")).message, /rate limit/i);
  } finally {
    globalThis.fetch = original;
  }
});
