// Proves the guess matcher: exact and reordered answers match, endings and small words are
// forgiven, a one-letter mishearing is forgiven in long words only, part of an answer is "close",
// unrelated talk and short look-alikes are a miss, and listed synonyms count.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editDistance, keyStems, ruleGuess, stemOf, wordsOf } from "./matching.ts";

describe("words and stems", () => {
    it("drops accents, punctuation and apostrophes", () => {
        assert.deepEqual(wordsOf("The Baker's Café, & friends!"), ["the", "bakers", "cafe", "and", "friends"]);
    });

    it("gives one stem to the endings of a word", () => {
        assert.equal(stemOf("sneezing"), stemOf("sneeze"));
        assert.equal(stemOf("sneezes"), stemOf("sneeze"));
        assert.equal(stemOf("running"), stemOf("run"));
        assert.equal(stemOf("dancing"), stemOf("danced"));
        assert.equal(stemOf("bakeries"), stemOf("bakery"));
    });

    it("leaves small words out of the key words", () => {
        assert.deepEqual(keyStems("The Giant Sandwich of Doom"), ["giant", "sandwich", "doom"]);
    });

    it("measures a swap of neighbours as one slip", () => {
        assert.equal(editDistance("sandwhich", "sandwich"), 1);
        assert.equal(editDistance("teh", "the"), 1);
        assert.equal(editDistance("kitten", "sitting"), 3);
    });
});

describe("ruling a guess", () => {
    it("matches the answer said inside a sentence", () => {
        assert.equal(ruleGuess("is it a penguin in a hat", "Penguin Hat", []), "match");
    });

    it("forgives word order, small words and plurals", () => {
        assert.equal(ruleGuess("sandwich giant", "The Giant Sandwich", []), "match");
        assert.equal(ruleGuess("giant sandwiches", "The Giant Sandwich", []), "match");
    });

    it("forgives an action said in another ending", () => {
        assert.equal(ruleGuess("he's sneezing", "Sneeze", []), "match");
        assert.equal(ruleGuess("sneeze", "Sneezing", []), "match");
    });

    it("forgives a one-letter mishearing in a long word", () => {
        assert.equal(ruleGuess("lighthouse keaper", "Lighthouse Keeper", []), "match");
    });

    it("does not forgive a one-letter difference in a short word", () => {
        assert.equal(ruleGuess("a cat", "Cut", []), "miss");
        assert.equal(ruleGuess("a hat", "Hit", []), "miss");
    });

    it("rules part of an answer close, and none of it a miss", () => {
        assert.equal(ruleGuess("giant", "Giant Sandwich", []), "close");
        assert.equal(ruleGuess("a sandwich", "Giant Sandwich Attack", []), "miss");
        assert.equal(ruleGuess("giant sandwich", "Giant Sandwich Attack", []), "close");
        assert.equal(ruleGuess("is it a banana", "Giant Sandwich", []), "miss");
    });

    it("rules a near single word close", () => {
        assert.equal(ruleGuess("juggler", "Juggling", []), "close");
        assert.equal(ruleGuess("swimmer", "Swimming", []), "close");
    });

    it("counts a listed synonym as the answer", () => {
        assert.equal(ruleGuess("is it a sofa", "Couch Potato", ["Sofa"]), "match");
        assert.equal(ruleGuess("sofa surfing", "Couch Potato", ["Sofa Surfing"]), "match");
    });

    it("is not fooled by empty or silent guesses", () => {
        assert.equal(ruleGuess("", "Sneeze", []), "miss");
        assert.equal(ruleGuess("the a an", "Sneeze", []), "miss");
    });

    it("never matches on an answer that has no key words", () => {
        assert.equal(ruleGuess("the a an", "The A", []), "miss");
    });
});
