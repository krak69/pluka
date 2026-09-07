insert into public.participant_races (race_id, user_id)
select r.id, 'bcbf29a8-5926-46e7-ad1d-d9a3555e04d0'
from public.races r
where r.slug = 'wild-70k'
returning id;