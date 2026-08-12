import '@testing-library/jest-dom/vitest';

process.env.NEXT_PUBLIC_API_URL ??= 'http://localhost:4000';

// jsdom doesn't implement Element.scrollIntoView at all (not even a no-op) —
// stub it so components that scroll a deep-linked row into view don't crash
// under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
