import { HabitBook } from "../habit-book";

const S = "choosing|fisher|morning|even|make raw-fish,rest,sell";

test("a choice that keeps winning becomes a candidate, is written when agreed, and is then done blind — checked now and then", () => {
  const book = new HabitBook({ minCount: 3, minShare: .8, checkEvery: 3, maxMisses: 2 });
  book.record("Otis", S, "make raw-fish"); book.record("Otis", S, "make raw-fish");
  expect(book.candidate("Otis", S)).toBeUndefined(); // twice is not yet a pattern
  book.record("Otis", S, "make raw-fish");
  expect(book.candidate("Otis", S)).toBe("make raw-fish");
  expect(book.candidate("Leon", S)).toBeUndefined(); // habits are one person's
  expect(book.use("Otis", S)).toBeUndefined(); // not written yet: ask the judge
  book.write("Otis", S, "make raw-fish", 1000);
  expect(book.candidate("Otis", S)).toBeUndefined();
  expect(book.use("Otis", S)).toEqual({ choice: "make raw-fish" });
  expect(book.use("Otis", S)).toEqual({ choice: "make raw-fish" });
  expect(book.use("Otis", S)).toBe("check"); // every third use, the judge is asked
  book.checked("Otis", S, "make raw-fish"); // agreed: kept
  expect(book.of("Otis")).toEqual({ [S]: "make raw-fish" });
  expect(book.stats).toMatchObject({ written: 1, used: 2, checked: 1, dropped: 0 });
});

test("a mixed record is no habit; a habit the judge twice disagrees with, or that fails in the world, is dropped", () => {
  const book = new HabitBook({ minCount: 3, minShare: .8, checkEvery: 1, maxMisses: 2 });
  for (const c of ["sell", "sell", "sell", "rest"]) book.record("Tess", S, c);
  expect(book.candidate("Tess", S)).toBeUndefined(); // 75% is not settled
  book.write("Tess", S, "sell", 0);
  book.checked("Tess", S, "rest");
  expect(book.habitFor("Tess", S)).toBeDefined();
  book.checked("Tess", S, "rest");
  expect(book.habitFor("Tess", S)).toBeUndefined();
  book.write("Tess", S, "sell", 0);
  book.broke("Tess", S);
  expect(book.count()).toBe(0);
  expect(book.stats.dropped).toBe(2);
});

test("habits carry across sessions by name (tallies too); use counters start afresh", () => {
  const book = new HabitBook();
  for (let i = 0; i < 3; i++) book.record("Ada", S, "make net");
  book.write("Ada", S, "make net", 5);
  book.use("Ada", S);
  const again = HabitBook.fromJson(JSON.parse(JSON.stringify(book.toJson())));
  expect(again.of("Ada")).toEqual({ [S]: "make net" });
  expect(again.habitFor("Ada", S)).toMatchObject({ choice: "make net", writtenAt: 5, uses: 0 });
  again.record("Ada", S, "make net");
  expect(again.toJson().tallies.Ada[S]["make net"]).toBe(4);
});
