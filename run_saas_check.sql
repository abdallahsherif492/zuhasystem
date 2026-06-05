DO $$
DECLARE
    v_business_id UUID;
BEGIN
    SELECT id INTO v_business_id FROM public.businesses WHERE name = 'Zuha System' LIMIT 1;
    IF v_business_id IS NULL THEN
        RAISE NOTICE 'No Zuha System business found!';
    ELSE
        RAISE NOTICE 'Found business %', v_business_id;
    END IF;
END $$;
