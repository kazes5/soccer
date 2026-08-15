-- Align pre-existing Israeli local numbers with the application's E.164
-- normalizer. The unique index intentionally stops deployment if two legacy
-- rows collapse to the same identity; operators must resolve that collision
-- rather than silently merge accounts.
UPDATE "users"
SET "normalized_phone" = '+972' || substring("normalized_phone" FROM 2)
WHERE "normalized_phone" ~ '^0[0-9]{8,9}$';
