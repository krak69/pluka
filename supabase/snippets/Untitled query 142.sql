select
  g.version_number,
  g.processed_at,
  g.elevation_gain_m,
  g.elevation_loss_m,
  g.point_count,
  r.elevation_gain_m as officiel
from public.race_course_geometries g
join public.races r on r.id = g.race_id
where r.slug = 'wild-70k';