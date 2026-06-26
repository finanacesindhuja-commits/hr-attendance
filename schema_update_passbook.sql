-- Add passbook_url to staff table
ALTER TABLE staff
ADD COLUMN IF NOT EXISTS passbook_url text;

-- (Optional) If you haven't created the storage bucket, create a public bucket named 'passbook' in Supabase Storage.
