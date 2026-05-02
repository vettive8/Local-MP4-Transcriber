export const splitWordToWidth = (pdf, word, maxWidth) => {
  const parts = [];
  let current = '';

  for (const char of Array.from(word)) {
    const next = `${current}${char}`;

    if (current && pdf.getTextWidth(next) > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = next;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
};

export const wrapTextToWidth = (pdf, text, maxWidth) => {
  const lines = [];

  for (const sourceLine of text.split(/\r?\n/)) {
    const words = sourceLine.trim().split(/\s+/).filter(Boolean);
    let currentLine = '';

    for (const word of words) {
      const candidates = pdf.getTextWidth(word) > maxWidth ? splitWordToWidth(pdf, word, maxWidth) : [word];

      for (const candidate of candidates) {
        const nextLine = currentLine ? `${currentLine} ${candidate}` : candidate;

        if (currentLine && pdf.getTextWidth(nextLine) > maxWidth) {
          lines.push(currentLine);
          currentLine = candidate;
        } else {
          currentLine = nextLine;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
};
