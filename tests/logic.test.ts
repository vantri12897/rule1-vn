import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswerKey, parseQuizText } from "../src/lib/parse.ts";
import { grade, seededShuffle } from "../src/lib/grading.ts";
import { safeHtml } from "../src/lib/sanitize.ts";
import { mergeChunks } from "../src/lib/merge.ts";

test("parseAnswerKey: nhiều định dạng", () => {
  assert.deepEqual(parseAnswerKey("1A 2C 3b"), { 1: "A", 2: "C", 3: "B" });
  assert.deepEqual(parseAnswerKey("1-A, 2.C, 3) D, 4: b"), { 1: "A", 2: "C", 3: "D", 4: "B" });
  assert.deepEqual(parseAnswerKey("Câu 10: D\nCâu 11 - a"), { 10: "D", 11: "A" });
  assert.deepEqual(parseAnswerKey("1 A\n2 B\n3 C"), { 1: "A", 2: "B", 3: "C" });
});

test("parseQuizText: phương án cùng dòng và khác dòng", () => {
  const txt = `1. She ___ to school every day.
A. go   B. goes   C. going   D. gone
2) Which word is a noun?
A. quickly
B. happiness
C. run
D. blue
Question 3. I have lived here ___ 2010.
A. since B. for C. in D. at`;
  const qs = parseQuizText(txt);
  assert.equal(qs.length, 3);
  assert.equal(qs[0].stem, "She ___ to school every day.");
  assert.deepEqual(qs[0].options.map((o) => o.text), ["go", "goes", "going", "gone"]);
  assert.equal(qs[1].options[1].text, "happiness");
  assert.equal(qs[2].number, 3);
  assert.equal(qs[2].options[0].text, "since");
});

test("grade: đếm đúng, không phân biệt hoa thường, câu bỏ trống là sai", () => {
  const qs = [
    { id: "a", number: 1, correct_label: "A" },
    { id: "b", number: 2, correct_label: "B" },
    { id: "c", number: 3, correct_label: "C" },
  ];
  const r = grade(qs, { a: "a", b: "C" });
  assert.equal(r.score, 1);
  assert.equal(r.total, 3);
  assert.equal(r.details[2].selected, null);
  assert.equal(r.details[2].is_correct, false);
});

test("seededShuffle ổn định theo seed", () => {
  const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "tok-1");
  const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "tok-1");
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("safeHtml chặn script, giữ <u>", () => {
  assert.equal(safeHtml("<u>th</u>ink <script>x</script>"), "<u>th</u>ink &lt;script&gt;x&lt;/script&gt;");
  assert.equal(safeHtml('<u onclick="x">a</u>'), '&lt;u onclick=&quot;x&quot;&gt;a</u>');
});

test("mergeChunks: khử trùng lặp vùng chồng lấn + áp bảng đáp án", () => {
  const q = (n: number, opts = 4, label: string | null = null) => ({
    number: n, section_index: 0, section_ref: 0, stem: `Q${n}`,
    options: Array.from({ length: opts }, (_, i) => ({ label: "ABCD"[i], text: "x" })),
    correct_label: label, answer_source: "ai_solved" as const, confidence: 0.9, needs_review: false, explanation: null,
  });
  const r = mergeChunks([
    { sections: [{ instruction: "Choose", passage: null }], questions: [q(1), q(2), q(3, 2)] },
    { sections: [{ instruction: "Choose", passage: null }], questions: [q(3), q(4)], answer_key: { "1": "b", "4": "D" } },
  ]);
  assert.equal(r.questions.length, 4);
  assert.equal(r.sections.length, 1);
  assert.equal(r.questions[2].options.length, 4);
  assert.equal(r.questions[0].correct_label, "B");
  assert.equal(r.questions[0].answer_source, "from_pdf");
  assert.equal(r.questions[3].correct_label, "D");
});

test("mergeChunks giữ hình của câu khi bản trùng ở cụm sau không có hình", () => {
  const base = { section_index: null, section_ref: null, stem: "What does the sign say?", correct_label: null, answer_source: "manual" as const, confidence: null, needs_review: false, explanation: null };
  const opts = ["A", "B", "C", "D"].map((l) => ({ label: l, text: "x" }));
  const r = mergeChunks([
    { sections: [], questions: [{ ...base, number: 5, options: opts, image: "data:image/jpeg;base64,AAA" }] },
    { sections: [], questions: [{ ...base, number: 5, options: [...opts, { label: "E", text: "y" }], image: null }] },
  ]);
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].options.length, 5);
  assert.equal(r.questions[0].image, "data:image/jpeg;base64,AAA");
});

import { canShuffle, displayOptions, optionPerm, toDisplay, toOriginal } from "../src/lib/option-shuffle.ts";

test("xáo đáp án: quy đổi qua lại đúng, ổn định theo token, không xáo câu 'All of the above'", () => {
  const opts = ["go", "goes", "going", "gone"].map((t, i) => ({ label: "ABCD"[i], text: t }));
  const perm = optionPerm("tok-1", "q-1", 4);
  assert.deepEqual(perm, optionPerm("tok-1", "q-1", 4));
  assert.deepEqual([...perm].sort(), [0, 1, 2, 3]);
  const shown = displayOptions(opts, perm);
  // học viên chọn phương án có chữ "goes" ở vị trí hiển thị nào đó → server đổi về B gốc
  const shownLetter = shown.find((o) => o.text === "goes")!.label;
  assert.equal(toOriginal(shownLetter, opts, perm), "B");
  assert.equal(toDisplay("B", opts, perm), shownLetter);
  // nhiều học viên → không phải ai cũng cùng thứ tự
  const perms = new Set(Array.from({ length: 20 }, (_, i) => optionPerm(`tok-${i}`, "q-1", 4).join("")));
  assert.ok(perms.size > 5);
  assert.equal(canShuffle(opts), true);
  assert.equal(canShuffle([...opts.slice(0, 3), { label: "D", text: "All of the above" }]), false);
  assert.equal(canShuffle([...opts.slice(0, 3), { label: "D", text: "Both A and B" }]), false);
});

test("safeHtml cho phép màu tô của giáo viên, chặn thuộc tính lạ", async () => {
  const { safeHtml } = await import("../src/lib/sanitize.ts");
  assert.equal(safeHtml('<mark data-c="y"><b>x</b></mark>'), '<mark data-c="y"><b>x</b></mark>');
  assert.equal(safeHtml('<mark data-c="z" onclick="a()">x</mark>'), '&lt;mark data-c=&quot;z&quot; onclick=&quot;a()&quot;&gt;x</mark>');
  assert.equal(safeHtml('<mark style="x">y</mark>'), "&lt;mark style=&quot;x&quot;&gt;y</mark>");
});
