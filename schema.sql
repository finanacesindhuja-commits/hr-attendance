-- HR Staff Attendance System - FINAL SCHEMA

-- 1. Staff Table (Assuming already exists from previous project, but included for completeness)
CREATE TABLE IF NOT EXISTS staff (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  mobile text,
  staff_id text UNIQUE NOT NULL,
  password text NOT NULL,
  is_password_set boolean DEFAULT false,
  role text DEFAULT 'staff',
  police_verification_url text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Staff Attendance Table
CREATE TABLE IF NOT EXISTS staff_attendance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff(staff_id),
  date date DEFAULT CURRENT_DATE,
  check_in timestamp with time zone,
  check_out timestamp with time zone,
  check_in_lat double precision,
  check_in_lng double precision,
  check_out_lat double precision,
  check_out_lng double precision,
  status text DEFAULT 'present',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(staff_id, date)
);

-- 3. Live Location Tracking Table
CREATE TABLE IF NOT EXISTS staff_locations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff(staff_id),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  timestamp timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Permissions
ALTER TABLE staff_attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE staff_locations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE staff_attendance TO anon, authenticated, postgres, service_role;
GRANT ALL ON TABLE staff_locations TO anon, authenticated, postgres, service_role;
