export function scanRawArgumentString(raw) {
  const source = String(raw ?? '');
  const tokens = [];
  let current = '';
  let start = null;
  let quote = null;
  let escaped = false;
  let quoted = false;
  let escapedToken = false;

  function startToken(index) {
    if (start === null) {
      start = index;
    }
  }

  function finishToken(end) {
    if (start === null) {
      return;
    }
    tokens.push({
      value: current,
      start,
      end,
      quoted,
      escaped: escapedToken,
    });
    current = '';
    start = null;
    quoted = false;
    escapedToken = false;
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      startToken(index);
      escaped = true;
      escapedToken = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      startToken(index);
      quote = char;
      quoted = true;
      continue;
    }
    if (/\s/.test(char)) {
      finishToken(index);
      continue;
    }
    startToken(index);
    current += char;
  }

  if (escaped) {
    current += '\\';
  }
  finishToken(source.length);
  return tokens;
}

export function splitRawArgumentString(raw) {
  return scanRawArgumentString(raw).map((token) => token.value);
}

export function normalizeArgv(args) {
  return args.length === 1 ? splitRawArgumentString(args[0]) : args;
}

export function isModeFlag(token, flag) {
  return token.value === flag && !token.quoted && !token.escaped;
}

export function isModelEqualsFlag(token) {
  return (
    !token.quoted &&
    !token.escaped &&
    token.value.startsWith('--model=') &&
    token.value.length > '--model='.length
  );
}

export function validateModelValue(flag, value) {
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function removeRawTokenSpans(raw, spans) {
  const source = String(raw ?? '');
  let result = String(raw ?? '');
  const expandedSpans = spans.map((span) => {
    let end = span.end;
    while (end < source.length && /\s/.test(source[end])) {
      end += 1;
    }
    return {
      ...span,
      end,
    };
  });

  for (const span of expandedSpans.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, span.start)}${result.slice(span.end)}`;
  }
  return result.trim();
}
