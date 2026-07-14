-- Create bucket
insert into storage.buckets (id, name, public)
values ('business_logos', 'business_logos', true)
on conflict (id) do nothing;

-- Create policy to allow public viewing
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'business_logos' );

-- Create policy to allow authenticated users to insert/upload
create policy "Authenticated users can upload logos"
on storage.objects for insert
with check ( bucket_id = 'business_logos' and auth.role() = 'authenticated' );

-- Create policy to allow authenticated users to update/delete
create policy "Authenticated users can update logos"
on storage.objects for update
using ( bucket_id = 'business_logos' and auth.role() = 'authenticated' );

create policy "Authenticated users can delete logos"
on storage.objects for delete
using ( bucket_id = 'business_logos' and auth.role() = 'authenticated' );
