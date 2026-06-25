ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS delay_minutes INT DEFAULT 0;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS auto_logged_out BOOLEAN DEFAULT false;
