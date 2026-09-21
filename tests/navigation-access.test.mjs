import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/navigation-access.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { canOpenPage } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("every member can reach help and the start page", () => {
    for (const path of ["/dashboard", "/guide", "/getting-started", "/my-hr/requests"]) {
        assert.equal(canOpenPage(path, "staff", []), true);
    }
});
test("staff only see their granted destinations", () => {
    assert.equal(canOpenPage("/products", "staff", ["/orders"]), false);
    assert.equal(canOpenPage("/orders/new", "staff", ["/orders"]), true);
    assert.equal(canOpenPage("/orders-private", "staff", ["/orders"]), false);
    assert.equal(canOpenPage("/orders", "staff", ["/orders/new"]), false);
    assert.equal(canOpenPage("/settings", "staff", ["/"]), false);
});
test("legacy platform permissions still work in both directions", () => {
    assert.equal(canOpenPage("/platform-orders", "staff", ["/easy-orders"]), true);
    assert.equal(canOpenPage("/easy-orders", "staff", ["/platform-orders"]), true);
});
test("owner/admin role spellings and system admin retain access", () => {
    for (const role of ["owner", "admin", "platform admin", "super_admin", "super admin"]) {
        assert.equal(canOpenPage("/settings", role, []), true);
    }
    assert.equal(canOpenPage("/settings", null, [], true), true);
    assert.equal(canOpenPage("/settings", "supervisor", []), false);
});
