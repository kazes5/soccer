export const duration = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decelerate: 'cubic-bezier(0, 0, 0, 1)',
  accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
} as const;
