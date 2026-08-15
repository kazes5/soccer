-- Some legacy phone numbers were stored with a "00" international dialing
-- prefix instead of "+" (e.g. "00972501234567"). The original backfill
-- (20260813090000) only stripped punctuation, and the IL-local-number fix
-- (20260813140000) only matched a bare leading "0" followed by 8-9 digits, so
-- this shape was missed entirely — "00" needs to become "+" to match what the
-- runtime normalizePhone() (libphonenumber-js) produces, or password login
-- (which looks up only by the normalized column) silently fails for these
-- users while passkey login (which falls back to the raw column) still works.
-- As with the prior fix, the unique index intentionally stops deployment if
-- two legacy rows collapse to the same identity.
UPDATE "users"
SET "normalized_phone" = '+' || substring("normalized_phone" FROM 3)
WHERE "normalized_phone" ~ '^00[0-9]{6,15}$';
