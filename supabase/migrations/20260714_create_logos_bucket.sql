-- Create a new storage bucket for business logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'business_logos',
    'business_logos',
    true,
    5242880, -- 5MB limit
    '{image/png,image/jpeg,image/svg+xml,image/webp}'
) ON CONFLICT (id) DO NOTHING;

-- Allow public read access to the bucket
CREATE POLICY "Public Read Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'business_logos' );

-- Allow authenticated users to insert files
CREATE POLICY "Authenticated users can upload logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'business_logos' );

-- Allow authenticated users to update files
CREATE POLICY "Authenticated users can update logos"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'business_logos' );

-- Allow authenticated users to delete files
CREATE POLICY "Authenticated users can delete logos"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'business_logos' );
