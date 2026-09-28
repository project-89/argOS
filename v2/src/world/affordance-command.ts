/** Match an issued interaction against its advertised command, not just the
 * first word. Availability is not execution or proof of a correct argument:
 * world executors still validate types, secrets and physical prerequisites. */

function argumentTokens(content: string): Array<{ value: string; quoted: boolean }> | undefined {
  const tokens: Array<{ value: string; quoted: boolean }> = [];
  let offset = 0;
  while (offset < content.length) {
    while (/\s/.test(content[offset] || "") && offset < content.length) offset++;
    if (offset === content.length) break;
    const quote = content[offset] === '"' || content[offset] === "'" ? content[offset++] : undefined;
    let value = "", closed = !quote;
    while (offset < content.length) {
      const character = content[offset];
      if (quote) {
        offset++;
        if (character === quote) { closed = true; break; }
        if (character === "\\" && offset < content.length) value += content[offset++];
        else value += character;
      } else {
        if (/\s/.test(character)) break;
        // These are command separators or copied placeholder syntax, not an
        // unquoted argument. Quoted text is one value, never evaluated here.
        if (/[<>;|&`"']/.test(character)) return;
        value += character; offset++;
      }
    }
    if (!closed || !value.trim() || /[<>]/.test(value)
      || offset < content.length && !/\s/.test(content[offset])) return;
    tokens.push({ value, quoted: Boolean(quote) });
  }
  return tokens;
}

/** Single-verb legacy tools accept their existing argument syntax unchanged.
 * Multiword controls match the complete literal command. A <descriptive slot>
 * requires one nonempty argument (quote a multiword value); slot labels are not
 * parsed as an English type system or populated with hidden world answers. */
export function matchesAffordanceCommand(advertisedName: string, content: string): boolean {
  const name = String(advertisedName || "").trim(), issued = String(content || "").trim();
  if (!name || !issued) return false;
  if (!/\s|[<>]/.test(name)) return (issued.match(/^\S+/)?.[0] || "").toLowerCase() === name.toLowerCase();
  if (!/[<>]/.test(name)) {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ");
    return normalize(name) === normalize(issued);
  }
  const pattern = name.match(/<[^<>]+>|[^\s<>]+/g) || [];
  // Malformed/unbalanced template punctuation must not widen availability.
  if (!pattern.length || name.replace(/<[^<>]+>|[^\s<>]+/g, "").trim()) return false;
  const supplied = argumentTokens(issued);
  return !!supplied && supplied.length === pattern.length && pattern.every((part, index) =>
    part.startsWith("<") ? Boolean(supplied[index].value.trim())
      : !supplied[index].quoted && part.toLowerCase() === supplied[index].value.toLowerCase());
}
