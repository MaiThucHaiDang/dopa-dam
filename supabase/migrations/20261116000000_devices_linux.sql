-- Allow Linux desktop agents as a device platform. The original check came from the init migration
-- (Postgres names an unnamed column check <table>_<column>_check).

alter table public.devices drop constraint devices_platform_check;
alter table public.devices
  add constraint devices_platform_check check (platform in ('android', 'windows', 'linux', 'extension'));
