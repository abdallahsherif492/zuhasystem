-- Data fix 4: Zuha Store damages valued at the selling price
-- Applied: 2026-10-31 (directly, through the API)
--
-- Damages are valued at cost (cost_at_time, copied from the product when the
-- damage is recorded; total_loss = quantity × cost_at_time). Four were recorded
-- while the product's cost was wrongly its selling price: KO7 399→225 (3 pcs),
-- G34 385→275, BT2 199→75. KO7's resolutions (all 3 pieces) carried the same
-- 399: unit_cost → 225 and recovered_value → 225 a piece, so KO7 still nets to
-- zero, as it did. Stock is untouched: those triggers run on insert only.
--
-- ROLLBACK:
BEGIN;
UPDATE public.inventory_damages SET cost_at_time = 399 WHERE id = 'e9fed4c9-5c03-4328-9b59-949a8bc1be1a' AND business_id = '96e0b0f1-2a87-4b2d-90ba-cc5e9d9ce363';
UPDATE public.inventory_damages SET cost_at_time = 399 WHERE id = '645186c8-b3a9-4d01-bd67-8f2073a4b436' AND business_id = '96e0b0f1-2a87-4b2d-90ba-cc5e9d9ce363';
UPDATE public.inventory_damages SET cost_at_time = 385 WHERE id = '84d70566-e986-4690-9248-6ef7cf901e17' AND business_id = '96e0b0f1-2a87-4b2d-90ba-cc5e9d9ce363';
UPDATE public.inventory_damages SET cost_at_time = 199 WHERE id = '4deed302-beb8-409d-82bc-ad838db6d889' AND business_id = '96e0b0f1-2a87-4b2d-90ba-cc5e9d9ce363';
UPDATE public.inventory_damage_resolutions SET unit_cost = 399, recovered_value = 798 WHERE id = '867647b8-f309-41e1-8784-3d70646f63b3' AND business_id = '96e0b0f1-2a87-4b2d-90ba-cc5e9d9ce363';
UPDATE public.inventory_damage_resolutions SET unit_cost = 399, recovered_value = 399 WHERE id = 'a88f2273-e46e-4505-84ab-b6951f5439e8' AND business_id = '96e0b0f1-2a87-4b2d-90ba-cc5e9d9ce363';
COMMIT;
