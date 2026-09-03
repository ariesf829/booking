-- Rally Reserve database setup
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  phone_number text not null,
  role text check (role in ('customer', 'admin')) default 'customer',
  created_at timestamptz default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete restrict not null,
  court_number integer check (court_number in (1, 2)) not null,
  booking_date date not null,
  start_hour integer check (start_hour between 7 and 21) not null,
  end_hour integer generated always as (start_hour + 1) stored,
  amount numeric(10,2) not null default 350,
  status text check (status in ('pending', 'confirmed', 'cancelled')) not null default 'pending',
  gcash_reference text,
  payment_proof_path text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  confirmed_at timestamptz,
  unique (court_number, booking_date, start_hour)
);

create index if not exists bookings_date_idx on public.bookings (booking_date, court_number, start_hour);

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "Customers can view own profile" on public.profiles;
create policy "Customers can view own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Customers can update own profile" on public.profiles;
create policy "Customers can update own profile" on public.profiles for update using (auth.uid() = id);
drop policy if exists "Customers view own bookings" on public.bookings;
drop policy if exists "Authenticated users view bookings" on public.bookings;
create policy "Authenticated users view bookings" on public.bookings for select using (auth.uid() is not null);
drop policy if exists "Customers create own bookings" on public.bookings;
create policy "Customers create own bookings" on public.bookings for insert with check (auth.uid() = user_id);
drop policy if exists "Customers update own pending bookings" on public.bookings;
create policy "Customers update own pending bookings" on public.bookings for update using (auth.uid() = user_id and status = 'pending');

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles" on public.profiles for select using (public.is_admin());
drop policy if exists "Admins can view all bookings" on public.bookings;
create policy "Admins can view all bookings" on public.bookings for select using (public.is_admin());
drop policy if exists "Admins can update bookings" on public.bookings;
create policy "Admins can update bookings" on public.bookings for update using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone_number)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'New customer'), coalesce(new.raw_user_meta_data->>'phone_number', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.expire_pending_bookings()
returns void language sql security definer set search_path = public as $$
  update public.bookings set status = 'cancelled'
  where status = 'pending' and created_at < now() - interval '10 minutes';
$$;

-- Schedule this function with pg_cron in Supabase:
-- select cron.schedule('expire-pending-bookings', '* * * * *', $$select public.expire_pending_bookings()$$);

-- Create a private Storage bucket named `payment-proofs` and restrict uploads
-- to authenticated users through Storage policies. Confirmation email delivery
-- belongs in an Edge Function triggered after an admin changes status to confirmed.
