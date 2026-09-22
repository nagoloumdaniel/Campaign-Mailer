-- The address book: one entry per email address and per account.
--
-- Until now a "contact" was a recipient row of one campaign, and the same
-- person imported into three campaigns was three contacts. The owner asked on
-- 22 September 2026 for a Contacts page with one line per address, whatever
-- its source, editable at any time, and for campaigns already sent to keep
-- what they sent:
--
--   * `address_book` holds the person: address, name, company, salutation,
--     where they came from, when they were first added.
--   * `contacts` stays what it was, the recipients of one campaign, and is now
--     a snapshot taken from the book. `book_id` links the two.
--   * Editing the book rewrites only the recipients still to be sent
--     (application code); sent and failed rows keep what went out.
--
-- A trigger links every new recipient to its entry, creating it when the
-- address is new, so the CSV import, the manual add, the follow-up copy and a
-- later MailFind import all feed the book without each remembering to. When
-- the address is already there, the entry keeps its values and only its empty
-- fields are filled (owner's choice), and the recipient borrows from the entry
-- whatever the import left empty.

-- Up Migration

CREATE TABLE address_book (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email         text        NOT NULL,
  contact_name  text,
  company_name  text,
  salutation    text,
  source        text        NOT NULL DEFAULT 'csv'
                CONSTRAINT address_book_source_check
                CHECK (source IN ('csv', 'manual', 'mailfind')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX address_book_user_email_idx ON address_book (user_id, lower(email));

ALTER TABLE contacts
  ADD COLUMN book_id uuid REFERENCES address_book (id) ON DELETE SET NULL;

CREATE INDEX contacts_book_idx ON contacts (book_id);

-- Every address already imported, once, as it was first seen: its earliest
-- row gives the values, the date and the source.
INSERT INTO address_book (user_id, email, contact_name, company_name, salutation, source, created_at)
SELECT DISTINCT ON (c.user_id, lower(ct.email))
       c.user_id, ct.email, ct.contact_name, ct.company_name, ct.salutation, ct.source,
       ct.created_at
FROM contacts ct
JOIN campaigns c ON c.id = ct.campaign_id
ORDER BY c.user_id, lower(ct.email), ct.created_at, ct.id;

UPDATE contacts ct
SET book_id = ab.id
FROM campaigns c, address_book ab
WHERE c.id = ct.campaign_id
  AND ab.user_id = c.user_id
  AND lower(ab.email) = lower(ct.email);

CREATE FUNCTION contacts_link_address_book() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner  uuid;
  entry  address_book%ROWTYPE;
BEGIN
  IF NEW.book_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO owner FROM campaigns WHERE id = NEW.campaign_id;

  INSERT INTO address_book (user_id, email, contact_name, company_name, salutation, source)
  VALUES (owner, NEW.email, NEW.contact_name, NEW.company_name, NEW.salutation, NEW.source)
  ON CONFLICT (user_id, lower(email)) DO UPDATE
    SET contact_name = COALESCE(address_book.contact_name, EXCLUDED.contact_name),
        company_name = COALESCE(address_book.company_name, EXCLUDED.company_name),
        salutation   = COALESCE(address_book.salutation, EXCLUDED.salutation)
  RETURNING * INTO entry;

  NEW.book_id      := entry.id;
  NEW.contact_name := COALESCE(NEW.contact_name, entry.contact_name);
  NEW.company_name := COALESCE(NEW.company_name, entry.company_name);
  NEW.salutation   := COALESCE(NEW.salutation, entry.salutation);
  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_link_address_book
  BEFORE INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION contacts_link_address_book();

-- Down Migration

DROP TRIGGER contacts_link_address_book ON contacts;
DROP FUNCTION contacts_link_address_book();
ALTER TABLE contacts DROP COLUMN book_id;
DROP TABLE address_book;
