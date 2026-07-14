// speak-grade.test.js — unit tests for the Speak Mode grading handler.
// Run: npx vitest run worker/
//
// The handler is a pure (request, env) function; we stub globalThis.fetch to
// play the role of Groq and assert the request/response contract: input caps,
// score clamping, tolerant JSON parsing, and failure modes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { speakGradeHandler } from "./speak-grade.js";

const ENV = { GROK_API_KEY: "test-key" };

function makeRequest(body) {
  return new Request("https://worker.test/api/speak-grade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Stub fetch to return a Groq-shaped success with the given content string. */
function stubGroq(content) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
  );
  globalThis.fetch = spy;
  return spy;
}

const GOOD_GRADE = {
  scores: { clarity: 7, structure: 6, grammar: 5, overall: 6 },
  grammarFixes: [{ before: "he go to office", after: "he goes to the office", why: "subject-verb agreement" }],
  structureNote: "Good opening, but the result was missing.",
  concisenessNote: "A little repetitive in the middle.",
  confidenceNote: "Your analogy was genuinely clear.",
  rewrites: ["I led the migration and cut deploy time in half."],
};

const VALID_BODY = {
  transcript: "so basically i was working on the project and he go to office every day to fix it",
  prompt: "Tell me about a time you fixed a production bug.",
  promptType: "behavioral",
  seconds: 42,
  words: 17,
  fillers: 1,
  typed: false,
};

const realFetch = globalThis.fetch;

describe("speakGradeHandler", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns 400 when the transcript is under 5 words", async () => {
    const res = await speakGradeHandler(makeRequest({ ...VALID_BODY, transcript: "um yes it" }), ENV);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too short/i);
  });

  it("returns 400 when the prompt is missing", async () => {
    const res = await speakGradeHandler(makeRequest({ ...VALID_BODY, prompt: "" }), ENV);
    expect(res.status).toBe(400);
  });

  it("grades a valid transcript and echoes the normalized fields", async () => {
    stubGroq(JSON.stringify(GOOD_GRADE));
    const res = await speakGradeHandler(makeRequest(VALID_BODY), ENV);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scores).toEqual({ clarity: 7, structure: 6, grammar: 5, overall: 6 });
    expect(body.grammarFixes).toHaveLength(1);
    expect(body.grammarFixes[0].after).toBe("he goes to the office");
    expect(body.rewrites).toHaveLength(1);
    expect(body._model).toMatch(/^groq\//);
  });

  it("caps the transcript sent to the LLM at 1800 chars", async () => {
    const spy = stubGroq(JSON.stringify(GOOD_GRADE));
    const huge = "word ".repeat(3000); // 15k chars
    const res = await speakGradeHandler(makeRequest({ ...VALID_BODY, transcript: huge }), ENV);
    expect(res.status).toBe(200);
    const sent = JSON.parse(spy.mock.calls[0][1].body);
    const userMsg = sent.messages.find((m) => m.role === "user").content;
    // Transcript is the last block of the user prompt; whole prompt stays small.
    expect(userMsg.length).toBeLessThan(1800 + 500);
  });

  it("clamps out-of-range scores into 1-10 and derives a missing overall", async () => {
    stubGroq(JSON.stringify({
      ...GOOD_GRADE,
      scores: { clarity: 42, structure: -3, grammar: "9", overall: null },
    }));
    const res = await speakGradeHandler(makeRequest(VALID_BODY), ENV);
    const body = await res.json();
    expect(body.scores.clarity).toBe(10);
    expect(body.scores.structure).toBe(1);
    expect(body.scores.grammar).toBe(9);
    // overall falls back to the rounded mean of the other three: (10+1+9)/3 ≈ 7
    expect(body.scores.overall).toBe(7);
  });

  it("tolerates fence-wrapped JSON from the model", async () => {
    stubGroq("```json\n" + JSON.stringify(GOOD_GRADE) + "\n```");
    const res = await speakGradeHandler(makeRequest(VALID_BODY), ENV);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scores.overall).toBe(6);
  });

  it("drops malformed grammar fixes and caps arrays", async () => {
    stubGroq(JSON.stringify({
      ...GOOD_GRADE,
      grammarFixes: [
        { before: "a", after: "b", why: "c" },
        { before: "", after: "x", why: "empty before dropped" },
        { before: "d", after: "e" },
        { before: "f", after: "g" },
        { before: "h", after: "i" },
        { before: "j", after: "k" },
        { before: "l", after: "m" },
      ],
      rewrites: ["one", "two", "three", "four", ""],
    }));
    const res = await speakGradeHandler(makeRequest(VALID_BODY), ENV);
    const body = await res.json();
    expect(body.grammarFixes.length).toBeLessThanOrEqual(5);
    expect(body.grammarFixes.every((f) => f.before && f.after)).toBe(true);
    expect(body.rewrites).toEqual(["one", "two", "three"]);
  });

  it("returns 502 when every provider fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("quota", { status: 429 }));
    const res = await speakGradeHandler(makeRequest(VALID_BODY), ENV);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/unavailable/i);
  });

  it("returns 502 when the model output is unparseable", async () => {
    stubGroq("sorry, I cannot help with that");
    const res = await speakGradeHandler(makeRequest(VALID_BODY), ENV);
    expect(res.status).toBe(502);
  });
});
