import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CAMEL_CASE, isCollectionPath, KEBAB_SEGMENT, pathProblems } from "../src/functions.js";
import { seededRandom, toSnake } from "../src/mutations.js";

describe("naming patterns", () => {
  test("camelCase accepts lower camel names and rejects the rest", () => {
    for (const ok of ["id", "customerId", "nextCursor", "amountMinor", "a1", "x2Y3"]) assert.ok(CAMEL_CASE.test(ok), ok);
    for (const bad of ["", "Id", "customer_id", "customer-id", "customerID", "1st", "nextCursor_", "ab cd"]) {
      assert.ok(!CAMEL_CASE.test(bad), bad);
    }
  });

  test("kebab-case accepts lower dashed segments and rejects the rest", () => {
    for (const ok of ["orders", "order-lines", "v1", "a-b-c"]) assert.ok(KEBAB_SEGMENT.test(ok), ok);
    for (const bad of ["", "Orders", "order_lines", "order--lines", "-orders", "orders-", "1orders", "orderLines"]) {
      assert.ok(!KEBAB_SEGMENT.test(bad), bad);
    }
  });

  test("toSnake always produces a name that camelCase rejects", () => {
    for (const name of ["id", "customerId", "Order", "x"]) assert.ok(!CAMEL_CASE.test(toSnake(name)), name);
  });
});

describe("pathProblems", () => {
  test("accepts well-formed paths", () => {
    for (const ok of ["/", "/orders", "/orders/{orderId}", "/customers/{customerId}/orders", "/order-lines/{lineId}/cancellation"]) {
      assert.deepEqual(pathProblems(ok), [], ok);
    }
  });

  test("reports each bad segment with a precise message", () => {
    assert.deepEqual(pathProblems("orders"), ['Path "orders" must start with "/".']);
    assert.deepEqual(pathProblems("/orders/"), ['Path "/orders/" must not end with "/".']);
    assert.deepEqual(pathProblems("/orders//lines"), ['Path "/orders//lines" must not contain an empty segment.']);
    assert.deepEqual(pathProblems("/Orders/{order_id}"), [
      'Path segment "Orders" must be lower kebab-case.',
      'Path parameter "{order_id}" must be camelCase.',
    ]);
    assert.deepEqual(pathProblems("/orders/{}"), ['Path parameter "{}" must be camelCase.']);
  });

  test("collection paths are those not ending in a parameter", () => {
    assert.ok(isCollectionPath("/orders"));
    assert.ok(isCollectionPath("/customers/{customerId}/orders"));
    assert.ok(!isCollectionPath("/orders/{orderId}"));
    assert.ok(!isCollectionPath("/orders/"));
  });

  test("randomized: agrees with a character-level reference on 2,000 generated paths", () => {
    const rand = seededRandom(20261007);
    const alphabet = "abcXYZ019-_{}";
    /** Reference check written independently of the regular expressions. */
    const segmentOk = (s: string): boolean => {
      if (s.startsWith("{") && s.endsWith("}")) {
        const name = s.slice(1, -1);
        if (!/^[a-z]/.test(name)) return false;
        for (let i = 0; i < name.length; i++) {
          const c = name[i]!;
          if (!/[a-zA-Z0-9]/.test(c)) return false;
          if (/[A-Z]/.test(c) && (i + 1 >= name.length || !/[a-z0-9]/.test(name[i + 1]!))) return false;
        }
        return true;
      }
      if (!/^[a-z]/.test(s) || s.endsWith("-") || s.includes("--")) return false;
      return [...s].every((c) => /[a-z0-9-]/.test(c));
    };
    let valid = 0;
    for (let n = 0; n < 2000; n++) {
      const segments = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
        const len = 1 + Math.floor(rand() * 6);
        const body = Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
        return rand() < 0.3 ? `{${body.replace(/[{}]/g, "")}}` : body.replace(/[{}]/g, "a");
      });
      const path = `/${segments.join("/")}`;
      const expected = segments.every(segmentOk);
      if (expected) valid += 1;
      assert.equal(pathProblems(path).length === 0, expected, path);
    }
    assert.ok(valid > 50 && valid < 1950, `both outcomes exercised (valid=${valid})`);
  });
});
