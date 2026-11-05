// Checks the money rules: allowances per payer, the site ceiling, stages, passes, and surviving a restart.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { charge, flushSpend, mayCharge, payerOf, redeemPass, resetMeterForTest, spendSummary, stageOf, withPayer } from "./meter.ts";

beforeEach(() => {
    resetMeterForTest();
    process.env.COST_LIMITS = "1";
    process.env.COST_DIR = mkdtempSync(join(tmpdir(), "meter-"));
    process.env.COST_ADDRESS_DOLLARS = "2";
    process.env.COST_JUDGE_RESERVE_DOLLARS = "5";
    process.env.COST_SITE_DOLLARS = "15";
    process.env.COST_JUDGE_CODE = "judge-code";
    process.env.COST_OWNER_CODE = "owner-code";
});

test("keeps paintings on to the end, loses the voice at 90%, and stops at 100%", () => {
    const payer: string = payerOf("203.0.113.5");
    withPayer(payer, () => {
        assert.equal(mayCharge("image"), true);
        charge("spark", 1.2);
        assert.equal(mayCharge("image"), true);
        assert.equal(mayCharge("voice"), true);
        charge("spark", 0.65);
        assert.equal(mayCharge("voice"), false);
        assert.equal(mayCharge("image"), true);
        assert.equal(mayCharge("spark"), true);
        charge("spark", 0.15);
        assert.equal(mayCharge("spark"), false);
        assert.equal(mayCharge("image"), false);
    });
    assert.equal(stageOf(payerOf("203.0.113.6")), 0);
});

test("the site ceiling stops everyone, and IPv6 counts by its /64", () => {
    assert.equal(payerOf("2001:db8:1:2:aaaa::1"), payerOf("2001:0db8:1:2:bbbb::9"));
    assert.notEqual(payerOf("2001:db8:1:3::1"), payerOf("2001:db8:1:2::1"));
    for (let index: number = 0; index < 8; index += 1) {
        withPayer(payerOf(`198.51.100.${index}`), () => { charge("spark", 1.9); });
    }
    assert.equal(stageOf(payerOf("198.51.100.200")), 3);
});

test("the public share runs out before the ceiling, and judges keep the reserve", () => {
    for (let index: number = 0; index < 6; index += 1) {
        withPayer(payerOf(`192.0.2.${index}`), () => { charge("spark", 1.9); });
    }
    assert.equal(stageOf(payerOf("192.0.2.200")), 3);
    const judged: string = payerOf("192.0.2.201");
    redeemPass("judge-code", [judged]);
    assert.equal(stageOf(judged) < 3, true);
});

test("a judge pass lifts the allowance and the owner's passes everything; wrong codes do nothing", () => {
    const judged: string = payerOf("203.0.113.7");
    withPayer(judged, () => { charge("spark", 2); });
    assert.equal(redeemPass("wrong", [judged]), null);
    assert.equal(stageOf(judged), 3);
    assert.equal(redeemPass("judge-code", [judged]), "judge");
    assert.equal(stageOf(judged), 0);
    const owner: string = payerOf("203.0.113.8");
    assert.equal(redeemPass("owner-code", [owner]), "owner");
    withPayer(owner, () => { charge("spark", 100); });
    assert.equal(stageOf(owner), 0);
});

test("the day survives a restart", () => {
    const payer: string = payerOf("203.0.113.9");
    withPayer(payer, () => { charge("jev", 2, { calls: 1 }); });
    flushSpend();
    resetMeterForTest();
    assert.equal(payerOf("203.0.113.9"), payer);
    assert.equal(stageOf(payer), 3);
    assert.equal(spendSummary().siteDollars, 2);
});

test("a damaged store stops spending without throwing", () => {
    writeFileSync(join(process.env.COST_DIR ?? "", "spend.json"), "{nope");
    assert.equal(mayCharge("spark"), false);
});

test("a store with parts missing stops spending without throwing", () => {
    writeFileSync(join(process.env.COST_DIR ?? "", "spend.json"), JSON.stringify({ day: "2026-11-04", salt: "x", accounts: null }));
    assert.equal(mayCharge("spark"), false);
    assert.equal(stageOf("anyone"), 3);
});

test("an unwritable store stops spending, and recovers", () => {
    const directory: string = process.env.COST_DIR ?? "";
    charge("spark", 0.01);
    process.env.COST_DIR = join(directory, "file");
    writeFileSync(process.env.COST_DIR, "not a folder");
    flushSpend();
    assert.equal(mayCharge("spark"), false);
    rmSync(process.env.COST_DIR);
    flushSpend();
    assert.equal(mayCharge("spark"), true);
});

test("limits off allows everything", () => {
    process.env.COST_LIMITS = "0";
    assert.equal(mayCharge("image"), true);
    assert.equal(stageOf("anyone"), 0);
});
