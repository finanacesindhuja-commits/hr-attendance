-- Add Aadhaar Front and Back URL columns to the staff table
ALTER TABLE staff 
ADD COLUMN aadhaar_front_url TEXT,
ADD COLUMN aadhaar_back_url TEXT;
