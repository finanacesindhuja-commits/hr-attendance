-- Run this SQL in your Supabase SQL Editor to create the leaves table
create table public.staff_leaves (
  id bigserial not null,
  staff_id text null,
  start_date date not null,
  end_date date not null,
  reason text null,
  status text null default 'Pending'::text,
  constraint staff_leaves_pkey primary key (id),
  constraint staff_leaves_staff_id_fkey foreign KEY (staff_id) references staff (staff_id)
) TABLESPACE pg_default;

-- Disable Row Level Security (consistent with other tables in this project)
ALTER TABLE public.staff_leaves DISABLE ROW LEVEL SECURITY;

-- Grant permissions to all roles
GRANT ALL ON TABLE public.staff_leaves TO anon, authenticated, postgres, service_role;
