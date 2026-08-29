import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Rewrites `ok(label, cond, detail?)` into a real Vitest case using the TypeScript
 * parser, so template literals, nested calls and regex literals are handled by the
 * language's own grammar rather than by a hand-rolled scanner.
 */
export function rewrite(text) {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const edits = [];
  const walk = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ok') {
      const [label, cond, detail] = node.arguments;
      if (label && cond) {
        // the statement, so the trailing semicolon goes with it
        let stmt = node;
        while (stmt.parent && !ts.isExpressionStatement(stmt)) stmt = stmt.parent;
        const start = stmt.getStart(sf);
        const line = sf.getLineAndCharacterOfPosition(start).line;
        const lineStart = sf.getPositionOfLineAndCharacter(line, 0);
        const indent = text.slice(lineStart, start);
        const reindent = (s) => s.split('\n').join('\n  ');
        const body =
          `it(${label.getText(sf)}, () => {\n` +
          `${indent}  expect(${reindent(cond.getText(sf))}` +
          (detail ? `, ${reindent(detail.getText(sf))}` : '') +
          `).toBe(true);\n${indent}});`;
        edits.push({ start, end: stmt.getEnd(), body });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.body + out.slice(e.end);
  return { out, count: edits.length };
}

if (process.argv[2]) {
  const p = process.argv[2];
  const { out, count } = rewrite(readFileSync(p, 'utf8'));
  writeFileSync(p, out);
  console.log(p, '->', count, 'assertions');
}
