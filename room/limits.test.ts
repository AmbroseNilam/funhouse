// Checks that the pre-recorded line bank is budgeted apart from the host's spoken lines, so a day
// of room openings cannot lock new rooms out, and that the spoken budget still closes the door.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SpendBudget } from "./limits.ts";

test("spending the whole bank leaves room for new rooms", () => {
    const budget: SpendBudget = new SpendBudget({ spark: 10, voice: 10, image: 10, bank: 3, guest: 10 });
    assert.equal(budget.spend("bank"), true);
    assert.equal(budget.spend("bank"), true);
    assert.equal(budget.spend("bank"), true);
    assert.equal(budget.spend("bank"), false);
    assert.equal(budget.hasRoom(), true);
});

test("spending the whole spoken budget closes the door", () => {
    const budget: SpendBudget = new SpendBudget({ spark: 10, voice: 2, image: 10, bank: 10, guest: 10 });
    assert.equal(budget.spend("voice"), true);
    assert.equal(budget.spend("voice"), true);
    assert.equal(budget.spend("voice"), false);
    assert.equal(budget.hasRoom(), false);
});

test("the bank does not draw on the spoken budget", () => {
    const budget: SpendBudget = new SpendBudget({ spark: 10, voice: 1, image: 10, bank: 10, guest: 10 });
    for (let count = 0; count < 10; count += 1) {
        assert.equal(budget.spend("bank"), true);
    }
    assert.equal(budget.spend("voice"), true);
    assert.equal(budget.hasRoom(), false);
});

test("spending every guest decision leaves room for new rooms and takes nothing from the host", () => {
    const budget: SpendBudget = new SpendBudget({ spark: 1, voice: 1, image: 1, bank: 1, guest: 2 });
    assert.equal(budget.spend("guest"), true);
    assert.equal(budget.spend("guest"), true);
    assert.equal(budget.spend("guest"), false);
    assert.equal(budget.hasRoom(), true);
    assert.equal(budget.spend("spark"), true);
});
